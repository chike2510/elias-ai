import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("app/api/generation/route.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute(outcome) {
  const state = {
    task: undefined,
    createdInput: undefined,
    statusTransitions: [],
    events: [],
    outcome,
  };
  const mocks = {
    "@/lib/auth": { getSession: async () => ({ userId: "user_fixture" }) },
    "@/lib/artifacts": { artifactMime: () => "image/png" },
    "@/lib/generationProviders": {
      submitGenerationJob: async () => "generation_fixture",
      getJobStatus: async () => state.outcome,
    },
    "@/lib/http": {
      jsonError: (message, status = 500, code, details) => Response.json({ error: { message, code }, details }, { status }),
      jsonOk: (value, init) => Response.json(value, init),
      readJsonRequest: async (request) => request.json(),
    },
    "@/lib/taskOrchestrator": {
      createTaskRecord: async (input) => {
        state.createdInput = input;
        state.task = {
          id: "task_fixture",
          title: input.objective,
          objective: input.objective,
          conversationId: input.conversationId,
          status: "queued",
          artifacts: [],
          events: [],
          plan: ["understand", "permission", "submit", "poll", "deliver"].map((step) => ({ id: `${step}_fixture`, status: "pending" })),
        };
        return structuredClone(state.task);
      },
      getTask: async (id) => state.task?.id === id ? structuredClone(state.task) : undefined,
    },
    "@/lib/taskStore": {
      recordTaskEvent: async (_id, event) => {
        state.events.push(event);
        state.task.events.push(event);
        return event;
      },
      setTaskStatus: async (_id, status, error) => {
        state.statusTransitions.push(status);
        state.task.status = status;
        state.task.error = error;
        return structuredClone(state.task);
      },
      updateStoredTask: async (_id, update) => {
        update(state.task);
        return structuredClone(state.task);
      },
    },
  };
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
  return { post: loaded.exports.POST, state };
}

function request() {
  return new Request("http://localhost/api/generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "A golden retriever puppy in a garden",
      type: "image",
      conversationId: "chat_fixture",
    }),
  });
}

test("successful image generation returns and stores a completed, conversation-linked task", async () => {
  const { post, state } = loadRoute({
    status: "completed",
    assetData: "data:image/png;base64,iVBORw0KGgo=",
    mimeType: "image/png",
    provider: "huggingface",
    model: "Qwen/Qwen-Image",
  });

  const response = await post(request());
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(state.createdInput.conversationId, "chat_fixture");
  assert.equal(payload.task.conversationId, "chat_fixture");
  assert.equal(payload.task.status, "completed");
  assert.equal(state.statusTransitions.join(","), "running,completed");
  assert.equal(payload.task.plan.filter((step) => step.status === "completed").length, 3);
  assert.equal(payload.task.artifacts.length, 1);
  assert.equal(payload.task.artifacts[0].content, "iVBORw0KGgo=");
  assert.equal(payload.artifact.model, "Qwen/Qwen-Image");
  assert.equal(state.events.at(-1).status, "completed");
});

test("provider rejection returns a failed task rather than marking it complete", async () => {
  const { post, state } = loadRoute({ status: "failed", error: "Mocked provider rejection" });

  const response = await post(request());
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(state.createdInput.conversationId, "chat_fixture");
  assert.equal(state.task.status, "failed");
  assert.equal(state.task.error, "Mocked provider rejection");
  assert.equal(state.statusTransitions.join(","), "running,failed");
  assert.equal(state.task.artifacts.length, 0);
  assert.equal(payload.details.taskId, "task_fixture");
  assert.equal(state.events.at(-1).status, "failed");
});
