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

const taskFactory = {
  createTask(input) {
    return {
      id: "task_repo_fixture", title: input.title, objective: input.objective, kind: input.kind, taskType: input.taskType,
      status: "queued", createdAt: 1, updatedAt: 1,
      plan: [{ id: "step_1", title: "Inspect", description: "Read", status: "pending", evidenceEventIds: [], createdAt: 1, updatedAt: 1 }],
      permissions: Object.entries(input.permissions).map(([level, granted]) => ({ level, granted, reason: level })),
      approvals: [], checkpoints: [], events: [], artifacts: [], toolResults: [], workspace: input.workspace,
    };
  },
};
const repositoryTask = loadTypeScript(path.resolve("lib/githubRepositoryTask.ts"), { "@/lib/task": taskFactory });

const repo = { owner: "acme", repo: "widget", fullName: "acme/widget", url: "https://github.com/acme/widget", branch: "main", commitSha: "a".repeat(40), defaultBranch: "main", private: true };
const files = [{ path: "src/app.ts", content: "const value = 1;", size: 16 }];

test("repository task starts read-only with the exact selected repo and immutable initial checkpoint", () => {
  const record = repositoryTask.createGitHubRepositoryTaskRecord("user-42", "Change the greeting", repo, files, 100);
  assert.equal(record.userId, "user-42");
  assert.deepEqual(record.task.repository, repo);
  assert.equal(record.task.repository.commitSha, "a".repeat(40));
  assert.deepEqual(record.task.workspace, files);
  assert.deepEqual(record.task.checkpoints[0].files, files);
  assert.equal(record.task.checkpoints[0].label, "Initial repository snapshot");
  const permissions = Object.fromEntries(record.task.permissions.map((item) => [item.level, item.granted]));
  assert.equal(permissions.read, true);
  assert.equal(permissions.write, false);
  assert.equal(permissions.execute, false);
  assert.equal(permissions.external_side_effect, false);
});

test("a repository task is readable only by its owning signed-in user", () => {
  const record = { userId: "user-42" };
  assert.equal(repositoryTask.taskCanBeReadBy(record, "user-42"), true);
  assert.equal(repositoryTask.taskCanBeReadBy(record, "user-99"), false);
  assert.equal(repositoryTask.taskCanBeReadBy(record, ""), false);
});

test("task diff summary stays tied to the initial checkpoint after workspace edits", () => {
  const changes = repositoryTask.repositoryTaskChanges({
    checkpoints: [{ label: "Initial repository snapshot", files: [{ path: "src/app.ts", content: "old" }, { path: "remove.ts", content: "gone" }] }],
    workspace: [{ path: "src/app.ts", content: "new" }, { path: "add.ts", content: "fresh" }],
  });
  assert.deepEqual(changes.map(({ path: file, status }) => [file, status]), [["add.ts", "added"], ["remove.ts", "deleted"], ["src/app.ts", "modified"]]);
});

test("pull-request validation summaries never copy command output into a GitHub description", () => {
  const summary = repositoryTask.summarizeRepositoryValidations([
    { type: "run_validation", result: { check: "typecheck", available: true, passed: true, stdout: "PRIVATE_OUTPUT", stderr: "TOKEN_VALUE" } },
    { type: "run_validation", result: { check: "test", available: false, reason: "Execution is disabled." } },
  ]);
  assert.match(summary, /typecheck: passed/);
  assert.match(summary, /test: not run/);
  assert.doesNotMatch(summary, /PRIVATE_OUTPUT|TOKEN_VALUE|Execution is disabled/);
});
