import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/study.ts");
const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded._compile(compiled, sourcePath);
const { parseQuiz, parseFlashcards, studyMessages } = loaded.exports;

test("study prompts carry the document and ask for JSON where needed", () => {
  const [system, user] = studyMessages("quiz", "notes.pdf", "Photosynthesis makes glucose.");
  assert.equal(system.role, "system");
  assert.match(user.content, /notes\.pdf/);
  assert.match(user.content, /"quiz"/);
  assert.match(studyMessages("summary", "a", "x".repeat(30000))[1].content, /document continues/);
});

test("parses quiz JSON, fenced or not, and letter answers", () => {
  const quiz = parseQuiz('Here you go:\n```json\n{"quiz":[{"q":"What do plants make?","options":["Glucose","Salt","Iron","Oil"],"answer":0,"why":"Photosynthesis"},{"question":"Bad","options":["only one"],"answer":0},{"q":"Pick B","choices":["a","b","c"],"answer":"B"}]}\n```');
  assert.equal(quiz.length, 2);
  assert.deepEqual(quiz[0], { q: "What do plants make?", options: ["Glucose", "Salt", "Iron", "Oil"], answer: 0, why: "Photosynthesis" });
  assert.equal(quiz[1].answer, 1);
  assert.deepEqual(parseQuiz("no json here"), []);
});

test("parses flashcards from JSON or plain lines", () => {
  assert.deepEqual(parseFlashcards('{"flashcards":[{"front":"ATP","back":"Energy currency"},{"front":"","back":"x"}]}'), [{ front: "ATP", back: "Energy currency" }]);
  assert.deepEqual(parseFlashcards('[{"term":"Mitosis","definition":"Cell division"}]'), [{ front: "Mitosis", back: "Cell division" }]);
  assert.deepEqual(parseFlashcards("1. Osmosis - movement of water\n- Diffusion: spreading out"), [{ front: "Osmosis", back: "movement of water" }, { front: "Diffusion", back: "spreading out" }]);
});
