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
const task = loadTypeScript(path.resolve("lib/task.ts"), {
  "@/lib/taskIntent": taskIntent,
});
const chatRouting = loadTypeScript(path.resolve("lib/chatTaskRouting.ts"), {
  "@/lib/taskIntent": taskIntent,
});
const persistedTasks = new Map();
const taskRoute = loadTypeScript(path.resolve("app/api/tasks/route.ts"), {
  "next/server": { after: () => { throw new Error("autoStart was not requested."); } },
  "@/lib/http": {
    jsonError: (message, status = 500, code = "INTERNAL_ERROR") => Response.json({ ok: false, error: { message, code } }, { status }),
    jsonOk: (value, init) => Response.json({ ok: true, ...value }, init),
    readJsonRequest: async (request) => request.json(),
  },
  "@/lib/task": { inferTaskKind: task.inferTaskKind, inferTaskType: task.inferTaskType },
  "@/lib/taskOrchestrator": {
    createTaskRecord: async (input) => {
      const created = task.createTask(input);
      persistedTasks.set(created.id, structuredClone(created));
      return created;
    },
    listTasks: async () => [],
    runTaskLoop: async () => undefined,
  },
});

const richResearchPrompt = "Research and write a current, richly detailed report on Michael Carrick’s football tactics, current role, and latest developments/results as of 2 October 2026. Use live/current research. Cover attacking and defensive shapes, build-up patterns, width, pressing triggers, transitions, role changes, match examples, strengths and vulnerabilities. Verify current status from dated sources, cite direct links, distinguish sourced facts from analysis, and do not guess.";
const codingPrompt = "Build a TypeScript web app with a search form.";

async function createThroughTaskApi(payload) {
  const response = await taskRoute.POST(new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  return body.task;
}

function assertResearchOnlyTask(created) {
  assert.equal(created.kind, "research");
  assert.equal(created.taskType, "research");
  assert.deepEqual(created.plan.map((step) => step.id.split("_")[0]), ["scope", "search", "read", "synthesize", "deliver"]);
  const planText = created.plan.map((step) => `${step.title} ${step.description}`).join(" ");
  assert.doesNotMatch(planText, /\b(repository|repo|workspace|code|file|dependency|inspect project)\b/i);
  assert.ok(created.plan.every((step) => step.requires !== "write" && step.requires !== "execute"));
  assert.equal(created.workspace.length, 0);
  assert.equal(created.permissions.find((permission) => permission.level === "write")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "execute")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "external_side_effect")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "network")?.granted, true);
  assert.deepEqual(persistedTasks.get(created.id)?.plan.map((step) => step.id.split("_")[0]), ["scope", "search", "read", "synthesize", "deliver"]);
}

test("ordinary chat hands rich football research to a server-classified research-only plan", async () => {
  assert.equal(chatRouting.inferChatTask(richResearchPrompt), "research");
  assert.equal(chatRouting.shouldHandoffToTask(richResearchPrompt), true);

  // This matches ChatScreen's POST shape: objective and conversationId, with no client kind hint.
  const created = await createThroughTaskApi({
    objective: richResearchPrompt,
    conversationId: "chat_carrick_research_fixture",
  });

  assertResearchOnlyTask(created);
});

test("task API corrects a stale Code hint on a non-chat request for the same football research", async () => {
  // Agent Workspace's task creation path has project/workspace context but no conversationId.
  const created = await createThroughTaskApi({
    objective: richResearchPrompt,
    kind: "code",
    taskType: "code",
    projectId: "project_current",
    workspace: [],
  });

  assertResearchOnlyTask(created);
});

test("explicit coding requests retain coding plans and leave write permission ungranted", async () => {
  assert.equal(chatRouting.inferChatTask(codingPrompt), "code");
  assert.equal(chatRouting.shouldHandoffToTask(codingPrompt), true);

  const created = await createThroughTaskApi({
    objective: codingPrompt,
    kind: "research",
    taskType: "research",
    projectId: "project_current",
    workspace: [],
  });

  assert.equal(created.kind, "code");
  assert.equal(created.taskType, "code");
  assert.deepEqual(created.plan.map((step) => step.id.split("_")[0]), ["inspect", "plan", "change", "validate", "review"]);
  assert.equal(created.plan.find((step) => step.id.startsWith("change_"))?.requires, "write");
  assert.equal(created.permissions.find((permission) => permission.level === "write")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "execute")?.granted, false);
});

test("non-chat callers retain an explicit media task kind when the objective is otherwise unclassified", async () => {
  const created = await createThroughTaskApi({
    objective: "Generate a landscape illustration of a quiet coast.",
    kind: "media",
    taskType: "media",
  });

  assert.equal(created.kind, "media");
  assert.equal(created.taskType, "media");
  assert.deepEqual(created.plan.map((step) => step.id.split("_")[0]), ["understand", "permission", "submit", "poll", "deliver"]);
});
