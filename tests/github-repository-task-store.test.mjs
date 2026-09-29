import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
function loadTypeScript(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath); loaded.filename = sourcePath; loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath)); loaded._compile(compiled, sourcePath); return loaded.exports;
}

test("repository task reads and updates are isolated to the signed-in owner", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "elias-repo-task-store-"));
  const oldPath = process.env.ELIAS_GITHUB_REPOSITORY_TASKS_PATH;
  const oldPostgres = process.env.POSTGRES_URL;
  const oldVercel = process.env.VERCEL;
  process.env.ELIAS_GITHUB_REPOSITORY_TASKS_PATH = join(directory, "tasks.json");
  delete process.env.POSTGRES_URL; delete process.env.VERCEL;
  globalThis.__eliasGitHubRepositoryTaskStore = undefined;
  const store = loadTypeScript(path.resolve("lib/githubRepositoryTaskStore.ts"));
  t.after(() => {
    if (oldPath === undefined) delete process.env.ELIAS_GITHUB_REPOSITORY_TASKS_PATH; else process.env.ELIAS_GITHUB_REPOSITORY_TASKS_PATH = oldPath;
    if (oldPostgres === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = oldPostgres;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    globalThis.__eliasGitHubRepositoryTaskStore = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  const task = { id: "task_store_fixture", status: "queued", workspace: [], events: [] };
  await store.createGitHubRepositoryTask({ id: task.id, userId: "alice", task, updatedAt: 1 });
  assert.equal((await store.getGitHubRepositoryTask(task.id, "alice")).task.id, task.id);
  assert.equal(await store.getGitHubRepositoryTask(task.id, "bob"), undefined);
  await assert.rejects(() => store.updateGitHubRepositoryTask(task.id, "bob", (record) => { record.task.status = "completed"; }), /not found/i);
  const concurrentClaims = await Promise.all([store.claimGitHubRepositoryTaskStep(task.id, "alice"), store.claimGitHubRepositoryTaskStep(task.id, "alice")]);
  assert.equal(concurrentClaims.filter(Boolean).length, 1);
  assert.equal(await store.claimGitHubRepositoryTaskStep(task.id, "bob"), undefined);
  assert.equal((await store.getGitHubRepositoryTask(task.id, "alice")).task.status, "running");
  const updated = await store.updateGitHubRepositoryTask(task.id, "alice", (record) => { record.task.status = "completed"; });
  assert.equal(updated.task.status, "completed");
  assert.equal((await store.getGitHubRepositoryTask(task.id, "bob")), undefined);
});
