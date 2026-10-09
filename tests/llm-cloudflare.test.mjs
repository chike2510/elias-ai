import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/assistant/llm.ts");

const BASES = { groq: "https://groq.test/v1", cerebras: "https://cerebras.test/v1", openrouter: "https://openrouter.test/v1" };
const KEY_ENV = { groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", openrouter: "OPENROUTER_API_KEY" };
const CF_ENV = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_BROWSER_TOKEN", "CLOUDFLARE_AGENT_MODEL", "CLOUDFLARE_FAST_MODEL"];
const ALL_ENV = [...Object.values(KEY_ENV), ...CF_ENV, "GEMINI_API_KEY", "ELIAS_AGENT_PROVIDERS", "ELIAS_AGENT_BASE_URL", "ELIAS_GITHUB_MODELS", "MISTRAL_API_KEY", "HF_TOKEN", "QWEN_API_KEY", "GITHUB_TOKEN"];
const CF_BASE = "https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1";

/** Fresh module with Cloudflare (account + browser token by default) and the given providers configured. */
function load(providers, extraEnv = {}) {
  for (const name of ALL_ENV) delete process.env[name];
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
  process.env.CLOUDFLARE_BROWSER_TOKEN = "synthetic-browser-token";
  for (const provider of providers) process.env[KEY_ENV[provider]] = `synthetic-${provider}`;
  for (const [key, value] of Object.entries(extraEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const providerMock = { DEFAULT_HF_CHAT_MODEL: "x", providerConfig: (name) => ({ name, key: process.env[KEY_ENV[name]], baseUrl: BASES[name] }) };
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/providers") return providerMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(compiled, sourcePath); } finally { Module._load = originalLoad; }
  return loaded.exports;
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const reply = (text) => json({ choices: [{ message: { content: text } }] });
const cfError = (code, message, status) => json({ success: false, errors: [{ code, message }], messages: [], result: null }, status);

/** fetch mock: model discovery goes to models(url); chat calls to handler(url, body, headers). */
function mockFetch(handler, models = () => new Response("nope", { status: 404 })) {
  const calls = [];
  const discovery = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/models") || url.includes("/models/search")) { discovery.push({ url, headers: init.headers }); return models(url); }
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body, headers: init.headers });
    return handler(url, body);
  };
  return Object.assign(calls, { discovery });
}

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const user = (text) => [{ role: "user", content: text }];

test("cloudflare is first in the order, fast tier too, and uses the OpenAI-compatible endpoint", async () => {
  const llm = load(["groq"]);
  assert.deepEqual(llm.agentProviders().slice(0, 2), ["cloudflare", "groq"]);
  assert.equal(llm.providersFor({ tier: "fast" })[0], "cloudflare");
  const calls = mockFetch((url, body) => reply(`hi from ${body.model}`));
  const result = await llm.complete(user("hi"), [{ type: "function", function: { name: "web_search", description: "Search.", parameters: { type: "object", properties: {} } } }]);
  assert.equal(result.provider, "cloudflare");
  assert.equal(result.model, "@cf/openai/gpt-oss-120b");
  assert.equal(calls[0].url, `${CF_BASE}/chat/completions`);
  assert.equal(calls[0].headers.Authorization, "Bearer synthetic-browser-token");
  assert.equal(calls[0].body.tool_choice, "auto");
  const fast = await llm.complete(user("hey"), [], { route: { tier: "fast" } });
  assert.equal(fast.model, "@cf/openai/gpt-oss-20b");
});

test("CLOUDFLARE_AI_TOKEN wins over the browser token; no account id means not configured", async () => {
  let llm = load([], { CLOUDFLARE_AI_TOKEN: "synthetic-ai-token" });
  const calls = mockFetch(() => reply("ok"));
  await llm.complete(user("hi"));
  assert.equal(calls[0].headers.Authorization, "Bearer synthetic-ai-token");
  llm = load(["groq"], { CLOUDFLARE_ACCOUNT_ID: undefined });
  assert.ok(!llm.agentProviders().includes("cloudflare"));
  // An older explicit order still gets cloudflare at the front.
  llm = load(["groq"], { ELIAS_AGENT_PROVIDERS: "groq,openrouter" });
  assert.equal(llm.agentProviders()[0], "cloudflare");
});

test("daily neuron allocation used up: cool down until 00:00 UTC and fall through to groq", async () => {
  const llm = load(["groq"]);
  const calls = mockFetch((url, body) => url.startsWith(CF_BASE)
    ? cfError(3036, "You have used up your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.", 429)
    : reply(`groq ${body.model}`));
  const result = await llm.complete(user("hi"));
  assert.equal(result.provider, "groq");
  assert.equal(calls.filter((call) => call.url.startsWith(CF_BASE)).length, 1, "one try, not every model");
  const cooling = llm.providerCooldowns().find((item) => item.provider === "cloudflare");
  assert.ok(cooling, "cloudflare is cooling down");
  assert.match(cooling.reason, /neurons/);
  const until = Date.parse(cooling.until);
  assert.equal(new Date(until).getUTCHours(), 0);
  assert.ok(until - Date.now() <= 24 * 3600_000);
  assert.match(cooling.hint, /00:00 UTC/);
  // Next turn skips Cloudflare without calling it.
  const before = calls.length;
  await llm.complete(user("again"));
  assert.ok(!calls.slice(before).some((call) => call.url.startsWith(CF_BASE)));
});

test("401/403 auth error: cool down an hour with a hint naming Workers AI: Read", async () => {
  const llm = load(["groq"]);
  mockFetch((url) => url.startsWith(CF_BASE) ? cfError(10000, "Authentication error", 403) : reply("groq ok"));
  const result = await llm.complete(user("hi"));
  assert.equal(result.provider, "groq");
  const cooling = llm.providerCooldowns().find((item) => item.provider === "cloudflare");
  assert.equal(cooling.reason, "token lacks Workers AI permission");
  const minutes = (Date.parse(cooling.until) - Date.now()) / 60_000;
  assert.ok(minutes > 55 && minutes <= 60, `cooldown ${minutes} min`);
  assert.match(cooling.hint, /Workers AI: Read/);
});

test("all providers failing carries the Cloudflare hint in the summary, not in raw JSON", async () => {
  const llm = load([]);
  mockFetch(() => cfError(10000, "Authentication error", 401));
  await assert.rejects(llm.complete(user("hi")), (error) => {
    assert.ok(error instanceof llm.AllProvidersFailedError);
    assert.equal(error.summary[0].provider, "cloudflare");
    assert.match(error.summary[0].hint, /Workers AI: Read/);
    assert.ok(!error.message.includes("{"));
    return true;
  });
});

test("out of capacity on one model moves to the next Cloudflare model; a generic 429 rests the provider an hour", async () => {
  let llm = load(["groq"]);
  let calls = mockFetch((url, body) => body.model === "@cf/openai/gpt-oss-120b" ? cfError(3040, "Capacity temporarily exceeded, please try again.", 429) : reply(`ok ${body.model}`));
  let result = await llm.complete(user("hi"));
  assert.equal(result.provider, "cloudflare");
  assert.equal(result.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  llm = load(["groq"]);
  calls = mockFetch((url) => url.startsWith(CF_BASE) ? json({ errors: [{ message: "Too many requests" }] }, 429) : reply("groq"));
  result = await llm.complete(user("hi"));
  assert.equal(result.provider, "groq");
  const cooling = llm.providerCooldowns().find((item) => item.provider === "cloudflare");
  assert.ok(Date.parse(cooling.until) - Date.now() > 55 * 60_000);
});

test("a paid-only or missing model is skipped, the rest of the list still runs", async () => {
  const llm = load(["groq"]);
  const calls = mockFetch((url, body) => body.model === "@cf/openai/gpt-oss-120b"
    ? cfError(5035, "This model requires a Workers Paid plan.", 403)
    : body.model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast" ? cfError(5007, "No such model @cf/meta/llama-3.3-70b-instruct-fp8-fast or task", 400) : reply("20b here"));
  const result = await llm.complete(user("hi"));
  assert.equal(result.model, "@cf/openai/gpt-oss-20b");
  assert.ok(!llm.providerCooldowns().some((item) => item.provider === "cloudflare"));
  assert.equal(calls.length, 3);
});

test("discovery reads Workers AI model search results and never adds unlisted models", async () => {
  const llm = load([]);
  const calls = mockFetch((url, body) => reply(body.model), () => json({ success: true, result: [{ name: "@cf/openai/gpt-oss-20b" }, { name: "@cf/some/other-model" }] }));
  const result = await llm.complete(user("hi"));
  assert.equal(result.model, "@cf/openai/gpt-oss-20b", "listed models go first");
  assert.match(calls.discovery[0].url, /\/accounts\/acct123\/ai\/models\/search/);
  const models = await llm.configuredModels();
  assert.ok(!JSON.stringify(models).includes("other-model"));
});

test("only: the health probe tries just the pinned provider in streaming mode", async () => {
  const llm = load(["groq"]);
  const calls = mockFetch((url) => url.startsWith(CF_BASE) ? cfError(10000, "Authentication error", 403) : reply("groq"));
  await assert.rejects(llm.completeStream(user("hi"), [], () => undefined, { route: { tier: "strong", provider: "cloudflare" }, only: true }), (error) => error instanceof llm.AllProvidersFailedError);
  assert.ok(calls.every((call) => call.url.startsWith(CF_BASE)));
});

test("msUntilUtcMidnight lands on the next 00:00 UTC", () => {
  const llm = load([]);
  const now = Date.UTC(2026, 9, 9, 19, 30);
  assert.equal(llm.msUntilUtcMidnight(now), 4.5 * 3600_000);
});
