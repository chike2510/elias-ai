import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function load(file) {
  const sourcePath = path.resolve(file);
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const core = load("lib/browserRun/core.ts");
const elements = [
  { id: 0, tag: "input", type: "email", label: "Email", x: 100, y: 100, w: 200, h: 30 },
  { id: 1, tag: "input", type: "password", label: "Password", x: 100, y: 150, w: 200, h: 30 },
  { id: 2, tag: "button", type: "submit", label: "Create account", x: 100, y: 200, w: 120, h: 40 },
];

test("parseDecision accepts the JSON actions and strips code fences", () => {
  assert.deepEqual(core.parseDecision('```json\n{"action":"click","target":2,"status":"Signing up…"}\n```', elements), { action: "click", target: 2, status: "Signing up…" });
  const typed = core.parseDecision('Sure: {"action":"type","target":0,"text":"a@b.co"}', elements);
  assert.equal(typed.text, "a@b.co");
  assert.equal(typed.submit, false);
});

test("parseDecision keeps secrets as references, never text", () => {
  const typed = core.parseDecision('{"action":"type","target":1,"secret":"supabase-login","field":"password"}', elements);
  assert.equal(typed.secret, "supabase-login");
  assert.equal(typed.field, "password");
  assert.equal(typed.text, undefined);
});

test("parseDecision rejects unknown targets, actions and bad urls", () => {
  assert.throws(() => core.parseDecision('{"action":"click","target":99}', elements), /not in the list/);
  assert.throws(() => core.parseDecision('{"action":"hack"}', elements), /Unknown action/);
  assert.throws(() => core.parseDecision('{"action":"navigate","url":"javascript:alert(1)"}', elements), /http/);
  assert.throws(() => core.parseDecision("no json here", elements), /No JSON/);
});

test("isLooping stops on the third identical action, not before", () => {
  const key = core.decisionKey({ action: "click", target: 2 }, "https://x.com/signup#a", elements);
  assert.equal(core.isLooping([], key), false);
  assert.equal(core.isLooping([key], key), false);
  assert.equal(core.isLooping([key, key], key), true);
  assert.equal(core.isLooping([key, "other"], key), false);
});

test("needsApproval covers Submit, Pay, Send and Create account", () => {
  for (const label of ["Submit", "Pay now", "Send", "Create account", "Create an account", "Sign up", "Place order"]) assert.equal(core.needsApproval(label), true, label);
  for (const label of ["Next", "Continue", "Email", "Log in", "Search"]) assert.equal(core.needsApproval(label), false, label);
});

test("blockedBy blocks risky domains, subdomains, extras and local addresses", () => {
  assert.equal(core.blockedBy("https://www.paypal.com/signin"), "paypal.com");
  assert.equal(core.blockedBy("https://accounts.binance.com/en/login"), "binance.com");
  assert.equal(core.blockedBy("https://example.org/", ["example.org"]), "example.org");
  assert.equal(core.blockedBy("http://169.254.169.254/latest"), "169.254.169.254");
  assert.equal(core.blockedBy("file:///etc/passwd"), "file");
  assert.equal(core.blockedBy("https://supabase.com/dashboard/sign-up"), null);
  assert.equal(core.blockedBy("https://notpaypal.com"), null);
});

test("codeInText finds sign-in codes in email subjects and snippets", () => {
  assert.equal(core.codeInText("Your Supabase verification code is 482913"), "482913");
  assert.equal(core.codeInText("OTP: 7731 expires in 10 minutes"), "7731");
  assert.equal(core.codeInText("Welcome aboard!"), null);
});

test("driveRun follows the server: act, wait/poll, then stop", async () => {
  const acted = [];
  let observed = 0;
  const driver = { observe: async () => ({ url: "https://x.com", title: "x", elements, frame: "AAA", n: ++observed }), act: async (action) => { acted.push(action.type); }, keepAlive: async () => undefined };
  const replies = [
    { kind: "act", action: { type: "click", x: 1, y: 2 } },
    { kind: "wait", ms: 1 },
    { kind: "act", action: { type: "type", x: 1, y: 2, text: "hi" } },
    { kind: "stop", reason: "done" },
  ];
  const inputs = [];
  const result = await core.driveRun(driver, async (input) => { inputs.push(input); return replies.shift(); }, { sleep: async () => undefined });
  assert.equal(result.reason, "done");
  assert.deepEqual(acted, ["click", "type"]);
  assert.equal(inputs[2].poll, true);
  assert.equal(inputs[2].observation, undefined);
  assert.ok(inputs[3].observation);
});

test("driveRun reports a failed action back to the server instead of crashing", async () => {
  const driver = { observe: async () => ({ url: "u", title: "t", elements: [] }), act: async () => { throw new Error("element detached"); }, keepAlive: async () => undefined };
  const inputs = [];
  const replies = [{ kind: "act", action: { type: "click", x: 0, y: 0 } }, { kind: "stop", reason: "ok" }];
  await core.driveRun(driver, async (input) => { inputs.push(input); return replies.shift(); }, { sleep: async () => undefined });
  assert.match(inputs[1].error, /detached/);
});
