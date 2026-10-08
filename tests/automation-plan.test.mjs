import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/automationPlan.ts");
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded._compile(ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sourcePath);
const { parsePlan, normalizePlanSchedule, describePlanSchedule, planMessages } = loaded.exports;

test("plan prompt carries the time and timezone", () => {
  const [system, user] = planMessages("every morning news", { now: "Thursday 8 October 2026, 20:00", timezone: "Africa/Lagos" });
  assert.match(system.content, /Thursday 8 October 2026/);
  assert.match(system.content, /Africa\/Lagos/);
  assert.equal(user.content, "every morning news");
});

test("parses a weekly plan from fenced JSON", () => {
  const result = parsePlan('Sure!\n```json\n{"name":"Weekday agenda","prompt":"Send the user today\'s calendar and urgent emails.","mode":"schedule","schedule":{"type":"weekly","days":["mon","tue",3,4,5],"time":"7am"},"summary":"Every weekday at 7:00 you get your agenda.","needs":["google","fax"]}\n```');
  assert.deepEqual(result.plan.schedule, { type: "weekly", days: [1, 2, 3, 4, 5], time: "07:00" });
  assert.deepEqual(result.plan.needs, ["google"]);
  assert.equal(result.plan.mode, "schedule");
  assert.equal(describePlanSchedule(result.plan.schedule, "Africa/Lagos"), "Every weekday at 07:00");
});

test("clarifying questions, run-now plans and bad plans", () => {
  assert.deepEqual(parsePlan('{"question":"What should I check?"}'), { question: "What should I check?" });
  const now = parsePlan('{"name":"Compare phones","prompt":"Compare the three best budget phones in Nigeria.","mode":"now","schedule":null}');
  assert.equal(now.plan.mode, "now");
  assert.equal(now.plan.schedule, null);
  assert.equal(describePlanSchedule(null, "UTC"), "Once, right now");
  assert.throws(() => parsePlan("not json"), /couldn't turn/);
  assert.throws(() => parsePlan('{"prompt":"Do the thing every day","mode":"schedule","schedule":{"type":"daily","time":"25:00"}}'), /when it should run/);
  assert.throws(() => parsePlan('{"prompt":"x"}'), /what the automation should do/);
});

test("schedule normalisation", () => {
  assert.deepEqual(normalizePlanSchedule({ type: "daily", time: "6:30 pm" }), { type: "daily", time: "18:30" });
  assert.deepEqual(normalizePlanSchedule({ type: "interval", minutes: 5 }), { type: "interval", minutes: 15 });
  assert.deepEqual(normalizePlanSchedule({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:00" }), { type: "daily", time: "08:00" });
  assert.equal(normalizePlanSchedule({ type: "weekly", days: [], time: "08:00" }), null);
  assert.equal(normalizePlanSchedule({ type: "once", at: "2026-10-09T09:00:00+01:00" }).at, "2026-10-09T08:00:00.000Z");
  assert.equal(describePlanSchedule({ type: "interval", minutes: 180 }, "UTC"), "Every 3 hours");
  assert.equal(describePlanSchedule({ type: "interval", minutes: 60 }, "UTC"), "Every hour");
});
