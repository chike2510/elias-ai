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
const taskRoute = loadTypeScript(path.resolve("app/api/tasks/route.ts"), {
  "next/server": { after: () => { throw new Error("autoStart was not requested."); } },
  "@/lib/http": {
    jsonError: (message, status = 500, code = "INTERNAL_ERROR") => Response.json({ ok: false, error: { message, code } }, { status }),
    jsonOk: (value, init) => Response.json({ ok: true, ...value }, init),
    readJsonRequest: async (request) => request.json(),
  },
  "@/lib/task": { inferTaskKind: task.inferTaskKind, inferTaskType: task.inferTaskType },
  "@/lib/taskOrchestrator": {
    createTaskRecord: async (input) => task.createTask(input),
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

test("ordinary chat hands rich football research to a server-classified research-only plan", async () => {
  assert.equal(chatRouting.inferChatTask(richResearchPrompt), "research");
  assert.equal(chatRouting.shouldHandoffToTask(richResearchPrompt), true);

  // A stale browser could still send the old/wrong kind; conversation tasks are reclassified at the API boundary.
  const created = await createThroughTaskApi({
    objective: richResearchPrompt,
    kind: "code",
    taskType: "code",
    conversationId: "chat_carrick_research_fixture",
  });

  assert.equal(created.kind, "research");
  assert.equal(created.taskType, "research");
  assert.deepEqual(created.plan.map((step) => step.id.split("_")[0]), ["scope", "search", "read", "synthesize", "deliver"]);
  const planText = created.plan.map((step) => `${step.title} ${step.description}`).join(" ");
  assert.doesNotMatch(planText, /\b(repository|repo|workspace|code|file|dependency|inspect project)\b/i);
  assert.ok(created.plan.every((step) => step.requires !== "write" && step.requires !== "execute"));
  assert.deepEqual(created.workspace, []);
  assert.equal(created.permissions.find((permission) => permission.level === "write")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "execute")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "external_side_effect")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "network")?.granted, true);
});

test("ordinary chat coding requests still get code plans with the existing write gate", async () => {
  assert.equal(chatRouting.inferChatTask(codingPrompt), "code");
  assert.equal(chatRouting.shouldHandoffToTask(codingPrompt), true);

  const created = await createThroughTaskApi({
    objective: codingPrompt,
    kind: "research",
    taskType: "research",
    conversationId: "chat_code_fixture",
  });

  assert.equal(created.kind, "code");
  assert.equal(created.taskType, "code");
  assert.deepEqual(created.plan.map((step) => step.id.split("_")[0]), ["inspect", "plan", "change", "validate", "review"]);
  assert.equal(created.plan.find((step) => step.id.startsWith("change_"))?.requires, "write");
  assert.equal(created.permissions.find((permission) => permission.level === "write")?.granted, false);
  assert.equal(created.permissions.find((permission) => permission.level === "execute")?.granted, false);
});

test("non-chat callers retain their explicit task kinds", async () => {
  const created = await createThroughTaskApi({
    objective: "Generate a landscape illustration of a quiet coast.",
    kind: "media",
    taskType: "media",
  });

  assert.equal(created.kind, "media");
  assert.equal(created.taskType, "media");
  assert.deepEqual(created.plan.map((step) => step.id.split("_")[0]), ["understand", "permission", "submit", "poll", "deliver"]);
});
