import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const cache = new Map();
function load(sourcePath) {
  if (cache.has(sourcePath)) return cache.get(sourcePath).exports;
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  cache.set(sourcePath, loaded);
  loaded.require = (id) => id.startsWith("@/") ? load(path.resolve(id.slice(2) + ".ts")) : id.startsWith(".") ? load(path.resolve(path.dirname(sourcePath), id + ".ts")) : require(id);
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const code = load(path.resolve("lib/assistant/code/github.ts"));
const verify = load(path.resolve("lib/assistant/code/verify.ts"));
const pr = load(path.resolve("lib/assistant/code/pr.ts"));
const cards = load(path.resolve("lib/assistant/code/cards.ts"));
const { createMockGithub } = load(path.resolve("lib/assistant/code/mockGithub.ts"));

function memoryStore() {
  const rows = new Map();
  return { async get(u, c) { const r = rows.get(`${u}:${c}`); return r ? structuredClone(r) : null; }, async latest() { return null; }, async save(set) { rows.set(`${set.userId}:${set.conversationId}`, structuredClone(set)); }, async remove() {} };
}

function setup(failWhen = () => false) {
  const gh = createMockGithub({ repo: "acme/app", files: { "a.ts": "export const a = 1;\n" }, ci: (files) => failWhen(files) ? { failLog: "error TS1: bad" } : null, preview: (sha) => `https://p-${sha.slice(0, 5)}.vercel.app` });
  code.setGithubFetch(gh.fetch);
  code.setCodeStore(memoryStore());
  code.clearCodeCaches();
  let now = 0;
  verify.setVerifyClock({ now: () => now, sleep: async (ms) => { now += ms; } });
  const ctx = { userId: "u", conversationId: "c", timezone: "UTC", githubToken: "t" };
  const tools = { ...code.CODE_TOOLS, ...verify.VERIFY_TOOLS, ...pr.PR_TOOLS };
  const run = (name, args = {}, extra = {}) => tools[name].run(args, { ...ctx, ...extra });
  const gate = (name, args = {}) => tools[name].needsApproval(args, ctx);
  return { gh, run, gate };
}

async function pushed(run, content = "export const a = 2;\n") {
  await run("repo_tree", { repo: "acme/app" });
  await run("code_create_file", { path: "a.ts", content, overwrite: true });
  return run("code_commit", { message: "Change a" });
}

test("code_open_pr always asks first, then opens the PR from the chat's branch", async () => {
  const { gh, run, gate } = setup();
  await run("repo_tree", { repo: "acme/app" });
  await assert.rejects(gate("code_open_pr", { title: "x" }), /Nothing pushed yet/);
  const commit = await pushed(run);
  await run("code_verify");
  const summary = await gate("code_open_pr", { title: "Change a", body: "Bumps a." });
  assert.match(summary, new RegExp(`Open a pull request in acme/app: ${commit.branch} → main`));
  assert.match(summary, /CI: passed/);
  const opened = await run("code_open_pr", { title: "Change a", body: "Bumps a." }, { approved: true });
  assert.equal(opened.number, 40);
  assert.match(gh.pulls[0].body, /Bumps a\.[\s\S]*Commits[\s\S]*CI:\*\* passed · \[preview\]/);
  await assert.rejects(gate("code_open_pr", { title: "again" }), /already open/);
});

test("code_merge_pr refuses while CI is red, asks when green, and resets the working set after merging", async () => {
  const { gh, run, gate } = setup((files) => files["a.ts"].includes("BAD"));
  await pushed(run, "BAD\n");
  await run("code_open_pr", { title: "Bad" }, { approved: true });
  await assert.rejects(gate("code_merge_pr"), /Refusing to merge PR #40: CI is red/);
  await assert.rejects(run("code_merge_pr", {}, { approved: true }), /CI is red/);
  // fix it: new commit -> CI green
  await run("code_create_file", { path: "a.ts", content: "export const a = 3;\n", overwrite: true });
  await run("code_commit", { message: "Fix" });
  assert.match(await gate("code_merge_pr"), /Squash-merge PR #40 "Bad" into main[\s\S]*CI: green/);
  await assert.rejects(run("code_merge_pr", {}), /needs the user's approval/);
  const merged = await run("code_merge_pr", {}, { approved: true });
  assert.equal(merged.ok, true);
  assert.equal(gh.branchFiles("main")["a.ts"], "export const a = 3;\n");
  const tree = await run("repo_tree", {});
  assert.equal(tree.branch, null, "next change starts a new branch from the updated base");
  assert.equal((await run("repo_read", { path: "a.ts" })).content, "   1| export const a = 3;\n");
});

test("code_merge_pr waits while CI is still running", async () => {
  const { gh, run, gate } = setup();
  const commit = await pushed(run);
  await run("code_open_pr", { title: "x" }, { approved: true });
  gh.runs.forEach((item) => { if (item.head_sha === commit.sha) { item.status = "in_progress"; item.conclusion = null; } });
  await assert.rejects(gate("code_merge_pr"), /CI is still running/);
});

test("codeCardFor builds diff, commit, checks and PR cards", () => {
  const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n";
  const card = cards.codeCardFor("code_diff", { repo: "acme/app", branch: null, base: "main", files: [{ path: "a.ts", status: "modified", added: 1, removed: 1 }], diff, added: 1, removed: 1 });
  assert.deepEqual([card.kind, card.title, card.files.length, card.added], ["diff", "Changes", 1, 1]);
  assert.deepEqual(cards.diffByFile(diff), [{ path: "a.ts", lines: ["@@ -1 +1 @@", "-x", "+y", ""] }]);
  assert.equal(cards.codeCardFor("code_diff", { files: [] }), null);
  assert.equal(cards.codeCardFor("code_commit", { ok: true, repo: "acme/app", branch: "elias/x", sha: "abc1234", url: "u", files: [], added: 2, removed: 0 }).commit.sha, "abc1234");
  const checks = cards.codeCardFor("code_verify", { status: "failed", attempt: 2, maxAttempts: 4, sha: "s", runUrl: "r", failures: ["CI › check\nerror"] });
  assert.deepEqual([checks.title, checks.ci.attempt, checks.ci.failure], ["Checks failed", 2, "CI › check\nerror"]);
  assert.equal(cards.codeCardFor("code_open_pr", { ok: true, number: 7, url: "https://github.com/acme/app/pull/7", branch: "elias/x", base: "main" }).repo, "acme/app");
  assert.equal(cards.codeCardFor("code_merge_pr", { ok: true, number: 7, url: "https://github.com/acme/app/pull/7" }).pr.merged, true);
  assert.equal(cards.codeCardFor("web_search", []), null);
});
