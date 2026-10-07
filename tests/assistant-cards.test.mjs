import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function load(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const cards = load(path.resolve("lib/assistant/cards.ts"));

test("approval details show exactly what will happen for email, events, deletes and browser actions", () => {
  assert.deepEqual(cards.approvalDetails("gmail_send", { to: "a@b.co", subject: "Hi", body: "Hello" }, ""), { kind: "email", to: "a@b.co", cc: undefined, subject: "Hi", body: "Hello" });
  assert.deepEqual(cards.approvalDetails("calendar_create", { summary: "Sync", start: "2026-10-08T10:00:00+01:00", end: "2026-10-08T10:30:00+01:00", attendees: ["ada@x.co"] }, ""), { kind: "event", title: "Sync", start: "2026-10-08T10:00:00+01:00", end: "2026-10-08T10:30:00+01:00", guests: ["ada@x.co"], location: undefined });
  assert.deepEqual(cards.approvalDetails("calendar_delete", { event_id: "e1", title: "Dentist" }, ""), { kind: "delete_event", title: "Dentist" });
  const browser = cards.approvalDetails("browser_click", { element: 4, _context: { url: "https://shop.example/checkout" } }, 'Buy 2 tickets for ₦25,000\nButton: "Place order"');
  assert.equal(browser.kind, "browser");
  assert.equal(browser.url, "https://shop.example/checkout");
  assert.equal(browser.action, 'Click "Place order"');
  assert.equal(browser.amount, "₦25,000");
});

test("amounts are found in common currency formats and only editable fields can change", () => {
  assert.equal(cards.amountIn("Total $49.99 today"), "$49.99");
  assert.equal(cards.amountIn("Pay 12,500 NGN"), "12,500 NGN");
  assert.equal(cards.amountIn("No money here"), undefined);
  assert.deepEqual(cards.EDITABLE_ARGS.gmail_send, ["to", "cc", "subject", "body"]);
  assert.equal(cards.EDITABLE_ARGS.browser_click, undefined);
});

test("tool output becomes compact cards instead of markdown walls", () => {
  const links = cards.cardFor("web_search", [{ title: "A", url: "https://a.example", snippet: "x".repeat(400) }, { title: "no url" }]);
  assert.equal(links.kind, "links");
  assert.equal(links.items.length, 1);
  assert.ok(links.items[0].snippet.length <= 160);
  const emails = cards.cardFor("gmail_search", [{ id: "m1", from: "Bank <alerts@bank.ng>", subject: "", snippet: "Your statement", unread: true }]);
  assert.deepEqual(emails.items[0], { id: "m1", from: "Bank", subject: "(no subject)", date: "", snippet: "Your statement", unread: true });
  assert.equal(cards.cardFor("calendar_list", []), null);
  assert.equal(cards.cardFor("weather", { place: "Lagos", summary: "Clear", now: 30 }).kind, "weather");
  assert.equal(cards.cardFor("memory_save", { id: "x" }), null);
});

test("every tool has a human status line", () => {
  const tools = readFileSync(path.resolve("lib/assistant/tools.ts"), "utf8");
  const names = [...tools.matchAll(/^  ([a-z_]+): \{\n    schema:/gm)].map((match) => match[1]);
  assert.ok(names.length >= 20);
  for (const name of names) assert.notEqual(cards.statusLabel(name), "Working…", `${name} needs a status label`);
  assert.equal(cards.statusLabel("web_search"), "Searching the web…");
  assert.equal(cards.statusLabel("gmail_search"), "Reading Gmail…");
  assert.equal(cards.statusLabel("calendar_list"), "Checking calendar…");
});
