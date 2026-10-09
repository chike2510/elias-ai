import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const read = (file) => readFileSync(path.resolve(file), "utf8");

/** Transpiles a TS/TSX file to CommonJS and loads it, resolving "@/..." to other transpiled repo files. */
function load(file, cache = new Map()) {
  const full = path.resolve(file);
  if (cache.has(full)) return cache.get(full);
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = new Module(full);
  loaded.filename = full;
  loaded.paths = Module._nodeModulePaths(path.dirname(full));
  loaded.require = (id) => {
    if (id.startsWith("@/")) {
      const base = id.slice(2);
      const candidate = [`${base}.ts`, `${base}.tsx`].find((name) => { try { read(name); return true; } catch { return false; } });
      return load(candidate, cache);
    }
    return require(id);
  };
  cache.set(full, loaded.exports);
  loaded._compile(compiled, full);
  return loaded.exports;
}

const menu = load("lib/messageMenu.ts");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");

test("menu items per bubble kind", () => {
  const ids = (input) => menu.menuActions(input).map((item) => item.id);
  assert.deepEqual(ids({ role: "assistant", hasText: true }), ["copy", "select", "reply"]);
  assert.deepEqual(ids({ role: "user", hasText: true, canEdit: true }), ["copy", "select", "reply", "edit"]);
  assert.deepEqual(ids({ role: "user", hasText: true, canEdit: false }), ["copy", "select", "reply"], "no edit while a reply is running");
  assert.deepEqual(ids({ role: "user", hasText: false, hasImage: true }), ["download"], "image-only message");
  assert.deepEqual(ids({ role: "user", hasText: true, hasImage: true, canEdit: true }), ["copy", "select", "reply", "edit", "download"]);
  assert.equal(menu.menuActions({ role: "assistant", hasText: true }).find((item) => item.id === "select").label, "Select Text");
});

test("thumbs only for saved assistant text", () => {
  assert.equal(menu.showFeedback({ role: "assistant", hasText: true, messageId: 12 }), true);
  assert.equal(menu.showFeedback({ role: "assistant", hasText: true }), false, "no id yet (still streaming)");
  assert.equal(menu.showFeedback({ role: "user", hasText: true, messageId: 3 }), false);
  assert.equal(menu.parseFeedback({ rating: "down", at: "x" }), "down");
  assert.equal(menu.parseFeedback("up"), "up");
  assert.equal(menu.parseFeedback({ rating: "meh" }), null);
  assert.equal(menu.parseFeedback(undefined), null);
});

test("long-press fires after the delay, not on a scroll or an early release", () => {
  let now = 0; const timers = new Map(); let next = 1;
  const setTimer = (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const advance = (ms) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
  const fired = [];
  const press = menu.createLongPress({ onFire: (point) => fired.push(point), setTimer, clearTimer });

  press.down(100, 200); advance(449); assert.equal(fired.length, 0);
  advance(1); assert.deepEqual(fired, [{ x: 100, y: 200 }], "fires at 450ms");
  assert.equal(press.consumeFired(), true, "the click after a long-press is swallowed");
  assert.equal(press.consumeFired(), false, "only once");

  press.down(10, 10); press.move(15, 14); advance(500); assert.equal(fired.length, 2, "a 6px wobble still counts");
  press.consumeFired();
  press.down(10, 10); press.move(10, 19); advance(500); assert.equal(fired.length, 2, "moving more than 8px (a scroll) cancels");
  press.down(10, 10); advance(200); press.up(); advance(500); assert.equal(fired.length, 2, "a tap is not a long-press");
  assert.equal(press.consumeFired(), false, "a plain tap's click goes through");
  press.down(10, 10); press.cancel(); advance(500); assert.equal(fired.length, 2, "pointercancel cancels");
  assert.equal(menu.LONG_PRESS_MS, 450); assert.equal(menu.MOVE_SLOP_PX, 8);
});

test("menu sits under the bubble, above it when there's no room, and stays on screen", () => {
  const rect = (top, height, left = 20, width = 300) => ({ top, bottom: top + height, left, right: left + width, width, height });
  const base = { menuWidth: 240, menuHeight: 220, viewportWidth: 390, viewportHeight: 844 };
  const below = menu.placeMenu({ ...base, rect: rect(100, 80), align: "start" });
  assert.deepEqual(below, { top: 188, left: 20, side: "below" });
  const above = menu.placeMenu({ ...base, rect: rect(600, 120), align: "start" });
  assert.equal(above.side, "above"); assert.equal(above.top, 600 - 8 - 220);
  const user = menu.placeMenu({ ...base, rect: rect(100, 60, 140, 230), align: "end" });
  assert.equal(user.left, 370 - 240, "user menus line up with the right edge");
  const clamp = menu.placeMenu({ ...base, rect: rect(100, 60, 300, 200), align: "end" });
  assert.equal(clamp.left, 390 - 12 - 240, "never past the screen edge");
  const tall = menu.placeMenu({ ...base, rect: rect(-200, 1400), align: "start", pressY: 500 });
  assert.equal(tall.side, "over"); assert.equal(tall.top, 508);
  const tallLow = menu.placeMenu({ ...base, rect: rect(-200, 1400), align: "start", pressY: 800 });
  assert.equal(tallLow.top, 844 - 12 - 220, "clamped to the bottom margin");
});

test("plain text, first line and reply context", () => {
  const md = "## Plan\n\n**Leave** by *7:40*. See [the map](https://maps.example/x).\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quoted\n[[choices: Yes | No]]";
  const plain = menu.plainText(md);
  assert.ok(plain.startsWith("Plan\n\nLeave by 7:40. See the map (https://maps.example/x)."), plain);
  assert.ok(plain.includes("const a = 1;") && !plain.includes("```"));
  assert.ok(plain.includes("| 1 | 2 |") && !plain.includes("|---|"));
  assert.ok(plain.includes("quoted") && !plain.includes("> quoted") && !plain.includes("choices"));
  assert.equal(menu.firstLine(md), "Plan");
  assert.equal(menu.firstLine("\n\n- **First** item\n- second"), "First item");
  assert.equal(menu.firstLine("x".repeat(100), 20).length, 20);
  assert.equal(menu.cleanReplyQuote("   "), undefined);
  assert.equal(menu.cleanReplyQuote(42), undefined);
  assert.equal(menu.cleanReplyQuote("y".repeat(5000)).length, menu.MAX_REPLY_QUOTE);
  assert.equal(menu.withReplyContext("why?", undefined), "why?");
  assert.equal(menu.withReplyContext("why?", "a\nb"), "[The user is replying to this earlier message]\n> a\n> b\n\nwhy?");
});

test("Select Text sheet renders selectable plain text", () => {
  const sheet = load("components/chat/MessageMenu.tsx");
  const html = renderToStaticMarkup(React.createElement(sheet.SelectTextSheet, { text: "**Bold** answer", onClose: () => {} }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /class="el-select-text"[^>]*>Bold answer</);
  assert.equal(renderToStaticMarkup(React.createElement(sheet.MenuToast, { text: "Copied" })).includes(">Copied<"), true);
  assert.equal(renderToStaticMarkup(React.createElement(sheet.MenuToast, { text: null })), "");
});

test("menu wiring: a11y roles, haptic, right-click, callout off, feedback API", () => {
  const ui = read("components/chat/MessageMenu.tsx");
  assert.match(ui, /role="menu"/); assert.match(ui, /role="menuitem"/); assert.match(ui, /role="menuitemradio"/);
  assert.match(ui, /haptic\(10\)/); assert.match(ui, /onContextMenu/); assert.match(ui, /event\.key === "Escape"/); assert.match(ui, /event\.key === "Tab"/);
  assert.match(ui, /popstate/, "back gesture closes");
  const css = read("app/v5-msgmenu.css");
  assert.match(css, /-webkit-touch-callout: none/); assert.match(css, /backdrop-filter: blur/); assert.match(css, /prefers-color-scheme: light/);
  assert.match(read("app/layout.tsx"), /v5-msgmenu\.css/);
  const chat = read("components/chat/ChatView.tsx");
  assert.match(chat, /menu\.bind\(/); assert.match(chat, /\/api\/assistant\/feedback/); assert.match(chat, /replyTo/);
  const route = read("app/api/assistant/feedback/route.ts");
  assert.match(route, /requireUser\(request\)/, "owner-auth");
  assert.match(read("lib/chatClient.ts"), /replyTo: input\.replyTo/);
});
