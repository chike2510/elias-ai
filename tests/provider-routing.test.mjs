import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/providers.ts");

function loadProviderModule() {
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

process.env.HF_TOKEN = "synthetic-hf-token-for-tests";
process.env.QWEN_API_KEY = "synthetic-qwen-token-for-tests";
delete process.env.OPENROUTER_API_KEY;
delete process.env.CEREBRAS_API_KEY;
const providers = loadProviderModule();

test("Hugging Face is first for every automatic task route and retired providers are absent", () => {
  for (const task of ["general", "code", "research", "study"]) {
    const order = providers.providerOrder(task, 9);
    assert.equal(order[0], "huggingface", `${task} should try Hugging Face first`);
    assert.equal(order.includes("openrouter"), false);
    assert.equal(order.includes("cerebras"), false);
  }
});

test("Hugging Face model discovery and completion accept synthetic provider responses", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "Qwen/Qwen3-30B-A3B-Instruct-2507:fastest" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Synthetic Hugging Face response." }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected mocked URL: ${url}`);
  };

  try {
    const models = await providers.listModels("huggingface");
    assert.deepEqual(models.map((model) => model.id), ["Qwen/Qwen3-30B-A3B-Instruct-2507:fastest"]);
    const response = await providers.completeWithProvider({
      provider: "huggingface",
      model: models[0].id,
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(response.text, "Synthetic Hugging Face response.");
    assert.equal(requests.length, 2);
    assert.equal(new Headers(requests[0].options.headers).get("authorization"), "Bearer synthetic-hf-token-for-tests");
    assert.equal(new Headers(requests[1].options.headers).get("authorization"), "Bearer synthetic-hf-token-for-tests");
    assert.equal(new Headers(requests[1].options.headers).has("http-referer"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hugging Face request puts merged system instructions first and preserves conversation turn order", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  const messages = [
    { role: "system", content: "ELIAS base instructions." },
    { role: "system", content: "Runtime task context." },
    { role: "user", content: "First user turn." },
    { role: "assistant", content: "First assistant turn." },
    { role: "system", content: "Repository and skill context appended by runtime." },
    { role: "user", content: "Second user turn." },
    { role: "assistant", content: "Second assistant turn." },
    { role: "system", content: "Late live-evidence context." },
  ];
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://router.huggingface.co/v1/chat/completions");
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Synthetic response." } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await providers.completeWithProvider({ provider: "huggingface", model: "Qwen/Qwen3.8-27B:fastest", messages });
    assert.deepEqual(requestBody.messages, [
      {
        role: "system",
        content: [
          "ELIAS base instructions.",
          "Runtime task context.",
          "Repository and skill context appended by runtime.",
          "Late live-evidence context.",
        ].join("\n\n"),
      },
      { role: "user", content: "First user turn." },
      { role: "assistant", content: "First assistant turn." },
      { role: "user", content: "Second user turn." },
      { role: "assistant", content: "Second assistant turn." },
    ]);
    assert.deepEqual(requestBody.messages.map((message) => message.role), ["system", "user", "assistant", "user", "assistant"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-Hugging Face provider request message order is unchanged", async () => {
  const originalFetch = globalThis.fetch;
  const messages = [
    { role: "user", content: "A user turn." },
    { role: "system", content: "Provider-specific context." },
    { role: "assistant", content: "An assistant turn." },
  ];
  let requestBody;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Synthetic response." } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await providers.completeWithProvider({ provider: "qwen", model: "synthetic-model", messages });
    assert.deepEqual(requestBody.messages, messages);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
