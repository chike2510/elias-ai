import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => readFileSync(path.resolve(file), "utf8");
const css = read("app/globals.css");
const shell = read("components/AppShell.tsx");
const nav = read("lib/navigation.ts");
const chat = read("components/chat/ChatView.tsx");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

function tokens(scope) {
  const source = scope === "dark" ? css.slice(css.indexOf("@media (prefers-color-scheme: dark)")) : css.slice(css.indexOf(":root {\n  color-scheme"));
  const body = source.slice(source.indexOf("{", source.indexOf(":root")) + 1, source.indexOf("}", source.indexOf(":root")));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));
}

function luminance(hex) {
  const rgb = hex.replace("#", "").match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
  const linear = rgb.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("primary navigation is exactly Chat, Tasks and You; everything else is on You and in the palette", () => {
  const primary = nav.slice(nav.indexOf("PRIMARY"), nav.indexOf("MORE"));
  assert.deepEqual([...primary.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]), ["Chat", "Tasks", "You"]);
  const more = [...nav.slice(nav.indexOf("MORE")).matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  for (const label of ["Projects", "Coding workspace", "Browser", "Library", "Research", "Study", "Skills", "Automations", "Connectors", "Memory", "Profile & settings"]) assert.ok(more.includes(label), `${label} must stay reachable`);
  assert.match(shell, /\{PRIMARY\.map\(\(item\) => <Link[^]*el-tabbar|className="el-tabbar"[^]*PRIMARY\.map/);
  assert.match(css, /\.el-tabbar \{[^}]*grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(shell, /\[\.\.\.PRIMARY, \.\.\.MORE\]/, "the ⌘K palette lists every destination");
});

test("mobile shell follows the visual viewport, respects safe areas and links chat history from the top bar", () => {
  assert.match(shell, /window\.visualViewport/);
  assert.match(shell, /--vvh/);
  assert.match(block(".el-shell"), /height: var\(--vvh, 100dvh\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(block(".el-tabbar"), /var\(--safe-bottom\)/);
  // v4: no hamburger or drawer; the chat top bar links to /chats and other screens get a back arrow.
  assert.doesNotMatch(shell, /\bMenu\b|el-drawer|historyOpen/);
  assert.match(shell, /href="\/chats"/);
  assert.match(shell, /aria-label="Back"/);
  assert.ok(read("app/chats/page.tsx").includes("ChatsScreen"));
  assert.match(css, /\.el-shell\.kb-open \.el-tabbar \{ display: none; \}/);
});

test("tap targets are at least 44px and send gives haptic feedback", () => {
  assert.match(css, /--tap: 44px/);
  for (const selector of [".el-icon-btn", ".el-send"]) {
    assert.match(block(selector), /width: var\(--tap\)/);
    assert.match(block(selector), /height: var\(--tap\)/);
  }
  assert.match(block(".el-btn"), /min-height: var\(--tap\)/);
  assert.match(block(".el-chip"), /min-height: 52px/);
  assert.match(chat, /haptic\(10\)/);
  assert.match(read("lib/chatClient.ts"), /navigator\.vibrate\(ms\)/);
});

test("one font, one accent, and readable light and dark themes", () => {
  const families = [...css.matchAll(/font-family:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(families.every((value) => ["var(--font-sans)", "var(--font-mono)", "inherit"].includes(value)), `unexpected fonts: ${[...new Set(families)].join(" | ")}`);
  assert.doesNotMatch(css, /Instrument Serif|family=Inter/);
  const light = tokens("light");
  const dark = tokens("dark");
  for (const theme of [light, dark]) {
    assert.ok(contrast(theme.text, theme.bg) >= 12, "body text");
    assert.ok(contrast(theme.muted, theme.surface) >= 4.5, "muted text");
    assert.ok(contrast(theme["accent-ink"], theme.accent) >= 4.5, "text on accent");
    assert.ok(contrast(theme["accent-text"], theme["accent-soft"]) >= 4.5, "accent text on soft accent");
  }
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
});

test("v4 shell: back arrows default to the parent screen and duplicate mobile headings are hidden", async () => {
  const source = read("components/AppShell.tsx");
  const fn = source.slice(source.indexOf("export function defaultBack"), source.indexOf("\n}\n", source.indexOf("export function defaultBack")) + 2);
  const defaultBack = new Function(`${fn.replace("export function", "function").replace(/: string \| undefined/, "").replace(/\(pathname: string\)/, "(pathname)")}; return defaultBack;`)();
  assert.equal(defaultBack("/"), undefined);
  assert.equal(defaultBack("/tasks"), undefined);
  assert.equal(defaultBack("/you"), undefined);
  assert.equal(defaultBack("/chats"), "/");
  assert.equal(defaultBack("/connectors/github"), "/connectors");
  assert.equal(defaultBack("/repositories/o/r"), "/projects");
  assert.equal(defaultBack("/memory"), "/you");
  const v4 = read("app/v4-shell.css");
  assert.match(v4, /@media \(max-width: 899px\)[^]*\.el-page-head h1[^]*display: none/);
  assert.match(read("app/layout.tsx"), /import "\.\/v4-shell\.css"/);
});
