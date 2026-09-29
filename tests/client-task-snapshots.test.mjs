import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/clientTask.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { mergeTaskSnapshots } = loaded.exports;

function task(id, status, updatedAt, completedSteps, error) {
  return {
    id,
    title: "Generate a photo of a golden retriever puppy playing in a sunlit garden.",
    status,
    updatedAt,
    ...(error ? { error } : {}),
    plan: Array.from({ length: 5 }, (_, index) => ({
      id: `step_${index}`,
      status: index < completedSteps ? "completed" : "pending",
    })),
  };
}

test("server success replaces a stale cached failure for the same task", () => {
  const cachedFailure = task("task_image", "failed", 2_000, 0, "Temporary client-side error");
  const serverSuccess = task("task_image", "completed", 1_000, 3);

  const [merged] = mergeTaskSnapshots([cachedFailure], [serverSuccess]);

  assert.equal(merged, serverSuccess);
  assert.equal(merged.status, "completed");
  assert.equal(merged.plan.filter((step) => step.status === "completed").length, 3);
  assert.equal(merged.error, undefined);
});

test("server failure remains the terminal state when cache still says completed", () => {
  const cachedSuccess = task("task_image", "completed", 2_000, 5);
  const serverFailure = task("task_image", "failed", 1_000, 0, "Provider rejected the generation request");

  const [merged] = mergeTaskSnapshots([cachedSuccess], [serverFailure]);

  assert.equal(merged, serverFailure);
  assert.equal(merged.status, "failed");
  assert.equal(merged.error, "Provider rejected the generation request");
  assert.equal(merged.plan.filter((step) => step.status === "completed").length, 0);
});

test("cache-only tasks remain available while server-only tasks are included and sorted", () => {
  const cachedOnly = task("task_offline", "queued", 1_000, 0);
  const serverOnly = task("task_server", "completed", 3_000, 5);

  const merged = mergeTaskSnapshots([cachedOnly], [serverOnly]);

  assert.deepEqual(merged.map((item) => item.id), ["task_server", "task_offline"]);
});
