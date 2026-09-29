import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function loadTsModule(sourcePath, mocks = {}) {
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(compiled, sourcePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const root = path.resolve(".");
const imageHelper = loadTsModule(path.join(root, "lib/huggingfaceImage.ts"));
const modelModule = loadTsModule(path.join(root, "lib/huggingfaceModels.ts"));
const generationModule = loadTsModule(path.join(root, "lib/generationProviders.ts"), {
  "@/lib/huggingfaceModels": modelModule,
  "@/lib/huggingfaceImage": imageHelper,
});
const { submitGenerationJob, getJobStatus } = generationModule;

function saveEnv(key) {
  const value = process.env[key];
  return () => value === undefined ? delete process.env[key] : (process.env[key] = value);
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("Hugging Face image generation uses the official auto-mapped image provider and stores synthetic bytes", async () => {
  const restoreToken = saveEnv("HF_TOKEN");
  const restoreImageModel = saveEnv("HF_IMAGE_MODEL");
  const originalFetch = globalThis.fetch;
  process.env.HF_TOKEN = "hf_synthetic_test_only";
  delete process.env.HF_IMAGE_MODEL;
  const requests = [];
  const prompt = "A golden retriever puppy playing in a sunlit garden";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body, headers: new Headers(init.headers) });
    if (url.includes("/api/models/Qwen/Qwen-Image?expand[]=inferenceProviderMapping")) {
      return jsonResponse({ inferenceProviderMapping: { "fal-ai": { status: "live", providerId: "fal-ai/qwen-image", task: "text-to-image" } } });
    }
    if (url.startsWith("https://router.huggingface.co/fal-ai/") && method === "POST") {
      return jsonResponse({ request_id: "synthetic-job", status: "COMPLETED", response_url: "https://router.huggingface.co/fal-ai/fal-ai/qwen-image" });
    }
    if (url.startsWith("https://router.huggingface.co/fal-ai/") && method === "GET") {
      return jsonResponse({ images: [{ url: "https://mocked-image.invalid/generated.png" }] });
    }
    if (url === "https://mocked-image.invalid/generated.png") {
      return new Response(Uint8Array.of(137, 80, 78, 71), { status: 200, headers: { "content-type": "image/png" } });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  try {
    const jobId = await submitGenerationJob("huggingface", prompt, { type: "image", width: 768, height: 512 });
    const job = await getJobStatus(jobId);
    assert.equal(job.status, "completed");
    assert.equal(job.provider, "huggingface");
    assert.equal(job.model, "Qwen/Qwen-Image");
    assert.equal(job.mimeType, "image/png");
    assert.match(job.assetData, /^data:image\/png;base64,/);
    const imageRequest = requests.find((request) => request.method === "POST");
    assert.equal(imageRequest.headers.get("authorization"), "Bearer hf_synthetic_test_only");
    assert.match(imageRequest.url, /^https:\/\/router\.huggingface\.co\/fal-ai\//);
    assert.doesNotMatch(imageRequest.url, /\/hf-inference\//);
    assert.deepEqual(imageRequest.body, { width: 768, height: 512, prompt });
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreToken();
    restoreImageModel();
  }
});

test("unsupported HF image models fail with a capability-specific message", async () => {
  const restoreToken = saveEnv("HF_TOKEN");
  const restoreImageModel = saveEnv("HF_IMAGE_MODEL");
  const originalFetch = globalThis.fetch;
  process.env.HF_TOKEN = "hf_synthetic_test_only";
  delete process.env.HF_IMAGE_MODEL;
  const model = "fixture/not-a-text-to-image-model";
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes(`/api/models/${model}?expand[]=inferenceProviderMapping`)) {
      return jsonResponse({ inferenceProviderMapping: {} });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  try {
    const jobId = await submitGenerationJob("huggingface", "synthetic prompt", { type: "image", model });
    const job = await getJobStatus(jobId);
    assert.equal(job.status, "failed");
    assert.match(job.error, new RegExp(model.replaceAll("/", "\\/")));
    assert.match(job.error, /not currently available for text-to-image through its Inference Providers mapping/);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreToken();
    restoreImageModel();
  }
});
