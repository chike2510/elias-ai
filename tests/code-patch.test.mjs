import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

function load(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const patch = load(path.resolve("lib/assistant/code/patch.ts"));
const roundTrip = (before, after) => {
  const diff = patch.unifiedDiff("f.ts", before, after);
  const [file] = patch.parseUnifiedDiff(diff);
  return patch.applyHunks(before, file.hunks);
};

test("applyEdits replaces a unique exact match and keeps the rest", () => {
  const result = patch.applyEdits("const a = 1;\nconst b = 2;\n", [{ find: "const b = 2;", replace: "const b = 3;" }]);
  assert.equal(result.ok, true);
  assert.equal(result.content, "const a = 1;\nconst b = 3;\n");
  assert.equal(result.applied, 1);
});

test("applyEdits refuses an ambiguous find unless all=true, and names the lines", () => {
  const src = "x();\ny();\nx();\n";
  const bad = patch.applyEdits(src, [{ find: "x();", replace: "z();" }]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /matches 2 places \(lines 1, 3\)/);
  const good = patch.applyEdits(src, [{ find: "x();", replace: "z();", all: true }]);
  assert.equal(good.content, "z();\ny();\nz();\n");
});

test("applyEdits matches ignoring whitespace and re-indents the replacement", () => {
  const src = "function f() {\n    if (a) {\n        go();\n    }\n}\n";
  const result = patch.applyEdits(src, [{ find: "if (a) {\n  go();\n}", replace: "if (a) {\n  stop();\n}" }]);
  assert.equal(result.ok, true);
  assert.equal(result.content, "function f() {\n    if (a) {\n      stop();\n    }\n}\n");
  assert.match(result.notes[0], /ignoring whitespace at line 2/);
});

test("applyEdits is all-or-nothing and reports where the text was near", () => {
  const src = "alpha\nbeta\ngamma\n";
  const result = patch.applyEdits(src, [{ find: "alpha", replace: "ALPHA" }, { find: "gamma ray", replace: "x" }]);
  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].index, 1);
  assert.equal(result.conflicts[0].nearLine, 3);
  assert.equal(patch.applyEdits(src, [{ find: "", replace: "x" }]).ok, false);
});

test("applyEdits keeps CRLF line endings on a fuzzy match", () => {
  const result = patch.applyEdits("a\r\n  b\r\nc\r\n", [{ find: "b", replace: "B" }]);
  assert.equal(result.content, "a\r\n  B\r\nc\r\n");
  const fuzzy = patch.applyEdits("a\r\n  b  c\r\nd\r\n", [{ find: "b c", replace: "x" }]);
  assert.equal(fuzzy.ok, true);
  assert.equal(fuzzy.content, "a\r\n  x\r\nd\r\n");
});

test("unifiedDiff then parse then apply round-trips edits, inserts and deletes", () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const afterLines = before.split("\n");
  afterLines[4] = "changed 5";
  afterLines.splice(20, 2);
  afterLines.splice(30, 0, "inserted A", "inserted B");
  const after = afterLines.join("\n");
  const result = roundTrip(before, after);
  assert.equal(result.ok, true);
  assert.equal(result.content, after);
  assert.equal(roundTrip("", "hello\nworld\n").content, "hello\nworld\n");
  assert.equal(roundTrip("one\n", "").content, "");
});

test("unifiedDiff writes git headers, hunk counts and stats", () => {
  const diff = patch.unifiedDiff("src/a.ts", "a\nb\nc\n", "a\nB\nc\n");
  assert.match(diff, /^diff --git a\/src\/a.ts b\/src\/a.ts\n--- a\/src\/a.ts\n\+\+\+ b\/src\/a.ts\n@@ -1,3 \+1,3 @@\n a\n-b\n\+B\n c\n$/);
  assert.deepEqual(patch.diffStats(diff), { added: 1, removed: 1 });
  assert.equal(patch.unifiedDiff("x", "same\n", "same\n"), "");
  assert.match(patch.unifiedDiff("n.ts", null, "hi\n"), /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/n.ts/);
  assert.match(patch.unifiedDiff("d.ts", "bye\n", null), /deleted file mode 100644\n--- a\/d.ts\n\+\+\+ \/dev\/null/);
});

test("parseUnifiedDiff splits multi-file git diffs and handles count-less headers", () => {
  const diff = [
    "diff --git a/a.txt b/a.txt", "index 1..2 100644", "--- a/a.txt", "+++ b/a.txt", "@@ -1,2 +1,2 @@", " keep", "-old", "+new",
    "diff --git a/b.txt b/b.txt", "new file mode 100644", "--- /dev/null", "+++ b/b.txt", "@@ -0,0 +1 @@", "+fresh", "\\ No newline at end of file", "",
  ].join("\n");
  const files = patch.parseUnifiedDiff(diff);
  assert.equal(files.length, 2);
  assert.equal(files[0].oldPath, "a.txt");
  assert.deepEqual(files[0].hunks[0].lines, [" keep", "-old", "+new"]);
  assert.equal(files[1].oldPath, null);
  assert.equal(files[1].newPath, "b.txt");
  assert.equal(patch.contentFromNewFile(files[1].hunks), "fresh\n");
  const loose = patch.parseUnifiedDiff("@@\n-a\n+b\n");
  assert.equal(loose.length, 1);
  assert.equal(patch.applyHunks("a\n", loose[0].hunks).content, "b\n");
});

test("applyHunks tolerates drifted line numbers, whitespace changes and stale edge context", () => {
  const src = "header\nextra 1\nextra 2\nfunction go() {\n  return 1;\n}\nfooter\n";
  const drifted = patch.applyHunks(src, [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: ["function go() {", "-  return 1;", "+  return 2;", " }"].map((l, i) => i === 0 ? " " + l : l) }]);
  assert.equal(drifted.ok, true);
  assert.match(drifted.content, /return 2;/);
  assert.match(drifted.notes[0], /offset 3/);
  const spaced = patch.applyHunks(src, [{ oldStart: 4, oldLines: 3, newStart: 4, newLines: 3, lines: [" function go(){".replace("(){", "() {").replace("go", "go "), "-    return 1;", "+  return 3;", " }"] }]);
  assert.equal(spaced.ok, true);
  assert.match(spaced.content, /function go\(\) \{\n  return 3;/); // file's own context text kept
  const stale = patch.applyHunks(src, [{ oldStart: 3, oldLines: 4, newStart: 3, newLines: 4, lines: [" THIS LINE CHANGED", " function go() {", "-  return 1;", "+  return 4;", " }"] }]);
  assert.equal(stale.ok, true);
  assert.match(stale.notes[0], /fuzz 1/);
});

test("applyHunks applies several hunks in order and is all-or-nothing on a conflict", () => {
  const src = "a\nb\nc\nd\ne\nf\ng\nh\n";
  const ok = patch.applyHunks(src, [
    { oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: ["-b", "+B1", "+B2"] },
    { oldStart: 7, oldLines: 1, newStart: 8, newLines: 1, lines: ["-g", "+G"] },
  ]);
  assert.equal(ok.content, "a\nB1\nB2\nc\nd\ne\nf\nG\nh\n");
  const bad = patch.applyHunks(src, [
    { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-b", "+B"] },
    { oldStart: 5, oldLines: 2, newStart: 5, newLines: 2, lines: [" nope", "-nothing", "+x"] },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.conflicts[0].index, 1);
  assert.match(bad.error, /Hunk 2 of 2 failed/);
});

test("applyHunks inserts at the stated line for pure additions", () => {
  const result = patch.applyHunks("one\ntwo\n", [{ oldStart: 1, oldLines: 0, newStart: 2, newLines: 1, lines: ["+between"] }]);
  assert.equal(result.content, "one\nbetween\ntwo\n");
});
