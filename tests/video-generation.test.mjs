import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const root = path.resolve(".");
const mp4Fixture = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

function loadTsModule(sourcePath, mocks = {}) {
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(compiled, sourcePath); }
  finally { Module._load = originalLoad; }
  return loaded.exports;
}

function restoreEnv(name) {
  const previous = process.env[name];
  return () => previous === undefined ? delete process.env[name] : (process.env[name] = previous);
}

function makeFixture() {
  const records = new Map();
  const blobs = new Map();
  const module = loadTsModule(path.join(root, "lib/videoGeneration.ts"), {
    "@/lib/task": {
      createTask(input) {
        const now = Date.now();
        return {
          id: "task_video_fixture", title: "Test video", objective: input.objective, kind: "media", taskType: "media",
          status: "queued", createdAt: now, updatedAt: now, plan: ["submit_fixture", "poll_fixture", "deliver_fixture"].map((id) => ({ id, title: id, description: id, status: "pending", evidenceEventIds: [], createdAt: now, updatedAt: now })),
          permissions: [], approvals: [], checkpoints: [], events: [], artifacts: [], toolResults: [], workspace: [],
        };
      },
    },
    "@/lib/taskStore": {
      async createStoredTask(task) { records.set(task.id, structuredClone(task)); return structuredClone(task); },
      async getStoredTask(id) { const task = records.get(id); return task ? structuredClone(task) : undefined; },
      async claimVideoArtifactFinalization(taskId, ownerId, providerJobId) {
        const task = records.get(taskId);
        if (!task || task.ownerId !== ownerId || !task.videoGeneration || task.videoGeneration.providerJobId !== providerJobId || !["queued", "running", "submitting"].includes(task.videoGeneration.status)) return undefined;
        task.videoGeneration.status = "finalizing";
        task.videoGeneration.updatedAt = Date.now();
        records.set(taskId, task);
        return structuredClone(task);
      },
      async updateStoredTask(id, update) {
        const task = records.get(id);
        if (!task) throw new Error("Task not found.");
        const copy = structuredClone(task); update(copy); copy.updatedAt = Date.now(); records.set(id, copy); return structuredClone(copy);
      },
      async setTaskStatus(id, status, error) {
        const task = records.get(id); if (!task) throw new Error("Task not found.");
        task.status = status; task.error = error; task.updatedAt = Date.now();
        if (["completed", "failed", "cancelled"].includes(status)) task.completedAt = Date.now();
        if (status === "running") task.completedAt = undefined;
        records.set(id, task); return structuredClone(task);
      },
      async recordTaskEvent(id, event) {
        const task = records.get(id); if (!task) throw new Error("Task not found.");
        task.events.push({ ...event, id: `evt_${task.events.length + 1}`, taskId: id, createdAt: Date.now() });
        records.set(id, task);
      },
      async storeTaskArtifactBlob(taskId, artifactId, ownerId, mimeType, bytes) {
        const task = records.get(taskId);
        if (!task || task.ownerId !== ownerId) throw new Error("Artifact owner mismatch.");
        blobs.set(`${taskId}:${artifactId}`, { ownerId, mimeType, bytes: Buffer.from(bytes) });
      },
    },
  });
  return { ...module, records, blobs };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function setProviderEnv() {
  const restore = ["ELIAS_VIDEO_API_URL", "ELIAS_VIDEO_API_TOKEN", "ELIAS_VIDEO_MODEL", "NODE_ENV"].map(restoreEnv);
  process.env.ELIAS_VIDEO_API_URL = "https://worker.example.test/v1";
  process.env.ELIAS_VIDEO_API_TOKEN = "synthetic-token-for-tests";
  process.env.ELIAS_VIDEO_MODEL = "test/fixture";
  process.env.NODE_ENV = "test";
  return () => restore.forEach((fn) => fn());
}

const validInput = { prompt: "A cinematic scene of a fictional adult woman exploring an ancient greenhouse", confirmFictionalAdults: true, durationSeconds: 4, width: 512, height: 512 };

async function submitQueued(fixture) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(String(input), "https://worker.example.test/v1/jobs");
    assert.equal(init.method, "POST");
    return jsonResponse({ job_id: "job-fixture-1", status: "queued", progress: 0 }, 202);
  };
  try { return await fixture.startVideoGeneration("user-alice", validInput); }
  finally { globalThis.fetch = originalFetch; }
}

test("submission creates an owner-tagged async job with bounded parameters and a safety policy", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) });
    return jsonResponse({ job_id: "job-fixture-1", status: "queued", progress: 0 }, 202);
  };
  try {
    const task = await fixture.startVideoGeneration("user-alice", validInput);
    assert.equal(task.ownerId, "user-alice");
    assert.equal(task.status, "running");
    assert.equal(task.videoGeneration.status, "queued");
    assert.equal(task.videoGeneration.providerJobId, "job-fixture-1");
    assert.equal(task.plan.find((step) => step.id.startsWith("submit_")).status, "completed");
    assert.equal(task.plan.find((step) => step.id.startsWith("poll_")).status, "active");
    assert.equal(task.artifacts.length, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.get("authorization"), "Bearer synthetic-token-for-tests");
    assert.deepEqual(requests[0].body, {
      prompt: validInput.prompt, duration_seconds: 4, width: 512, height: 512, model: "test/fixture",
      safety: { mode: "fictional_adults_only", require_human_characters_adult: true, allow_image_to_video: false },
    });
    assert.equal(requests[0].url, "https://worker.example.test/v1/jobs");
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("video progress polling is owner-scoped and only contacts the worker for the owner", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  let pollCount = 0;
  try {
    await submitQueued(fixture);
    globalThis.fetch = async (input) => {
      pollCount += 1;
      assert.equal(String(input), "https://worker.example.test/v1/jobs/job-fixture-1");
      return jsonResponse({ status: "running", progress: 46 });
    };
    assert.equal(await fixture.pollVideoGeneration("task_video_fixture", "user-bob"), undefined);
    assert.equal(pollCount, 0);
    const task = await fixture.pollVideoGeneration("task_video_fixture", "user-alice");
    assert.equal(task.videoGeneration.status, "running");
    assert.equal(task.videoGeneration.progress, 46);
    assert.equal(pollCount, 1);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("terminal provider failure is persisted with retryable task status and a failure event", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  try {
    await submitQueued(fixture);
    globalThis.fetch = async () => jsonResponse({ status: "failed", progress: 12, error: "fixture worker failed" });
    const task = await fixture.pollVideoGeneration("task_video_fixture", "user-alice");
    assert.equal(task.videoGeneration.status, "failed");
    assert.match(task.videoGeneration.error, /fixture worker failed/);
    assert.equal(task.status, "failed");
    assert.equal(task.events.at(-1).label, "Video generation failed");
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("provider redirects fail terminally and the worker client does not follow them", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  let pollCount = 0;
  try {
    await submitQueued(fixture);
    globalThis.fetch = async (_input, init = {}) => {
      pollCount += 1;
      assert.equal(init.redirect, "manual");
      return Response.redirect("https://untrusted.example/redirect-target", 302);
    };
    const result = await fixture.pollVideoGeneration("task_video_fixture", "user-alice");
    assert.equal(pollCount, 1);
    assert.equal(result.videoGeneration.status, "failed");
    assert.equal(result.videoGeneration.error, "The configured video worker endpoint redirected. Set ELIAS_VIDEO_API_URL to its final HTTPS URL.");
    assert.equal(result.error, result.videoGeneration.error);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("completed MP4 bytes are stored separately and the task exposes only a Library-compatible artifact reference", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  try {
    await submitQueued(fixture);
    globalThis.fetch = async (input) => String(input).endsWith("/artifact")
      ? new Response(mp4Fixture, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(mp4Fixture.length) } })
      : jsonResponse({ status: "completed", progress: 100 });
    const task = await fixture.pollVideoGeneration("task_video_fixture", "user-alice");
    const artifact = task.artifacts[0];
    assert.equal(task.status, "completed");
    assert.equal(task.videoGeneration.status, "completed");
    assert.equal(artifact.type, "video/mp4");
    assert.equal(task.plan.every((step) => step.status === "completed"), true);
    assert.equal(artifact.encoding, undefined);
    assert.equal(artifact.content, undefined);
    const blob = fixture.blobs.get(`${task.id}:${artifact.id}`);
    assert.equal(blob.ownerId, "user-alice");
    assert.equal(blob.mimeType, "video/mp4");
    assert.deepEqual(blob.bytes, mp4Fixture);

    const library = loadTsModule(path.join(root, "lib/taskArtifactLibrary.ts"));
    let saved;
    const record = await library.syncTaskArtifactToLibrary(task, artifact, {
      fetcher: async (url) => {
        assert.equal(url, `/api/tasks/${task.id}/artifact/${artifact.id}`);
        return new Response(mp4Fixture, { status: 200, headers: { "content-type": "video/mp4" } });
      },
      save: async (item) => { saved = item; },
      maxRetries: 0,
    });
    assert.equal(record.type, "video/mp4");
    assert.equal(record.size, mp4Fixture.length);
    assert.equal(saved.name.endsWith(".mp4"), true);
    assert.deepEqual(Buffer.from(await saved.blob.arrayBuffer()), mp4Fixture);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("duration, dimensions, prompt length, adult-fiction context, and image-to-video inputs are rejected when invalid", () => {
  const restore = setProviderEnv();
  const fixture = makeFixture();
  try {
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, durationSeconds: 5 }), { code: "INVALID_DURATION" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, width: 1024, height: 1024 }), { code: "INVALID_RESOLUTION" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, prompt: "x".repeat(2_001) }), { code: "INVALID_PROMPT" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, prompt: "A fictional teen character in a garden" }), { code: "MINOR_CONTENT_NOT_ALLOWED" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, prompt: "A fictional adult girl in a garden" }), { code: "MINOR_CONTENT_NOT_ALLOWED" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, prompt: "A fictional 17-year-old person in a garden" }), { code: "MINOR_CONTENT_NOT_ALLOWED" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, prompt: "A woman walks through a garden" }), { code: "FICTIONAL_ADULT_PROMPT_REQUIRED" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, prompt: "A fictional adult woman who resembles a celebrity" }), { code: "REAL_PERSON_TARGET_NOT_ALLOWED" });
    assert.throws(() => fixture.validateVideoGenerationInput({ ...validInput, imageUrl: "https://example.test/image.png" }), { code: "IMAGE_TO_VIDEO_NOT_SUPPORTED" });
    assert.equal(fixture.validateVideoGenerationInput(validInput).durationSeconds, 4);
  } finally { restore(); }
});

test("expired video jobs fail at the 20-minute bound without contacting a provider", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  try {
    await submitQueued(fixture);
    const task = fixture.records.get("task_video_fixture");
    task.videoGeneration.createdAt = Date.now() - fixture.VIDEO_GENERATION_LIMITS.maxJobAgeMs - 1;
    fixture.records.set(task.id, task);
    globalThis.fetch = async () => { throw new Error("expired job must not poll"); };
    const result = await fixture.pollVideoGeneration(task.id, "user-alice");
    assert.equal(result.status, "failed");
    assert.match(result.videoGeneration.error, /20-minute job limit/);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("oversized artifact response becomes a terminal failure and is never stored", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  try {
    await submitQueued(fixture);
    globalThis.fetch = async (input) => String(input).endsWith("/artifact")
      ? new Response(null, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(16 * 1024 * 1024 + 1) } })
      : jsonResponse({ status: "completed", progress: 100 });
    const task = await fixture.pollVideoGeneration("task_video_fixture", "user-alice");
    assert.equal(task.status, "failed");
    assert.match(task.videoGeneration.error, /16 MB storage limit/);
    assert.equal(fixture.blobs.size, 0);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("failed jobs allow at most two explicit-confirmation retries", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  try {
    await submitQueued(fixture);
    globalThis.fetch = async () => jsonResponse({ status: "failed", error: "first attempt failed" });
    await fixture.pollVideoGeneration("task_video_fixture", "user-alice");
    await assert.rejects(fixture.retryVideoGeneration("task_video_fixture", "user-alice", false), { code: "FICTIONAL_ADULTS_CONFIRMATION_REQUIRED" });

    let jobNumber = 1;
    globalThis.fetch = async (input, init = {}) => {
      if (init.method === "POST") return jsonResponse({ job_id: `job-fixture-${++jobNumber}`, status: "queued", progress: 0 }, 202);
      return jsonResponse({ status: "failed", error: "retry failed" });
    };
    let task = await fixture.retryVideoGeneration("task_video_fixture", "user-alice", true);
    assert.equal(task.videoGeneration.retryCount, 1);
    assert.equal(task.videoGeneration.status, "queued");
    await fixture.pollVideoGeneration(task.id, "user-alice");
    task = await fixture.retryVideoGeneration(task.id, "user-alice", true);
    assert.equal(task.videoGeneration.retryCount, 2);
    await fixture.pollVideoGeneration(task.id, "user-alice");
    await assert.rejects(fixture.retryVideoGeneration(task.id, "user-alice", true), { code: "VIDEO_RETRY_LIMIT_REACHED" });
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("task artifact route serves stored MP4 only to the owning signed-in session", async () => {
  let signedInAs = "user-alice";
  const task = {
    id: "task_video_fixture",
    videoGeneration: { status: "completed", artifactId: "artifact_fixture" },
    artifacts: [{ id: "artifact_fixture", name: "result.mp4", type: "video/mp4", size: mp4Fixture.length }],
  };
  let blobReads = 0;
  const route = loadTsModule(path.join(root, "app/api/tasks/[taskId]/artifact/[artifactId]/route.ts"), {
    "@/lib/auth": { async getSession() { return { userId: signedInAs }; } },
    "@/lib/taskOrchestrator": { async getTaskForUser(taskId, userId) { return taskId === task.id && userId === "user-alice" ? task : undefined; } },
    "@/lib/taskStore": { async getTaskArtifactBlob(taskId, artifactId, ownerId) {
      blobReads += 1;
      assert.deepEqual([taskId, artifactId, ownerId], [task.id, "artifact_fixture", "user-alice"]);
      return mp4Fixture;
    } },
  });
  const context = { params: Promise.resolve({ taskId: task.id, artifactId: "artifact_fixture" }) };
  const allowed = await route.GET(new Request("https://elias.example/api/tasks/task_video_fixture/artifact/artifact_fixture"), context);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("content-type"), "video/mp4");
  assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), mp4Fixture);
  assert.equal(blobReads, 1);

  signedInAs = "user-bob";
  const denied = await route.GET(new Request("https://elias.example/api/tasks/task_video_fixture/artifact/artifact_fixture"), context);
  assert.equal(denied.status, 404);
  assert.equal(blobReads, 1);
});

test("concurrent completed-status polls claim finalization once and store one artifact", async () => {
  const restore = setProviderEnv();
  const originalFetch = globalThis.fetch;
  const fixture = makeFixture();
  let artifactDownloads = 0;
  try {
    await submitQueued(fixture);
    globalThis.fetch = async (input) => {
      if (String(input).endsWith("/artifact")) {
        artifactDownloads += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return new Response(mp4Fixture, { status: 200, headers: { "content-type": "video/mp4" } });
      }
      return jsonResponse({ status: "completed", progress: 100 });
    };
    await Promise.all([
      fixture.pollVideoGeneration("task_video_fixture", "user-alice"),
      fixture.pollVideoGeneration("task_video_fixture", "user-alice"),
    ]);
    const task = fixture.records.get("task_video_fixture");
    assert.equal(artifactDownloads, 1);
    assert.equal(task.artifacts.length, 1);
    assert.equal(task.events.filter((event) => event.label === "MP4 artifact stored").length, 1);
    assert.equal(task.videoGeneration.status, "completed");
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("local task storage grants only one owner-matched finalization claim", async () => {
  const restore = ["ELIAS_TASK_STORE_PATH", "POSTGRES_URL", "VERCEL"].map(restoreEnv);
  const previousStore = globalThis.__eliasTaskStore;
  const previousLocks = globalThis.__eliasVideoFinalizing;
  const directory = mkdtempSync(path.join(tmpdir(), "elias-video-store-"));
  process.env.ELIAS_TASK_STORE_PATH = path.join(directory, "tasks.json");
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  globalThis.__eliasTaskStore = undefined;
  globalThis.__eliasVideoFinalizing = undefined;
  const store = loadTsModule(path.join(root, "lib/taskStore.ts"), {
    postgres: () => { throw new Error("database should not be used in local-store test"); },
    "@/lib/task": { taskSnapshot: (task) => ({ task, events: task.events, checkpoints: task.checkpoints, approvals: task.approvals }) },
  });
  const task = {
    id: "task_local_fixture", title: "Local video", objective: "test", kind: "media", taskType: "media", ownerId: "user-alice", status: "running",
    createdAt: Date.now(), updatedAt: Date.now(), plan: [], permissions: [], approvals: [], checkpoints: [], events: [], artifacts: [], toolResults: [], workspace: [],
    videoGeneration: { status: "running", prompt: validInput.prompt, durationSeconds: 4, width: 512, height: 512, progress: 20, providerJobId: "local-job", artifactId: "artifact_local", createdAt: Date.now(), updatedAt: Date.now(), retryCount: 0 },
  };
  try {
    await store.createStoredTask(task);
    assert.equal(await store.claimVideoArtifactFinalization(task.id, "user-bob", "local-job"), undefined);
    assert.equal(await store.claimVideoArtifactFinalization(task.id, "user-alice", "wrong-job"), undefined);
    const claims = await Promise.all([
      store.claimVideoArtifactFinalization(task.id, "user-alice", "local-job"),
      store.claimVideoArtifactFinalization(task.id, "user-alice", "local-job"),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await store.getStoredTask(task.id)).videoGeneration.status, "finalizing");
  } finally {
    globalThis.__eliasTaskStore = previousStore;
    globalThis.__eliasVideoFinalizing = previousLocks;
    restore.forEach((fn) => fn());
    rmSync(directory, { recursive: true, force: true });
  }
});
