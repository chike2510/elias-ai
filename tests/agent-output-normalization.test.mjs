import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/agent.ts");

function loadAgent(responseText) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/artifactPrompt") {
      return { calculatorArtifactConsistencyPrompt: () => "" };
    }
    if (request === "@/lib/providers") {
      return {
        chooseProvider: async () => "huggingface",
        completeWithProvider: async () => ({ text: responseText }),
        pickModel: async () => "fixture-model",
        providerOrder: () => [],
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(compiled, sourcePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const input = { task: "Make a plan", taskType: "general", files: [], messages: [], toolResults: [] };

test("explicit done:false is not promoted to a completed step when there are no tools", async () => {
  const { runAgentStep } = loadAgent(JSON.stringify({ message: "I am still organizing the work.", requests: [], actions: [], done: false }));
  const result = await runAgentStep(input);
  assert.equal(result.done, false);
  assert.equal(result.requests.length, 0);
  assert.equal(result.actions.length, 0);
});

test("responses without a done flag retain the legacy tool-free completion default", async () => {
  const { runAgentStep } = loadAgent(JSON.stringify({ message: "The answer is ready.", requests: [], actions: [] }));
  const result = await runAgentStep(input);
  assert.equal(result.done, true);
});
