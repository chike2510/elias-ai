import assert from "node:assert/strict";
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

const makeTask = (id, repository) => ({ id, title: id, objective: "test", kind: "code", taskType: "code", status: "queued", updatedAt: Date.now(), plan: [], permissions: [], approvals: [], checkpoints: [], events: [], artifacts: [], toolResults: [], workspace: [], ...(repository ? { repository } : {}) });

test("private repository task snapshots never enter generic local task history", () => {
  const oldWindow = globalThis.window;
  const records = new Map();
  globalThis.window = { localStorage: {
    setItem: (key, value) => records.set(key, value),
    getItem: (key) => records.get(key) || null,
    key: (index) => [...records.keys()][index] || null,
    get length() { return records.size; },
  } };
  try {
    const clientTask = loadTypeScript(path.resolve("lib/clientTask.ts"));
    const repoTask = makeTask("private-repo-task", { owner: "acme", repo: "widget", fullName: "acme/widget", url: "https://github.com/acme/widget", branch: "main", commitSha: "a".repeat(40), defaultBranch: "main", private: true });
    clientTask.cacheTaskSnapshot(repoTask);
    assert.equal(records.size, 0);
    records.set("elias:task:old-private-task", JSON.stringify(repoTask));
    assert.equal(clientTask.getCachedTaskSnapshot("old-private-task"), null);
    assert.deepEqual(clientTask.listCachedTaskSnapshots(), []);
    clientTask.cacheTaskSnapshot(makeTask("ordinary-task"));
    assert.equal(clientTask.listCachedTaskSnapshots().map((task) => task.id).join(","), "ordinary-task");
  } finally { globalThis.window = oldWindow; }
});
