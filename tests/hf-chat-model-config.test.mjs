import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/providers.ts");
const originalToken = process.env.HF_TOKEN;
const originalModel = process.env.HF_CHAT_MODEL;
process.env.HF_TOKEN = "hf_synthetic_test_only";
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { pickModel } = loaded.exports;

test("HF Auto defaults to the publicly confirmed Qwen chat model through HF", async () => {
  const originalFetch = globalThis.fetch;
  delete process.env.HF_CHAT_MODEL;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "Qwen/Qwen3.8-27B" }, { id: "Qwen/Qwen3-30B-A3B-Instruct-2507" }, { id: "meta-llama/Llama-3.3-70B-Instruct" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    assert.equal(await pickModel("huggingface", "general"), "Qwen/Qwen3.8-27B:fastest");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HF_CHAT_MODEL pins Auto to an ID from the live Hugging Face chat catalog", async () => {
  const originalFetch = globalThis.fetch;
  const configured = "meta-llama/Llama-3.3-70B-Instruct:fastest";
  process.env.HF_CHAT_MODEL = configured;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://router.huggingface.co/v1/models");
    return new Response(JSON.stringify({ data: [{ id: "meta-llama/Llama-3.3-70B-Instruct" }, { id: "Qwen/Qwen3-30B-A3B-Instruct-2507" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    assert.equal(await pickModel("huggingface", "general"), configured);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HF_CHAT_MODEL is not silently replaced when it is absent from the live catalog", async () => {
  const originalFetch = globalThis.fetch;
  process.env.HF_CHAT_MODEL = "fixture/not-in-catalog";
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: "meta-llama/Llama-3.3-70B-Instruct" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    assert.equal(await pickModel("huggingface", "general"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.after(() => {
  if (originalToken === undefined) delete process.env.HF_TOKEN;
  else process.env.HF_TOKEN = originalToken;
  if (originalModel === undefined) delete process.env.HF_CHAT_MODEL;
  else process.env.HF_CHAT_MODEL = originalModel;
});
