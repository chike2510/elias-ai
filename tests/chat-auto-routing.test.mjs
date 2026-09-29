import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/chat.ts");

function loadChatModule(providerMocks) {
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/providers") return providerMocks;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(compiled, sourcePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const syntheticHFModel = "Qwen/Qwen3.8-27B:fastest";

test("Auto routes through Hugging Face with the Qwen-family model shown separately", async () => {
  const providerCalls = [];
  const mocks = {
    ProviderRequestError: class ProviderRequestError extends Error {
      constructor(details) { super(details.message); this.details = details; }
    },
    pickModel: async (provider) => { providerCalls.push(provider); return provider === "huggingface" ? syntheticHFModel : "should-not-be-selected"; },
    providerDiagnostics: () => ({ huggingface: { configured: true, ok: true, modelCount: 1 } }),
    completeWithProvider: async ({ provider, model }) => {
      providerCalls.push(`${provider}:${model}`);
      return { text: "Synthetic HF-hosted response." };
    },
  };
  const { runChat } = loadChatModule(mocks);
  const result = await runChat({ messages: [{ role: "user", content: "hello" }], task: "general" });
  assert.equal(result.provider, "huggingface");
  assert.equal(result.model, syntheticHFModel);
  assert.equal(result.content, "Synthetic HF-hosted response.");
  assert.deepEqual(providerCalls, ["huggingface", `huggingface:${syntheticHFModel}`]);
});

test("Auto returns a clear HF setup/catalog error and does not fall back when no HF model is available", async () => {
  const providerCalls = [];
  const mocks = {
    ProviderRequestError: class ProviderRequestError extends Error {
      constructor(details) { super(details.message); this.details = details; }
    },
    pickModel: async (provider) => { providerCalls.push(provider); return null; },
    providerDiagnostics: () => ({ huggingface: { configured: true, ok: false, modelCount: 0 } }),
    completeWithProvider: async ({ provider }) => { providerCalls.push(`complete:${provider}`); throw new Error("must not call without a model"); },
  };
  const { runChat } = loadChatModule(mocks);
  await assert.rejects(
    () => runChat({ messages: [{ role: "user", content: "hello" }], task: "general" }),
    (error) => error instanceof mocks.ProviderRequestError && /Hugging Face Auto chat could not load a live chat model/.test(error.message),
  );
  assert.deepEqual(providerCalls, ["huggingface"]);
});
