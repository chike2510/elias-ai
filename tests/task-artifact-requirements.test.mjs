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
const taskIntent = loadTypeScript(path.resolve("lib/taskIntent.ts"), {
  "@/lib/taskArtifactRequirements": requirements,
});
const { inferChatTask } = loadTypeScript(path.resolve("lib/chatTaskRouting.ts"), {
  "@/lib/taskIntent": taskIntent,
});
const { inferTaskKind, buildPlan, defaultPermissions } = loadTypeScript(path.resolve("lib/task.ts"), {
  "@/lib/taskIntent": taskIntent,
});

const objective = `Create three standalone downloadable files: calculator.js, calculator.ts, and calculator-guide.pdf. Add them to the Library; do not run code or access a repository.`;
const richResearchObjective = `Research and write a current, richly detailed report on Michael Carrick’s football tactics, current role, and latest developments/results as of 2 October 2026. Use live/current research. Cover attacking and defensive shapes, build-up patterns, width, pressing triggers, transitions, role changes, match examples, strengths and vulnerabilities. Verify current status from dated sources, cite direct links, distinguish sourced facts from analysis, and do not guess.`;

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

test("routes rich football research with build-up/developments wording into a research-only plan", () => {
  assert.equal(inferChatTask(richResearchObjective), "research");
  assert.equal(inferTaskKind(richResearchObjective), "research");

  const plan = buildPlan({ objective: richResearchObjective, kind: inferTaskKind(richResearchObjective) }, 1);
  assert.deepEqual(plan.map((step) => step.id.split("_")[0]), ["scope", "search", "read", "synthesize", "deliver"]);
  assert.ok(plan.every((step) => step.requires !== "write" && step.requires !== "execute"));

  const permissions = defaultPermissions({ objective: richResearchObjective, kind: "research" });
  assert.equal(permissions.find((permission) => permission.level === "write")?.granted, false);
  assert.equal(permissions.find((permission) => permission.level === "external_side_effect")?.granted, false);
  assert.equal(permissions.find((permission) => permission.level === "network")?.granted, true);
});

test("keeps explicit app and repository implementation requests on the code path", () => {
  const appRequest = "Build a TypeScript web app with a search form.";
  const repositoryRequest = "Research the current issue, then implement a fix in the GitHub repository.";

  assert.equal(inferChatTask(appRequest), "code");
  assert.equal(inferTaskKind(appRequest), "code");
  assert.equal(inferChatTask(repositoryRequest), "code");
  assert.equal(inferTaskKind(repositoryRequest), "code");

  const plan = buildPlan({ objective: repositoryRequest, kind: inferTaskKind(repositoryRequest) }, 1);
  assert.ok(plan.some((step) => step.id.startsWith("change_") && step.requires === "write"));
  const permissions = defaultPermissions({ objective: repositoryRequest, kind: "code" });
  assert.equal(permissions.find((permission) => permission.level === "write")?.granted, false);
});
