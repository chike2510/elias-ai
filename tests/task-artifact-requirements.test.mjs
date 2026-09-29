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

const requirements = loadTypeScript(path.resolve("lib/taskArtifactRequirements.ts"));
const { inferChatTask } = loadTypeScript(path.resolve("lib/chatTaskRouting.ts"), {
  "@/lib/taskArtifactRequirements": requirements,
});
const { inferTaskKind } = loadTypeScript(path.resolve("lib/task.ts"), {
  "@/lib/taskArtifactRequirements": requirements,
});

const objective = `Create three standalone downloadable files: calculator.js, calculator.ts, and calculator-guide.pdf. Add them to the Library; do not run code or access a repository.`;

test("extracts each exact requested deliverable filename once from prose and punctuation", () => {
  assert.deepEqual(requirements.requestedArtifactNames(objective), ["calculator.js", "calculator.ts", "calculator-guide.pdf"]);
  assert.deepEqual(requirements.requestedArtifactNames("Repeat note.md and note.md."), ["note.md"]);
});

test("detects missing files with case-sensitive standalone filenames", () => {
  assert.deepEqual(requirements.missingArtifactNames(["calculator.js", "calculator.ts"], [{ name: "calculator.js" }]), ["calculator.ts"]);
  assert.deepEqual(requirements.missingArtifactNames(["calculator.js"], [{ name: "Calculator.js" }]), ["calculator.js"]);
});

test("routes mixed JS/TS/PDF requests as code, not study, in chat and server inference", () => {
  assert.equal(inferChatTask(objective), "code");
  assert.equal(inferTaskKind(objective), "code");
  assert.equal(inferChatTask("Create study notes as a PDF."), "study");
  assert.equal(inferChatTask("Research current guidance and make a PDF report."), "research");
});
