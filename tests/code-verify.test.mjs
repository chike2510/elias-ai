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
const { createMockGithub } = load(path.resolve("lib/assistant/code/mockGithub.ts"));

function memoryStore() {
  const rows = new Map();
  return { async get(u, c) { const r = rows.get(`${u}:${c}`); return r ? structuredClone(r) : null; }, async latest() { return null; }, async save(set) { rows.set(`${set.userId}:${set.conversationId}`, structuredClone(set)); }, async remove() {} };
}

const TSC_FAIL = [
  "2026-10-08T10:00:00.0000000Z ##[group]Run npx tsc --noEmit",
  "2026-10-08T10:00:01.0000000Z \u001b[96msrc/math.ts\u001b[0m:\u001b[93m2\u001b[0m:3 - \u001b[91merror\u001b[0m TS2322: Type 'string' is not assignable to type 'number'.",
  "2026-10-08T10:00:01.1000000Z ",
  "2026-10-08T10:00:01.2000000Z 2   return 'x';",
  ...Array.from({ length: 300 }, (_, i) => `2026-10-08T10:00:02.0000000Z noise line ${i}`),
  "2026-10-08T10:00:03.0000000Z ##[error]Process completed with exit code 2.",
].join("\n");

function setup({ failWhen = () => false, preview = (sha) => `https://app-git-${sha.slice(0, 6)}.vercel.app` } = {}) {
  const gh = createMockGithub({ repo: "acme/app", files: { "src/math.ts": "export const n: number = 1;\n" }, ci: (files) => failWhen(files) ? { failLog: TSC_FAIL } : null, preview });
  code.setGithubFetch(gh.fetch);
  code.setCodeStore(memoryStore());
  code.clearCodeCaches();
  let now = 0;
  verify.setVerifyClock({ now: () => now, sleep: async (ms) => { now += ms; } });
  const ctx = { userId: "u", conversationId: "c", timezone: "UTC", githubToken: "t" };
  const run = (name, args = {}) => (code.CODE_TOOLS[name] || verify.VERIFY_TOOLS[name]).run(args, ctx);
  return { gh, run };
}

test("trimLog keeps error lines with context and drops ANSI, timestamps and noise", () => {
  const trimmed = verify.trimLog(TSC_FAIL);
  assert.match(trimmed, /src\/math.ts:2:3 - error TS2322/);
  assert.match(trimmed, /ERROR: Process completed with exit code 2/);
  assert.doesNotMatch(trimmed, /\u001b|2026-10-08T|##\[group\]/);
  assert.ok(!trimmed.includes("noise line 100"));
  assert.ok(trimmed.length < 1000);
  assert.ok(verify.trimLog("x\n".repeat(10) + "Error: " + "y".repeat(9000), 500).length <= 520);
  assert.match(verify.trimLog("just\nsome\noutput"), /output/);
});

test("code_verify passes on green CI and reports the Vercel preview from deployment statuses", async () => {
  const { run } = setup();
  await run("repo_tree", { repo: "acme/app" });
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "= 1", replace: "= 2" }] });
  const commit = await run("code_commit", { message: "Two" });
  const result = await run("code_verify");
  assert.equal(result.status, "passed");
  assert.equal(result.sha, commit.sha);
  assert.equal(result.previewUrl, `https://app-git-${commit.sha.slice(0, 6)}.vercel.app`);
  assert.match(result.next, /preview/);
});

test("code_verify returns trimmed failure logs, counts attempts once per commit, and stops after 4", async () => {
  const { run } = setup({ failWhen: (files) => files["src/math.ts"].includes("'x'") });
  await run("repo_tree", { repo: "acme/app" });
  await assert.rejects(run("code_verify"), /code_commit the changes first/);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await run("code_edit", { path: "src/math.ts", edits: [{ find: attempt === 1 ? "1;" : `'x'; // ${attempt - 1}`, replace: `'x'; // ${attempt}` }] });
    await run("code_commit", { message: `try ${attempt}` });
    const result = await run("code_verify");
    assert.equal(result.status, "failed");
    assert.equal(result.attempt, attempt);
    assert.match(result.failures[0], /CI › check › Typecheck\n/);
    assert.match(result.failures[0], /TS2322/);
    if (attempt < 4) assert.match(result.next, /fix with code_edit/);
    else assert.match(result.next, /Stop editing/);
    // re-checking the same commit doesn't burn an attempt
    assert.equal((await run("code_verify")).attempt, attempt);
  }
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "'x'; // 4", replace: "5;" }] });
  await run("code_commit", { message: "try 5" });
  const capped = await run("code_verify");
  assert.match(capped.next, /failed 4 times/);
});

test("a fix after failures goes green and resets the count", async () => {
  const { run } = setup({ failWhen: (files) => files["src/math.ts"].includes("'x'") });
  await run("repo_tree", { repo: "acme/app" });
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "1;", replace: "'x';" }] });
  await run("code_commit", { message: "bad" });
  assert.equal((await run("code_verify")).status, "failed");
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "'x';", replace: "3;" }] });
  await assert.rejects(run("code_verify"), /uncommitted/);
  await run("code_commit", { message: "fix" });
  const green = await run("code_verify");
  assert.deepEqual([green.status, green.attempt], ["passed", 0]);
});

test("code_verify dispatches the workflow when no run appears, and reports running when CI is slow", async () => {
  const { run, gh } = setup({ preview: () => null });
  await run("repo_tree", { repo: "acme/app" });
  await run("code_edit", { path: "src/math.ts", edits: [{ find: "= 1", replace: "= 9" }] });
  const commit = await run("code_commit", { message: "nine" });
  gh.runs.length = 0; // the push didn't trigger CI
  const dispatched = await run("code_verify");
  assert.ok(gh.calls.some((c) => c.method === "POST" && c.path.endsWith("/actions/workflows/ci.yml/dispatches") && c.body.ref === commit.branch));
  assert.equal(dispatched.status, "passed");
  assert.equal(dispatched.previewUrl, undefined);
  gh.runs.length = 0;
  gh.runs.unshift({ id: 1, head_branch: commit.branch, head_sha: commit.sha, status: "in_progress", conclusion: null, html_url: "u", event: "push", name: "CI" });
  const slow = await run("code_verify");
  assert.equal(slow.status, "running");
  assert.match(slow.next, /doesn't count/);
});
