import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/chatResponse.ts");
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { parseStructuredChatResponse, safeSuggestedReplies, selectSuggestedReply } = loaded.exports;

test("plain conversational replies remain unchanged and concise", () => {
  const content = "Yes — a two-week pilot is the lowest-risk way to validate demand.";
  assert.deepEqual(parseStructuredChatResponse(content), { content });
});

test("structured decision metadata is removed from prose and bounded for the UI", () => {
  const result = parseStructuredChatResponse(`I would start with a focused pilot.\n\n[[ELIAS_RECOMMENDATION]]Run a two-week pilot before committing to a full launch.[[/ELIAS_RECOMMENDATION]]\n[[ELIAS_REASONS]]\n- It tests willingness to pay with little upfront cost.\n- It gives the team a fast feedback loop.\n- It gives the team a fast feedback loop.\n- It is reversible.\n- Extra item beyond the limit.\n- A fifth reason exceeds the UI limit.[[/ELIAS_REASONS]]\n[[ELIAS_RISKS]]\n- A narrow sample may not represent the wider market.[[/ELIAS_RISKS]]\n[[ELIAS_CHOICES]]\n- Draft a two-week pilot plan\n- Compare the pilot with a full launch\n- List the main validation metrics\n- This fourth choice is ignored.[[/ELIAS_CHOICES]]`);

  assert.equal(result.content, "I would start with a focused pilot.");
  assert.equal(result.recommendation, "Run a two-week pilot before committing to a full launch.");
  assert.deepEqual(result.reasons, ["It tests willingness to pay with little upfront cost.", "It gives the team a fast feedback loop.", "It is reversible.", "Extra item beyond the limit."]);
  assert.deepEqual(result.risks, ["A narrow sample may not represent the wider market."]);
  assert.deepEqual(result.suggestedReplies, ["Draft a two-week pilot plan", "Compare the pilot with a full launch", "List the main validation metrics"]);
  assert.doesNotMatch(result.content, /ELIAS_|two-week pilot before committing/);
});

test("incomplete metadata is hidden instead of leaking transport markup", () => {
  const result = parseStructuredChatResponse("A reasonable default is a small pilot.\n\n[[ELIAS_CHOICES]]\n- Draft the plan");
  assert.equal(result.content, "A reasonable default is a small pilot.");
  assert.equal(result.suggestedReplies, undefined);
});

test("choice normalization drops unsafe shapes, overlong text and duplicates", () => {
  assert.deepEqual(safeSuggestedReplies([" Compare options ", "compare OPTIONS", "\n", "x".repeat(121), 7, "Review risks"]), ["Compare options", "Review risks"]);
  assert.deepEqual(safeSuggestedReplies("Draft a plan"), []);
});

test("only one valid selected prompt can be submitted; invalid indices and labels are inert", () => {
  const choices = ["Draft a two-week pilot plan", "Compare the pilot and launch"];
  assert.equal(selectSuggestedReply(choices, 0), "Draft a two-week pilot plan");
  assert.equal(selectSuggestedReply(choices, 1), "Compare the pilot and launch");
  assert.equal(selectSuggestedReply(choices, -1), null);
  assert.equal(selectSuggestedReply(choices, 1.5), null);
  assert.equal(selectSuggestedReply(choices, 2), null);
  assert.equal(selectSuggestedReply(["\u0000\n"], 0), null);
});
