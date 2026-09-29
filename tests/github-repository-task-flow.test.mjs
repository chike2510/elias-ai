import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
function loadTypeScript(sourcePath, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) { if (Object.hasOwn(mocks, request)) return mocks[request]; return originalLoad.call(this, request, parent, isMain); };
  try { loaded._compile(compiled, sourcePath); } finally { Module._load = originalLoad; }
  return loaded.exports;
}

function createFixture({ write = false, execute = false, initialFiles } = {}) {
  const files = initialFiles || [{ path: "src/app.ts", content: "const greeting = 'old';", size: 23 }];
  const permissions = ["read", "write", "artifact", "network", "execute", "external_side_effect"].map((level) => ({ level, granted: level === "read" || (level === "write" && write) || (level === "execute" && execute), reason: level }));
  return {
    id: "task_repo_flow", userId: "owner-user", updatedAt: 1,
    task: {
      id: "task_repo_flow", title: "Update greeting", objective: "Update the greeting", kind: "code", taskType: "code", status: "queued", createdAt: 1, updatedAt: 1,
      repository: { owner: "acme", repo: "widget", fullName: "acme/widget", url: "https://github.com/acme/widget", branch: "main", commitSha: "a".repeat(40), defaultBranch: "main", private: true },
      startedAt: undefined, completedAt: undefined, plan: [{ id: "step_1", title: "Implement", description: "Edit", status: "pending", evidenceEventIds: [], createdAt: 1, updatedAt: 1 }],
      permissions, approvals: [], checkpoints: [{ id: "initial", taskId: "task_repo_flow", label: "Initial repository snapshot", reason: "manual", createdAt: 1, files: structuredClone(files) }],
      events: [], artifacts: [], toolResults: [], workspace: structuredClone(files),
    },
  };
}

function setup({ write = false, execute = false, response, validation, initialFiles } = {}) {
  let stored = createFixture({ write, execute, initialFiles });
  const requests = Array.isArray(response) ? [...response] : [response || { message: "Done.", requests: [], actions: [], done: true }];
  const calls = { agent: 0, validation: 0 };
  const store = {
    async getGitHubRepositoryTask(id, userId) { return id === stored.id && userId === stored.userId ? structuredClone(stored) : undefined; },
    async claimGitHubRepositoryTaskStep(id, userId) {
      if (id !== stored.id || userId !== stored.userId || !["queued", "planning", "paused", "failed"].includes(stored.task.status) || stored.task.approvals.some((item) => item.status === "pending")) return undefined;
      stored = structuredClone(stored); stored.task.status = "running"; return structuredClone(stored);
    },
    async updateGitHubRepositoryTask(id, userId, update) {
      if (id !== stored.id || userId !== stored.userId) throw new Error("Repository task not found.");
      const next = structuredClone(stored); update(next); next.updatedAt += 1; stored = next; return structuredClone(stored);
    },
  };
  const workspace = loadTypeScript(path.resolve("lib/githubRepositoryWorkspace.ts"));
  const changes = (task) => {
    const before = new Map(task.checkpoints[0].files.map((file) => [file.path, file.content]));
    const after = new Map(task.workspace.map((file) => [file.path, file.content]));
    return [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file));
  };
  const runner = loadTypeScript(path.resolve("lib/githubRepositoryTaskRunner.ts"), {
    "@/lib/webSearch": { fetchUrl: async () => "", searchWeb: async () => [] },
    "@/lib/execution": { runWorkspaceValidation: async (_files, check) => { calls.validation += 1; return validation || { type: "run_validation", result: { check, available: true, passed: true } }; } },
    "@/lib/agent": { runAgentStep: async () => { calls.agent += 1; return structuredClone(requests[0] || { message: "Done.", requests: [], actions: [], done: true }); } },
    "@/lib/githubRepositoryWorkspace": workspace,
    "@/lib/githubRepositoryTask": { repositoryTaskChanges: changes },
    "@/lib/githubRepositoryTaskStore": store,
  });
  return { runner, store, calls, get stored() { return structuredClone(stored); } };
}

test("file edits stop for task permission and complete only after approval and recorded change", async () => {
  const harness = setup({ response: { message: "I will update the greeting.", requests: [], actions: [{ type: "write_file", path: "src/app.ts", content: "const greeting = 'new';" }], done: true } });
  let task = await harness.runner.runGitHubRepositoryTaskStep("task_repo_flow", "owner-user");
  assert.equal(task.status, "waiting_approval");
  assert.equal(task.workspace[0].content, "const greeting = 'old';");
  const approval = task.approvals.find((item) => item.status === "pending");
  assert.equal(approval.permission, "write");
  await harness.runner.resolveGitHubRepositoryTaskApproval(task.id, "owner-user", approval.id, true);
  task = await harness.runner.runGitHubRepositoryTaskStep(task.id, "owner-user");
  assert.equal(task.status, "completed");
  assert.equal(task.workspace[0].content, "const greeting = 'new';");
  assert.ok(task.events.some((item) => item.label === "Repository task complete"));
  assert.ok(task.events.some((item) => item.kind === "action" && item.label === "Repository workspace changed"));
  assert.equal(task.permissions.find((item) => item.level === "external_side_effect").granted, false);
});

test("validation commands do not run before their own approval and successful evidence is recorded", async () => {
  const harness = setup({ response: { message: "I will check the repository.", requests: [{ type: "run_validation", check: "typecheck" }], actions: [], done: true } });
  let task = await harness.runner.runGitHubRepositoryTaskStep("task_repo_flow", "owner-user");
  assert.equal(task.status, "waiting_approval");
  assert.equal(task.approvals.at(-1).permission, "execute");
  assert.equal(harness.calls.validation, 0);
  await harness.runner.resolveGitHubRepositoryTaskApproval(task.id, "owner-user", task.approvals.at(-1).id, true);
  task = await harness.runner.runGitHubRepositoryTaskStep(task.id, "owner-user");
  assert.equal(harness.calls.validation, 1);
  assert.equal(task.status, "completed");
  assert.equal(task.toolResults.at(-1).result.passed, true);
});

test("a failed validation is recorded and cannot be reported as completed", async () => {
  const failedValidation = { type: "run_validation", result: { check: "lint", available: true, passed: false }, error: "lint failed" };
  const harness = setup({ execute: true, validation: failedValidation, response: { message: "Checking the source.", requests: [{ type: "run_validation", check: "lint" }], actions: [], done: true } });
  const task = await harness.runner.runGitHubRepositoryTaskStep("task_repo_flow", "owner-user");
  assert.equal(task.status, "queued");
  assert.equal(task.plan[0].status, "active");
  assert.equal(task.toolResults.at(-1).result.passed, false);
  assert.equal(task.completedAt, undefined);
});

test("unsafe workspace paths fail closed and cannot complete the plan", async () => {
  const harness = setup({ write: true, response: { message: "I will write a file.", requests: [], actions: [{ type: "write_file", path: "../outside.ts", content: "unsafe" }], done: true } });
  const task = await harness.runner.runGitHubRepositoryTaskStep("task_repo_flow", "owner-user");
  assert.equal(task.status, "queued");
  assert.equal(task.workspace.length, 1);
  assert.equal(task.workspace[0].content, "const greeting = 'old';");
  assert.ok(task.events.some((item) => item.label === "Repository action rejected"));
});

test("repository task mutations enforce file-count and total workspace size bounds", async () => {
  const fileCountFixture = setup({ write: true, initialFiles: Array.from({ length: 64 }, (_, index) => ({ path: `src/file-${index}.ts`, content: "x", size: 1 })), response: { message: "Add a file.", requests: [], actions: [{ type: "write_file", path: "src/new.ts", content: "x" }], done: true } });
  const fileCountTask = await fileCountFixture.runner.runGitHubRepositoryTaskStep(fileCountFixture.stored.id, fileCountFixture.stored.userId);
  assert.equal(fileCountTask.status, "queued");
  assert.equal(fileCountTask.workspace.length, 64);
  assert.match(fileCountTask.events.find((item) => item.label === "Repository action rejected").detail, /workspace file or size limits/i);

  const totalCharsFixture = setup({ write: true, initialFiles: Array.from({ length: 7 }, (_, index) => ({ path: `src/file-${index}.ts`, content: "x".repeat(160_000), size: 160_000 })), response: { message: "Add a bounded file.", requests: [], actions: [{ type: "write_file", path: "src/new.ts", content: "x".repeat(80_001) }], done: true } });
  const totalCharsTask = await totalCharsFixture.runner.runGitHubRepositoryTaskStep(totalCharsFixture.stored.id, totalCharsFixture.stored.userId);
  assert.equal(totalCharsTask.status, "queued");
  assert.equal(totalCharsTask.workspace.length, 7);
  assert.match(totalCharsTask.events.find((item) => item.label === "Repository action rejected").detail, /workspace file or size limits/i);
});
