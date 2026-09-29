import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function loadTypeScript(sourcePath, mocks = {}) {
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

const exactObjective = `Please create three standalone downloadable files in this conversation and add them to the Library:
- calculator.js, a simple browser calculator in JavaScript with add and subtract functions.
- calculator.ts, the typed equivalent with clear input and result types.
- calculator-guide.pdf, a short, readable guide explaining both functions, their arguments, results, and examples.
Please deliver actual files/artifacts with these exact filenames, not code pasted only in chat. Do not execute the generated code, access any repository, or alter existing files/artifacts. Show preview and download controls if available.`;

const repositoryIntentPath = path.resolve("lib/repositoryIntent.ts");
const { referencesRepository } = loadTypeScript(repositoryIntentPath);

const artifacts = await import(pathToFileURL(path.resolve("lib/artifacts.ts")).href);
const taskArtifactLibraryPath = path.resolve("lib/taskArtifactLibrary.ts");
const { syncTaskArtifactToLibrary } = loadTypeScript(taskArtifactLibraryPath);

function makeTaskStore(task) {
  const clone = () => structuredClone(task);
  return {
    getStoredTask: async (id) => id === task.id ? clone() : undefined,
    setTaskStatus: async (id, status, error) => {
      assert.equal(id, task.id);
      task.status = status;
      task.error = error;
      if (["completed", "failed", "cancelled"].includes(status)) task.completedAt = Date.now();
      return clone();
    },
    updateStoredTask: async (id, update) => {
      assert.equal(id, task.id);
      update(task);
      return clone();
    },
    recordTaskEvent: async (id, activity) => {
      assert.equal(id, task.id);
      const event = { id: `evt_${task.events.length + 1}`, taskId: id, createdAt: Date.now(), ...activity };
      task.events.push(event);
      if (event.stepId) {
        const step = task.plan.find((item) => item.id === event.stepId);
        if (step) step.evidenceEventIds.push(event.id);
      }
      return event;
    },
    recordToolResult: async (id, result) => {
      assert.equal(id, task.id);
      task.toolResults.push(result);
      return result;
    },
    requestTaskApproval: async () => { throw new Error("Artifact creation should not request an additional approval."); },
    createTaskCheckpoint: async () => { throw new Error("Artifact creation must not mutate a workspace."); },
    restoreTaskCheckpoint: async () => undefined,
    grantTaskPermission: async () => undefined,
    resolveTaskApproval: async () => undefined,
  };
}

function makeTask(objective) {
  const now = Date.now();
  return {
    id: "task_standalone_artifacts",
    title: "Create standalone calculator files",
    objective,
    kind: "document",
    taskType: "general",
    status: "queued",
    conversationId: "chat_standalone_artifacts",
    createdAt: now,
    updatedAt: now,
    plan: [{ id: "step_create_files", title: "Create requested files", description: "Create deliverables without accessing a repository.", status: "pending", evidenceEventIds: [], createdAt: now, updatedAt: now }],
    permissions: [
      { level: "read", granted: true, reason: "Read supplied context only." },
      { level: "write", granted: false, reason: "Do not mutate a workspace." },
      { level: "artifact", granted: true, reason: "Create requested downloadable artifacts." },
      { level: "network", granted: false, reason: "No network access requested." },
      { level: "execute", granted: false, reason: "Do not execute generated code." },
      { level: "external_side_effect", granted: false, reason: "No external side effects requested." },
    ],
    approvals: [],
    checkpoints: [],
    events: [],
    artifacts: [],
    toolResults: [],
    workspace: [],
  };
}

function loadOrchestrator({ taskStore, runAgentStep, repositoryCalls }) {
  const sourcePath = path.resolve("lib/taskOrchestrator.ts");
  return loadTypeScript(sourcePath, {
    "@/lib/webSearch": { fetchUrl: async () => "", searchWeb: async () => [] },
    "@/lib/execution": { runWorkspaceValidation: async () => { throw new Error("Validation was not requested."); } },
    "@/lib/repositoryIntent": { referencesRepository },
    "@/lib/task": { buildPlan: () => [], createTask: () => ({}), inferTaskKind: () => "document", inferTaskType: () => "general" },
    "@/lib/taskStore": taskStore,
    "@/lib/agent": { runAgentStep },
    "@/lib/artifacts": artifacts,
    "@/lib/browser/browserManager": { performBrowserAction: async () => { throw new Error("Browser access was not requested."); } },
    "@/lib/auth": { getSession: async () => { repositoryCalls.session += 1; return {}; } },
    "@/lib/githubConnectionStore": { getGitHubToken: async () => { repositoryCalls.token += 1; return null; } },
  });
}

test("repository intent ignores the exact explicit prohibition while preserving affirmative repository work", () => {
  assert.equal(referencesRepository(exactObjective), false);
  assert.equal(referencesRepository("Please open the repository at https://github.com/acme/calculator and implement the requested fix."), true);
  assert.equal(referencesRepository("Do not access any repository. Instead, create a standalone PDF report."), false);
  assert.equal(referencesRepository("No repository is needed; write the requested guide as a PDF."), false);
});

test("standalone chat artifacts create exact JS, TS, and PDF files and sync them into Library without GitHub or execution", async () => {
  const task = makeTask(exactObjective);
  const taskStore = makeTaskStore(task);
  const repositoryCalls = { session: 0, token: 0 };
  const requests = [
    { id: "artifact_js", type: "create_artifact", name: "calculator.js", content: "function add(a, b) { return a + b; }\nfunction subtract(a, b) { return a - b; }" },
    { id: "artifact_ts", type: "create_artifact", name: "calculator.ts", content: "export function add(a: number, b: number): number { return a + b; }\nexport function subtract(a: number, b: number): number { return a - b; }" },
    { id: "artifact_pdf", type: "create_artifact", name: "calculator-guide.pdf", content: "# Calculator guide\n\nThe add function accepts two numbers and returns their sum. The subtract function accepts two numbers and returns the first minus the second. Example: add(2, 3) returns 5; subtract(5, 2) returns 3." },
  ];
  let agentCalls = 0;
  const { runTaskStep } = loadOrchestrator({
    taskStore,
    repositoryCalls,
    runAgentStep: async () => {
      agentCalls += 1;
      return { ok: true, provider: "test", model: "fixture", message: "Creating the requested standalone files.", requests, actions: [], done: false };
    },
  });

  const result = await runTaskStep(task.id);
  assert.equal(result.status, "queued");
  assert.equal(agentCalls, 1);
  assert.equal(repositoryCalls.session, 0);
  assert.equal(repositoryCalls.token, 0);
  assert.equal(task.workspace.length, 0);
  assert.equal(task.checkpoints.length, 0);
  assert.equal(task.toolResults.length, 3);
  assert.deepEqual(task.artifacts.map((artifact) => artifact.name), ["calculator.js", "calculator.ts", "calculator-guide.pdf"]);
  assert.equal(task.artifacts.find((artifact) => artifact.name === "calculator.js").type, "text/javascript; charset=utf-8");
  assert.equal(task.artifacts.find((artifact) => artifact.name === "calculator.ts").type, "text/typescript; charset=utf-8");

  const savedRecords = [];
  for (const artifact of task.artifacts) {
    const saved = await syncTaskArtifactToLibrary(task, artifact, {
      fetcher: async (requestPath, options) => {
        assert.equal(options.cache, "no-store");
        assert.equal(requestPath, `/api/tasks/${task.id}/artifact/${artifact.id}`);
        const body = artifact.encoding === "base64" ? Buffer.from(artifact.content, "base64") : artifact.content;
        return new Response(body, { status: 200, headers: { "content-type": artifact.type } });
      },
      save: async (record) => savedRecords.push(record),
    });
    assert.equal(saved.name, artifact.name);
  }

  assert.deepEqual(savedRecords.map((record) => record.name), ["calculator.js", "calculator.ts", "calculator-guide.pdf"]);
  assert.match(savedRecords.find((record) => record.name === "calculator.js").text, /function add/);
  assert.match(savedRecords.find((record) => record.name === "calculator.ts").text, /number/);
  const pdf = savedRecords.find((record) => record.name === "calculator-guide.pdf");
  assert.equal(pdf.type, "application/pdf");
  assert.equal(pdf.text, undefined);
  assert.ok(pdf.size > 100);
  assert.match(Buffer.from(await pdf.blob.arrayBuffer()).toString("ascii", 0, 5), /^%PDF-/);
});
