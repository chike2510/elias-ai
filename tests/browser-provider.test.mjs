import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/assistant/browser.ts");

function loadBrowser() {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/assistant/db") return { ready: async () => { throw new Error("no db in unit test"); } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(compiled, sourcePath); } finally { Module._load = originalLoad; }
  return loaded.exports;
}

function withEnv(values, fn) {
  const keys = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_BROWSER_TOKEN", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try { return fn(); } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test("Cloudflare endpoint uses browser-run devtools with keep_alive", () => {
  const { cloudflareEndpoint, cloudflareKeepAliveMs } = loadBrowser();
  assert.equal(cloudflareEndpoint("abc123", 180000), "wss://api.cloudflare.com/client/v4/accounts/abc123/browser-run/devtools/browser?keep_alive=180000");
  assert.equal(cloudflareKeepAliveMs({}), 180000);
  assert.equal(cloudflareKeepAliveMs({ CLOUDFLARE_BROWSER_KEEP_ALIVE_MS: "60000" }), 60000);
  assert.equal(cloudflareKeepAliveMs({ CLOUDFLARE_BROWSER_KEEP_ALIVE_MS: "5" }), 10000);
  assert.equal(cloudflareKeepAliveMs({ CLOUDFLARE_BROWSER_KEEP_ALIVE_MS: "99999999" }), 600000);
  assert.equal(cloudflareKeepAliveMs({ CLOUDFLARE_BROWSER_KEEP_ALIVE_MS: "nope" }), 180000);
});

test("browserConfigured is true for either provider", () => {
  const mod = loadBrowser();
  withEnv({}, () => { assert.equal(mod.browserConfigured(), false); assert.deepEqual(mod.browserProviders(), []); });
  withEnv({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_BROWSER_TOKEN: "t" }, () => { assert.equal(mod.browserConfigured(), true); assert.deepEqual(mod.browserProviders(), ["cloudflare"]); });
  withEnv({ BROWSERBASE_API_KEY: "k", BROWSERBASE_PROJECT_ID: "p" }, () => { assert.equal(mod.browserConfigured(), true); assert.deepEqual(mod.browserProviders(), ["browserbase"]); });
  withEnv({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_BROWSER_TOKEN: "t", BROWSERBASE_API_KEY: "k", BROWSERBASE_PROJECT_ID: "p" }, () => assert.deepEqual(mod.browserProviders(), ["cloudflare", "browserbase"]));
  withEnv({ CLOUDFLARE_ACCOUNT_ID: "a" }, () => assert.equal(mod.browserConfigured(), false));
});

test("quota and rate-limit errors are recognised", () => {
  const { isQuotaError } = loadBrowser();
  assert.equal(isQuotaError(new Error("WebSocket error: Unexpected server response: 429")), true);
  assert.equal(isQuotaError(new Error("Browserbase 402: payment required")), true);
  assert.equal(isQuotaError(new Error("Rate limit exceeded")), true);
  assert.equal(isQuotaError(new Error("Too many concurrent sessions")), true);
  assert.equal(isQuotaError(new Error("net::ERR_NAME_NOT_RESOLVED")), false);
  assert.equal(isQuotaError(new Error("Unexpected server response: 401")), false);
});

test("launchBrowser explains missing setup", async () => {
  const mod = loadBrowser();
  await withEnv({}, async () => { await assert.rejects(() => mod.launchBrowser(), /not configured/); });
});
