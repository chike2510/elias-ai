import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function loadTypeScript(sourcePath, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
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

const taskArtifactRequirements = loadTypeScript(path.resolve("lib/taskArtifactRequirements.ts"));
const { calculatorArtifactConsistencyPrompt } = loadTypeScript(path.resolve("lib/artifactPrompt.ts"), {
  "@/lib/taskArtifactRequirements": taskArtifactRequirements,
});

const calculatorTask = "Create calculator.js and calculator.ts plus calculator-guide.pdf as standalone downloadable files.";

function loadAgentWithProviderCapture() {
  const calls = [];
  const agent = loadTypeScript(path.resolve("lib/agent.ts"), {
    "@/lib/artifactPrompt": { calculatorArtifactConsistencyPrompt },
    "@/lib/providers": {
      chooseProvider: async () => "huggingface",
      completeWithProvider: async (request) => {
        calls.push(request);
        return { text: JSON.stringify({ message: "Done.", requests: [], actions: [], done: true }) };
      },
      pickModel: async () => "fixture-model",
      providerOrder: () => [],
    },
  });
  return { agent, calls };
}

function loadCalculator(sourcePath, isTypeScript = false) {
  const source = readFileSync(sourcePath, "utf8");
  const code = isTypeScript
    ? ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    : source;
  const loaded = { exports: {} };
  new Function("module", "exports", code)(loaded, loaded.exports);
  return loaded.exports;
}

const fixtureDirectory = path.resolve("tests/fixtures");
const javascriptCalculator = loadCalculator(path.join(fixtureDirectory, "calculator-contract.js"));
const typescriptCalculator = loadCalculator(path.join(fixtureDirectory, "calculator-contract.ts"), true);
const guide = readFileSync(path.join(fixtureDirectory, "calculator-guide-contract.md"), "utf8");

test("adds the validation contract to the actual task-agent prompt for related calculator files", async () => {
  const { agent, calls } = loadAgentWithProviderCapture();
  await agent.runAgentStep({ task: calculatorTask, taskType: "code", files: [], messages: [], toolResults: [] });

  const systemMessages = calls[0].messages.filter((message) => message.role === "system");
  const contract = systemMessages.map((message) => message.content).join("\n");
  assert.match(contract, /primitive finite JavaScript number/);
  assert.match(contract, /non-number values, NaN, Infinity, and -Infinity with a TypeError/);
  assert.match(contract, /denominator of 0 or -0 with a RangeError/);
  assert.match(contract, /JavaScript and TypeScript operations.*identical/);
  assert.match(contract, /guide must describe the same runtime behavior/);
  assert.match(contract, /arithmetic overflow is rejected/);

  assert.equal(calculatorArtifactConsistencyPrompt("Create a standalone README.md."), "");
  assert.equal(calculatorArtifactConsistencyPrompt("Create calculator.js only."), "");
});

test("JavaScript, TypeScript, and guide claims agree on accepted operands and errors", () => {
  const implementations = [javascriptCalculator, typescriptCalculator];
  const operationNames = Object.keys(javascriptCalculator).sort();
  assert.deepEqual(Object.keys(typescriptCalculator).sort(), operationNames);
  assert.deepEqual(operationNames, ["add", "divide", "multiply", "subtract"]);

  assert.match(guide, /All calculator functions accept only primitive finite JavaScript numbers/);
  assert.match(guide, /string, `NaN`, `Infinity`, or `-Infinity`.*throws a `TypeError`/s);
  assert.match(guide, /denominator of `0` or `-0` throws a `RangeError`/);
  assert.match(guide, /JavaScript and TypeScript files apply the same checks and error types/);
  assert.match(guide, /arithmetic overflow is not separately rejected/);

  const invalidOperands = ["2", NaN, Infinity, -Infinity, new Number(2)];
  for (const calculator of implementations) {
    assert.equal(calculator.add(2, 3), 5);
    assert.equal(calculator.subtract(5, 2), 3);
    assert.equal(calculator.multiply(3, 4), 12);
    assert.equal(calculator.divide(8, 2), 4);

    for (const operation of Object.values(calculator)) {
      for (const invalid of invalidOperands) {
        assert.throws(() => operation(invalid, 1), TypeError);
        assert.throws(() => operation(1, invalid), TypeError);
      }
    }

    assert.throws(() => calculator.divide(4, 0), RangeError);
    assert.throws(() => calculator.divide(4, -0), RangeError);
    assert.throws(() => calculator.divide(Infinity, 0), TypeError);
    assert.equal(calculator.add(Number.MAX_VALUE, Number.MAX_VALUE), Infinity);
  }
});
