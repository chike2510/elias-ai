import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const cache = new Map();

/** Transpiles a TS module; resolves relative and @/ imports to other TS files. */
function load(sourcePath) {
  if (cache.has(sourcePath)) return cache.get(sourcePath).exports;
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  cache.set(sourcePath, loaded);
  loaded.require = (id) => {
    if (id.startsWith("@/")) return load(path.resolve(id.slice(2) + ".ts"));
    if (id.startsWith(".")) return load(path.resolve(path.dirname(sourcePath), id + ".ts"));
    return require(id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const code = load(path.resolve("lib/assistant/code/github.ts"));
const { createMockGithub } = load(path.resolve("lib/assistant/code/mockGithub.ts"));

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async get(userId, conversationId) { const row = rows.get(`${userId}:${conversationId}`); return row ? structuredClone(row) : null; },
    async latest() { return [...rows.values()].pop() || null; },
    async save(set) { rows.set(`${set.userId}:${set.conversationId}`, structuredClone(set)); },
    async remove(userId, conversationId) { rows.delete(`${userId}:${conversationId}`); },
  };
}

const FILES = {
  "README.md": "# App\n",
  "src/math.ts": "export function add(a: number, b: number) {\n  return a + b;\n}\n\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n",
  "src/app.ts": "import { add } from './math';\nconsole.log(add(1, 2));\n",
  "node_modules/x/index.js": "module.exports = 1;\n",
  "logo.png": "binary",
};

function setup(files = FILES) {
  const gh = createMockGithub({ repo: "acme/app", files });
  const store = memoryStore();
  code.setGithubFetch(gh.fetch);
  code.setCodeStore(store);
  code.clearCodeCaches();
  const ctx = { userId: "u1", conversationId: "c1", timezone: "Africa/Lagos", githubToken: "t0k" };
  const run = (name, args, extra = {}) => code.CODE_TOOLS[name].run(args, { ...ctx, ...extra });
  return { gh, store, ctx, run };
}

test("repo_tree opens the repo for the chat and hides vendored folders", async () => {
  const { run, store } = setup();
  const tree = await run("repo_tree", { repo: "acme/app" });
  assert.equal(tree.repo, "acme/app");
  assert.equal(tree.base, "main");
  assert.deepEqual(tree.files, ["README.md", "logo.png", "src/app.ts", "src/math.ts"]);
  assert.equal((await store.get("u1", "c1")).repo, "acme/app");
  assert.deepEqual((await run("repo_tree", { path: "src/**/*.ts" })).files, ["src/app.ts", "src/math.ts"]);
  await assert.rejects(run("repo_tree", { repo: "not a repo" }), /isn't a repo/);
});

test("repo_read numbers lines, pages big files and suggests similar paths", async () => {
  const { run } = setup();
  await run("repo_tree", { repo: "acme/app" });
  const read = await run("repo_read", { path: "src/math.ts", start_line: 2, end_line: 3 });
  assert.equal(read.lines, "2-3 of 7");
  assert.equal(read.content, "   2|   return a + b;\n   3| }\n");
  assert.match(read.more, /start_line=4/);
  await assert.rejects(run("repo_read", { path: "math.ts" }), /Did you mean: src\/math.ts/);
  await assert.rejects(run("repo_read", { path: "../etc/passwd" }), /Invalid file path/);
});

test("repo_grep finds literal and regex matches, skipping binaries and node_modules", async () => {
  const { run } = setup();
  await run("repo_tree", { repo: "acme/app" });
  const literal = await run("repo_grep", { pattern: "add(" });
  assert.deepEqual(literal.matches.map((m) => `${m.path}:${m.line}`), ["src/app.ts:2", "src/math.ts:1"]);
  const regex = await run("repo_grep", { pattern: "^export function \\w+", regex: true, path: "src" });
  assert.equal(regex.matches.length, 2);
  assert.equal((await run("repo_grep", { pattern: "module.exports" })).matches.length, 0);
});

test("code_edit stages changes, reads see them, and a failed edit applies nothing", async () => {
  const { run, gh } = setup();
  await run("repo_tree", { repo: "acme/app" });
  const edited = await run("code_edit", { path: "src/math.ts", edits: [{ find: "return a + b;", replace: "return a + b + 0;" }] });
  assert.equal(edited.ok, true);
  assert.deepEqual([edited.added, edited.removed], [1, 1]);
  assert.match((await run("repo_read", { path: "src/math.ts" })).content, /a \+ b \+ 0/);
  assert.equal((await run("repo_grep", { pattern: "+ 0" })).matches.length, 1);
  const failed = await run("code_edit", { path: "src/math.ts", edits: [{ find: "return a - b;", replace: "x" }, { find: "nope", replace: "y" }] });
  assert.equal(failed.ok, false);
  assert.equal(failed.conflicts[0].index, 1);
  assert.doesNotMatch((await run("repo_read", { path: "src/math.ts" })).content, /\| x$/m);
  // Editing back to the original un-stages the file.
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "return a + b + 0;", replace: "return a + b;" }] });
  assert.equal((await run("code_diff", {})).files.length, 0);
  assert.equal(gh.calls.filter((c) => c.method !== "GET").length, 0, "nothing is written to GitHub before commit");
});

test("code_patch applies multi-file diffs with new and deleted files, all-or-nothing", async () => {
  const { run } = setup();
  await run("repo_tree", { repo: "acme/app" });
  const diff = [
    "--- a/src/math.ts", "+++ b/src/math.ts", "@@ -5,3 +5,3 @@", " export function sub(a: number, b: number) {", "-  return a - b;", "+  return a - b; // checked", " }",
    "--- /dev/null", "+++ b/src/mul.ts", "@@ -0,0 +1,1 @@", "+export const mul = (a: number, b: number) => a * b;",
    "--- a/README.md", "+++ /dev/null", "@@ -1 +0,0 @@", "-# App", "",
  ].join("\n");
  const applied = await run("code_patch", { diff });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const summary = await run("code_diff", {});
  assert.deepEqual(summary.files.map((f) => `${f.status}:${f.path}`), ["deleted:README.md", "modified:src/math.ts", "added:src/mul.ts"]);
  assert.match(summary.diff, /\+export const mul/);
  const bad = await run("code_patch", { diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-totally different\n+x\n" });
  assert.equal(bad.ok, false);
  assert.match(bad.hint, /Nothing was applied/);
});

test("code_create_file and code_delete_file guard existing and missing paths", async () => {
  const { run } = setup();
  await run("repo_tree", { repo: "acme/app" });
  await assert.rejects(run("code_create_file", { path: "README.md", content: "x" }), /already exists/);
  const created = await run("code_create_file", { path: "docs/new.md", content: "hello" });
  assert.equal(created.created, true);
  assert.equal((await run("repo_read", { path: "docs/new.md" })).content, "   1| hello\n");
  await assert.rejects(run("code_delete_file", { path: "missing.ts" }), /doesn't exist/);
  await run("code_delete_file", { path: "src/app.ts" });
  assert.ok(!(await run("repo_tree", {})).files.includes("src/app.ts"));
});

test("code_commit pushes one commit to a new elias/ branch, then follows up on the same branch", async () => {
  const { run, gh, store } = setup();
  await run("repo_tree", { repo: "acme/app" });
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "return a + b;", replace: "return b + a;" }] });
  await run("code_create_file", { path: "src/mul.ts", content: "export const mul = 1;\n" });
  assert.equal(await code.CODE_TOOLS.code_commit.needsApproval({ message: "Swap add" }, { userId: "u1", conversationId: "c1" }), null);
  const first = await run("code_commit", { message: "Swap add operands" });
  assert.equal(first.ok, true);
  assert.match(first.branch, /^elias\/swap-add-operands-[a-z0-9]{4}$/);
  const files = gh.branchFiles(first.branch);
  assert.match(files["src/math.ts"], /return b \+ a;/);
  assert.equal(files["src/mul.ts"], "export const mul = 1;\n");
  assert.equal(gh.branchFiles("main")["src/math.ts"], FILES["src/math.ts"], "main untouched");
  const set = await store.get("u1", "c1");
  assert.deepEqual([set.branch, set.branchCreated, Object.keys(set.files).length, set.baseSha], [first.branch, true, 0, first.sha]);
  // second commit lands on the same branch, fast-forward, no approval
  await run("code_delete_file", { path: "README.md" });
  assert.equal(await code.CODE_TOOLS.code_commit.needsApproval({ message: "Drop readme" }, { userId: "u1", conversationId: "c1" }), null);
  const second = await run("code_commit", { message: "Drop readme" });
  assert.equal(second.branch, first.branch);
  assert.equal(gh.branchFiles(first.branch)["README.md"], undefined);
  await assert.rejects(run("code_commit", { message: "empty" }), /Nothing staged/);
});

test("code_commit needs approval for main or someone else's branch, and refuses when the branch moved under an edit", async () => {
  const { run, gh, ctx } = setup();
  await run("repo_tree", { repo: "acme/app" });
  await run("code_edit", { path: "src/app.ts", edits: [{ find: "add(1, 2)", replace: "add(2, 2)" }] });
  const gate = code.CODE_TOOLS.code_commit.needsApproval;
  assert.match(await gate({ message: "m", branch: "main" }, ctx), /straight to acme\/app branch "main"/);
  gh.pushExternal("main", {});
  gh.refs.set("elias/someone-else", gh.head("main"));
  assert.match(await gate({ message: "m", branch: "elias/someone-else" }, ctx), /existing branch/);
  assert.equal(await gate({ message: "m", branch: "elias/brand-new" }, ctx), null);
  await assert.rejects(run("code_commit", { message: "m", branch: "main" }), /needs the user's approval/);
  // approved push to main, but main moved and touched the same file -> refuse
  gh.pushExternal("main", { "src/app.ts": "changed elsewhere\n" });
  await assert.rejects(run("code_commit", { message: "m", branch: "main" }, { approved: true }), /moved since these edits started and src\/app.ts changed/);
});

test("switching repos is refused while changes are staged", async () => {
  const { run } = setup();
  await run("repo_tree", { repo: "acme/app" });
  await run("code_create_file", { path: "x.txt", content: "x" });
  await assert.rejects(run("repo_tree", { repo: "acme/other" }), /uncommitted change/);
  await code.discardCodeSet("u1", "c1");
  await assert.rejects(run("repo_tree", { repo: "acme/other" }), /GitHub 404/);
});

test("branch names and paths are validated", () => {
  assert.ok(code.isEliasBranch("elias/fix-login-ab12"));
  assert.ok(!code.isEliasBranch("main"));
  assert.ok(!code.isEliasBranch("elias/../main"));
  assert.ok(!code.isEliasBranch("feature/elias/x"));
  assert.match(code.branchName("Fix: the LOGIN bug!!"), /^elias\/fix-the-login-bug-[a-z0-9]{4}$/);
  assert.equal(code.parseRepo("https://github.com/acme/app.git").full, "acme/app");
  assert.equal(code.cleanPath("./b/src/x.ts"), "b/src/x.ts");
  assert.ok(code.isCodeTool("repo_read") && code.isCodeTool("code_verify") && !code.isCodeTool("github_api"));
});
