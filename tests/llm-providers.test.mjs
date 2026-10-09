import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/assistant/llm.ts");

const BASES = {
  groq: "https://groq.test/v1",
  cerebras: "https://cerebras.test/v1",
  openrouter: "https://openrouter.test/v1",
  mistral: "https://mistral.test/v1",
  huggingface: "https://hf.test/v1",
  qwen: "https://qwen.test/v1",
  github: "https://models.github.ai/inference",
};
const KEY_ENV = { groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", openrouter: "OPENROUTER_API_KEY", mistral: "MISTRAL_API_KEY", huggingface: "HF_TOKEN", qwen: "QWEN_API_KEY", github: "GITHUB_TOKEN" };
const ALL_ENV = [...Object.values(KEY_ENV), "GEMINI_API_KEY", "ELIAS_AGENT_PROVIDERS", "ELIAS_AGENT_BASE_URL", "ELIAS_GITHUB_MODELS", "GROQ_AGENT_MODEL", "GEMINI_AGENT_MODEL", "ELIAS_MAX_TOKENS", "GROQ_TPM_BUDGET"];

/** Fresh module (fresh cooldown/model caches) with only the given providers configured. */
function load(providers, extraEnv = {}) {
  for (const name of ALL_ENV) delete process.env[name];
  for (const provider of providers) {
    if (provider === "gemini") process.env.GEMINI_API_KEY = "synthetic-gemini";
    else process.env[KEY_ENV[provider]] = `synthetic-${provider}`;
  }
  Object.assign(process.env, extraEnv);
  const providerMock = {
    DEFAULT_HF_CHAT_MODEL: "Qwen/Qwen3.8-27B:fastest",
    providerConfig: (name) => ({ name, key: process.env[KEY_ENV[name]], baseUrl: BASES[name] }),
  };
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

/** Installs a fetch mock. handler(url, body) returns a Response; /models calls go to models(url). Returns the call log. */
function mockFetch(handler, models = () => new Response("nope", { status: 404 })) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/models")) return models(url);
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    return handler(url, body);
  };
  return calls;
}

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

const user = (text) => [{ role: "user", content: text }];

test("every request carries a capped max_tokens", async () => {
  const llm = load(["groq"]);
  const calls = mockFetch(() => reply("pong"));
  const result = await llm.complete(user("ping"));
  assert.equal(result.content, "pong");
  assert.ok(calls[0].body.max_tokens > 0 && calls[0].body.max_tokens <= 2048, `max_tokens ${calls[0].body.max_tokens}`);
});

test("a short Groq 429 is waited out and retried once on the same model", async () => {
  const llm = load(["groq"]);
  let first = true;
  const calls = mockFetch((url, body) => {
    if (first) { first = false; return json({ error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 3000, Requested 6018. Please try again in 0.01s." } }, 429); }
    return reply(`ok from ${body.model}`);
  });
  const result = await llm.complete(user("hi"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, calls[1].body.model);
  assert.equal(result.provider, "groq");
});

test("a long Groq 429 moves to another Groq model with its own limit", async () => {
  const llm = load(["groq"]);
  const calls = mockFetch((url, body) => body.model === "openai/gpt-oss-120b"
    ? json({ error: { message: "Rate limit reached on tokens per minute (TPM). Please try again in 45s." } }, 429, { "retry-after": "45" })
    : reply(`ok from ${body.model}`));
  const result = await llm.complete(user("hi"));
  assert.equal(calls[0].body.model, "openai/gpt-oss-120b");
  assert.notEqual(result.model, "openai/gpt-oss-120b");
  assert.equal(result.provider, "groq");
  // The rate-limited model is skipped on the next call instead of being hit again.
  const before = calls.length;
  await llm.complete(user("again"));
  assert.notEqual(calls[before].body.model, "openai/gpt-oss-120b");
});

test("Groq discovery adds models it offers but we don't list, and drops the ones it doesn't", async () => {
  const llm = load(["groq"]);
  const calls = mockFetch((url, body) => body.model === "qwen/qwen3.8-27b" ? reply("qwen") : json({ error: { message: "Please try again in 50s" } }, 429),
    () => json({ data: [{ id: "openai/gpt-oss-120b" }, { id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" }, { id: "whisper-large-v3" }, { id: "meta-llama/llama-prompt-guard-2-86m" }] }));
  const result = await llm.complete(user("hi"));
  assert.equal(result.model, "qwen/qwen3.8-27b");
  assert.ok(!calls.some((call) => /whisper|guard|llama-3.1-8b-instant/.test(call.body.model)));
});

test("fitRequest trims history and compacts tools to fit an 8k budget, keeping the system prompt and the new message", () => {
  const llm = load(["groq"]);
  const tools = Array.from({ length: 50 }, (_, i) => ({ type: "function", function: { name: `tool_${i}`, description: `Does thing ${i}. ${"Long explanation. ".repeat(20)}`, parameters: { type: "object", properties: { q: { type: "string", description: "x".repeat(200) } } } } }));
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i} ${"words ".repeat(400)}` }));
  const messages = [{ role: "system", content: `You are Elias. ${"memory ".repeat(2000)}` }, ...history, { role: "user", content: "what's the weather?" }];
  const before = llm.estimateTokens(messages, tools);
  assert.ok(before > 8000);
  const fitted = llm.fitRequest(messages, tools, 8000, 2048);
  assert.ok(fitted, "should fit after trimming");
  assert.ok(llm.estimateTokens(fitted.messages, fitted.tools) + fitted.maxTokens <= 8000 * 0.9 + 1);
  assert.equal(fitted.messages[0].role, "system");
  assert.ok(fitted.messages[0].content.startsWith("You are Elias."));
  assert.equal(fitted.messages.at(-1).content, "what's the weather?");
  assert.equal(fitted.tools.length, 50, "tools are compacted, never dropped");
  assert.ok(fitted.maxTokens >= 512 && fitted.maxTokens <= 2048);
  // Small requests pass through untouched.
  const small = llm.fitRequest(user("hi"), [], 8000, 2048);
  assert.deepEqual(small.messages, user("hi"));
  assert.equal(small.maxTokens, 2048);
  // Unbounded providers aren't touched.
  assert.equal(llm.fitRequest(messages, tools, null).messages, messages);
});

test("a request too large for Groq falls through to the next provider", async () => {
  const llm = load(["groq", "gemini"]);
  const calls = mockFetch((url, body) => reply(`from ${body.model}`));
  const huge = [{ role: "user", content: "x".repeat(200_000) }];
  const result = await llm.complete(huge);
  assert.equal(result.provider, "gemini");
  assert.ok(!calls.some((call) => call.url.startsWith(BASES.groq)), "Groq is never sent a request it would reject");
});

test("Gemini picks the newest flash from discovery and follows a 404's suggested model", async () => {
  const llm = load(["gemini"]);
  const ids = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.8-flash-tts", "gemini-3-flash-preview", "gemini-flash-latest"];
  assert.deepEqual(llm.rankGemini(ids, "strong").slice(0, 3), ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]);
  assert.equal(llm.rankGemini(ids, "fast")[0], "gemini-3.5-flash-lite");
  assert.ok(llm.rankGemini(ids, "strong").indexOf("gemini-2.5-flash") > llm.rankGemini(ids, "strong").indexOf("gemini-flash-latest"));
  assert.ok(!llm.rankGemini(ids, "strong").includes("gemini-3.8-flash-tts"));

  // Pinned to a closed 2.5 model: the 404 names the replacement, which is tried next.
  const calls = mockFetch((url, body) => body.model === "gemini-2.5-flash"
    ? json([{ error: { code: 404, message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash instead.", status: "NOT_FOUND" } }], 404)
    : reply(`from ${body.model}`));
  const result = await llm.complete(user("hi"), [], { route: { tier: "strong", provider: "gemini", model: "gemini-2.5-flash" } });
  assert.equal(calls[0].body.model, "gemini-2.5-flash");
  assert.equal(result.model, "gemini-3.8-flash");
});

test("GitHub Models is retired: left out by default, and a 200 'OK' is an account error, not a parse crash", async () => {
  let llm = load(["groq", "github"]);
  assert.deepEqual(llm.agentProviders(), ["groq"]);
  llm = load(["github"], { ELIAS_GITHUB_MODELS: "1" });
  assert.deepEqual(llm.agentProviders(), ["github"]);
  mockFetch(() => new Response("OK\r\n", { status: 200, headers: { "content-type": "text/plain" } }));
  await assert.rejects(llm.complete(user("hi")), (error) => {
    assert.ok(error instanceof llm.AllProvidersFailedError);
    assert.match(error.summary[0].reason, /no JSON/);
    return true;
  });
});

test("OpenRouter only uses :free models and never asks for a huge max_tokens", async () => {
  const llm = load(["openrouter"]);
  const calls = mockFetch((url, body) => reply(`from ${body.model}`), () => json({ data: [{ id: "stepfun/step-5-preview" }, { id: "nvidia/nemotron-3.5-lightning:free" }, { id: "openai/gpt-5" }] }));
  const result = await llm.complete(user("hi"));
  assert.equal(result.model, "nvidia/nemotron-3.5-lightning:free");
  assert.ok(calls.every((call) => call.body.model.endsWith(":free")));
  assert.ok(calls[0].body.max_tokens <= 2048);
});

test("402 and quota errors cool the provider down for an hour so later turns skip it", async () => {
  const llm = load(["cerebras", "qwen", "groq"]);
  const calls = mockFetch((url, body) => {
    if (url.startsWith(BASES.cerebras)) return json({ message: "Payment required to access this resource.", code: "payment_required" }, 402);
    if (url.startsWith(BASES.qwen)) return json({ error: { message: "The free quota has been exhausted.", type: "AllocationQuota.FreeTierOnly" } }, 403);
    return reply("groq here");
  });
  await llm.complete(user("one"), [], { route: { tier: "strong", provider: "cerebras" } });
  await llm.complete(user("two"), [], { route: { tier: "strong", provider: "qwen" } });
  const hits = () => calls.filter((call) => call.url.startsWith(BASES.cerebras) || call.url.startsWith(BASES.qwen)).length;
  const before = hits();
  const result = await llm.complete(user("three"), [], { route: { tier: "strong", provider: "cerebras" } });
  assert.equal(result.provider, "groq");
  assert.equal(hits(), before, "cooled-down providers are not called again");
});

test("when every provider fails the error is friendly with a short per-provider summary", async () => {
  const llm = load(["groq", "cerebras", "mistral"]);
  mockFetch((url) => {
    if (url.startsWith(BASES.groq)) return json({ error: { message: "Rate limit reached on tokens per minute (TPM). Please try again in 50s." } }, 429);
    if (url.startsWith(BASES.cerebras)) return json({ message: "Payment required", code: "payment_required" }, 402);
    return json({ message: "Rate limit exceeded", code: "1300" }, 429);
  });
  await assert.rejects(llm.complete(user("hi")), (error) => {
    assert.ok(error instanceof llm.AllProvidersFailedError);
    assert.ok(error.message.startsWith("All my AI providers are busy or out of free quota, try again in a minute."));
    assert.match(error.message, /groq: rate limited/);
    assert.match(error.message, /cerebras: out of free quota/);
    assert.match(error.message, /mistral: rate limited/);
    assert.ok(!error.message.includes("{"), "no raw JSON in the user-facing message");
    assert.ok(error.message.length < 400);
    assert.match(error.raw, /HTTP 402/);
    return true;
  });
});

test("streaming path: SSE deltas reach the caller and max_tokens is sent", async () => {
  const llm = load(["groq"]);
  const sse = "data: " + JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }) + "\n\ndata: " + JSON.stringify({ choices: [{ delta: { content: "lo" } }] }) + "\n\ndata: [DONE]\n\n";
  const calls = mockFetch(() => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
  let streamed = "";
  const result = await llm.completeStream(user("hi"), [], (text) => { streamed += text; });
  assert.equal(result.content, "Hello");
  assert.equal(streamed, "Hello");
  assert.equal(calls[0].body.stream, true);
  assert.ok(calls[0].body.max_tokens <= 2048);
});

test("retry-after parsing reads headers and Groq-style bodies", () => {
  const llm = load(["groq"]);
  assert.equal(llm.retryAfterMs(new Headers({ "retry-after": "7" }), ""), 7000);
  assert.equal(llm.retryAfterMs(undefined, "Please try again in 7.5s."), 7500);
  assert.equal(llm.retryAfterMs(undefined, "Please try again in 1m2.5s."), 62500);
  assert.equal(llm.retryAfterMs(undefined, "Please try again in 350ms."), 350);
  assert.equal(llm.retryAfterMs(undefined, "nothing here"), undefined);
});
