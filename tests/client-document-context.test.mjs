import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const sourcePath = path.resolve("lib/clientDocumentContext.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { buildSelectedDocumentContext } = loaded.exports;

test("selected Library text is included as actual assistant context", async () => {
  const result = await buildSelectedDocumentContext(
    [{ id: "task-report", name: "report.md", type: "text/markdown", text: "The report recommends staged rollout and rollback checks." }],
    ["task-report"],
    "What does the report recommend?",
  );
  assert.equal(result.noMatches, false);
  assert.match(result.context, /Library file: report\.md/);
  assert.match(result.context, /staged rollout and rollback checks/);
});

test("selected text Blobs are read when a Library record has no extracted text field", async () => {
  const result = await buildSelectedDocumentContext(
    [{ id: "plain-file", name: "notes.txt", type: "text/plain", blob: new Blob(["A local text fixture."]) }],
    ["plain-file"],
    "Summarize my notes",
  );
  assert.equal(result.noMatches, false);
  assert.match(result.context, /A local text fixture/);
});

test("unselected Library files are never added to chat context", async () => {
  const result = await buildSelectedDocumentContext(
    [{ id: "other", name: "private.md", type: "text/markdown", text: "Unselected fixture content." }],
    ["different-id"],
    "summarize",
  );
  assert.equal(result.noMatches, true);
  assert.equal(result.context, "");
});
