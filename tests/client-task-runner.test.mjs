import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/clientTaskRunner.ts");
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { continueTaskSteps, selectActiveTaskSnapshot, taskArtifactSyncKey, upsertRecentTaskSnapshot } = loaded.exports;

function makeTask(status = "queued", progress = 0, updatedAt = 1) {
  const now = updatedAt;
  const plan = Array.from({ length: 3 }, (_, index) => ({
    id: `step_${index + 1}`,
    title: `Step ${index + 1}`,
    description: "Mocked step",
    status: index < progress ? "completed" : "pending",
    evidenceEventIds: [],
    createdAt: now,
    updatedAt: now,
  }));
  return { id: "task_progress_fixture", title: "Mocked task", objective: "Create three files", kind: "document", taskType: "general", status, createdAt: 1, updatedAt, plan, permissions: [], approvals: [], checkpoints: [], events: [], artifacts: [], toolResults: [], workspace: [] };
}

test("chat continuation advances one API step at a time, publishes every snapshot, and stops at completion", async () => {
  const responses = [makeTask("queued", 1, 2), makeTask("queued", 2, 3), makeTask("completed", 3, 4)];
  const updates = [];
  let calls = 0;
  const result = await continueTaskSteps(makeTask(), {
    advance: async (task) => {
      assert.equal(task.id, "task_progress_fixture");
      const next = responses[calls];
      calls += 1;
      return next;
    },
    onUpdate: (task) => updates.push(task),
    maxSteps: 12,
  });

  assert.equal(calls, 3);
  assert.deepEqual(updates.map((task) => task.plan.filter((step) => step.status === "completed").length), [1, 2, 3]);
  assert.equal(result.status, "completed");
  assert.equal(updates.at(-1).status, "completed");
});

test("continuation stops immediately for approval and terminal server states", async () => {
  for (const status of ["completed", "cancelled", "waiting_approval"]) {
    let calls = 0;
    const task = makeTask(status);
    const result = await continueTaskSteps(task, { advance: async () => { calls += 1; return task; } });
    assert.equal(calls, 0, `${status} must not advance without user action`);
    assert.equal(result.status, status);
  }
});

test("a failed step stops the loop without relabeling its task as completed", async () => {
  let calls = 0;
  const result = await continueTaskSteps(makeTask(), {
    advance: async () => { calls += 1; return makeTask("failed", 0, 2); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
});

test("recent task updates replace stale snapshots for the same task and sort the latest progress first", () => {
  const stale = makeTask("queued", 0, 1);
  const other = { ...makeTask("queued", 1, 2), id: "task_other" };
  const latest = makeTask("completed", 3, 3);
  const result = upsertRecentTaskSnapshot([stale, other], latest);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, latest.id);
  assert.equal(result[0].status, "completed");
  assert.equal(result[0].plan.filter((step) => step.status === "completed").length, 3);

  const delayedPoll = makeTask("running", 1, 2);
  const afterDelayedPoll = upsertRecentTaskSnapshot(result, delayedPoll);
  assert.equal(afterDelayedPoll.find((task) => task.id === latest.id).status, "completed");
  assert.equal(afterDelayedPoll.find((task) => task.id === latest.id).plan.filter((step) => step.status === "completed").length, 3);

  const sameTimestampPoll = makeTask("queued", 3, 3);
  const afterSameTimestampPoll = upsertRecentTaskSnapshot(result, sameTimestampPoll);
  assert.equal(afterSameTimestampPoll.find((task) => task.id === latest.id).status, "completed");
});

test("active chat snapshots reject stale polls and old task responses but accept explicit task switches", () => {
  const current = makeTask("completed", 3, 10);
  const sameIdStale = makeTask("queued", 3, 9);
  const sameIdSameTime = makeTask("queued", 3, 10);
  const otherOlder = { ...makeTask("running", 1, 8), id: "task_older" };
  const otherNew = { ...makeTask("queued", 0, 11), id: "task_new" };
  const lateOldResponse = makeTask("running", 2, 12);

  assert.equal(selectActiveTaskSnapshot(current, sameIdStale), current);
  assert.equal(selectActiveTaskSnapshot(current, sameIdSameTime), current);
  assert.equal(selectActiveTaskSnapshot(current, otherOlder), current);
  assert.equal(selectActiveTaskSnapshot(otherNew, lateOldResponse, "task_progress_fixture"), otherNew);
  assert.equal(selectActiveTaskSnapshot(current, otherOlder, undefined, true), otherOlder);
});

test("artifact replacement gets a new Library sync key without changing its stable artifact identity", () => {
  const original = taskArtifactSyncKey("task_fixture", { id: "artifact_fixture", createdAt: 10, size: 20 });
  const revised = taskArtifactSyncKey("task_fixture", { id: "artifact_fixture", createdAt: 11, size: 24 });
  assert.notEqual(revised, original);
  assert.equal(revised.split(":").slice(0, 2).join(":"), "task_fixture:artifact_fixture");
});
