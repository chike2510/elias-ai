import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");

// Load lib/*.ts straight from source: transpile .ts on require and map the "@/" alias to the repo root.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, ...rest) {
  if (request.startsWith("@/")) return path.resolve(`${request.slice(2)}.ts`);
  return originalResolve.call(this, request, parent, ...rest);
};
Module._extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  module._compile(compiled, filename);
};
function freshStore(file) {
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.resolve("lib"))) delete require.cache[key];
  return require(path.resolve(file));
}
function resetGlobals() {
  for (const key of ["__eliasGitHubStore", "__eliasGitHubDb", "__eliasGitHubSchema", "__eliasGitHubTokenChecks", "__eliasGitHubRepositoryTaskStore", "__eliasGitHubRepositoryTaskDb", "__eliasGitHubRepositoryTaskSchema", "__eliasGitHubProposalStore", "__eliasGitHubProposalDb", "__eliasGitHubProposalSchema"]) globalThis[key] = undefined;
}
function withEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } resetGlobals(); });
}
const connection = (token, extra = {}) => ({ userId: "github_1", login: "octo", token, scopes: ["repo", "read:org"], connectionType: "repository", connectedAt: 1, updatedAt: 1, ...extra });
const session = (githubToken) => ({ userId: "github_1", login: "octo", createdAt: 1, ...(githubToken ? { githubToken, githubTokenType: "repository" } : {}) });

test("stored connections parse from objects and from double-encoded jsonb strings", () => {
  const store = freshStore("lib/githubConnectionStore.ts");
  const row = { userId: "github_1", login: "octo", tokenCiphertext: "v2:abc", scopes: ["repo"], connectionType: "repository" };
  assert.deepEqual(store.parseStoredConnection(row), row);
  assert.deepEqual(store.parseStoredConnection(JSON.stringify(row)), row);
  assert.deepEqual(store.parseStoredConnection(JSON.stringify(JSON.stringify(row))), row);
  assert.equal(store.parseStoredConnection("not json"), undefined);
  assert.equal(store.parseStoredConnection(JSON.stringify([row])), undefined);
  assert.equal(store.parseStoredConnection(null), undefined);
});

test("token resolution skips a rejected stored token, uses the session copy and heals the store", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "elias-github-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  withEnv(t, { ELIAS_GITHUB_STORE_PATH: join(directory, "connections.json"), POSTGRES_URL: undefined, VERCEL: undefined });
  resetGlobals();
  const store = freshStore("lib/githubConnectionStore.ts");
  await store.saveGitHubConnection(connection("dead-token"));
  assert.equal((await store.getGitHubConnection("github_1")).token, "dead-token");

  const probed = [];
  const probe = async (token) => { probed.push(token); return token === "dead-token" ? "invalid" : "valid"; };
  const result = await store.resolveGitHubToken(session("fresh-token"), probe);
  assert.equal(result.token, "fresh-token");
  assert.equal(result.source, "session");
  assert.equal(result.reconnect, false);
  assert.deepEqual(probed, ["dead-token", "fresh-token"]);
  const healed = await store.getGitHubConnection("github_1");
  assert.equal(healed.token, "fresh-token");
  assert.equal(healed.login, "octo");
  // The written file never holds the plaintext token.
  assert.equal(readFileSync(join(directory, "connections.json"), "utf8").includes("fresh-token"), false);
});

test("every rejected token means reconnect; a single token is returned without a probe", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "elias-github-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  withEnv(t, { ELIAS_GITHUB_STORE_PATH: join(directory, "connections.json"), POSTGRES_URL: undefined, VERCEL: undefined });
  resetGlobals();
  const store = freshStore("lib/githubConnectionStore.ts");
  await store.saveGitHubConnection(connection("stored-a"));
  const none = await store.resolveGitHubToken(session("session-b"), async () => "invalid");
  assert.deepEqual(none, { reconnect: true, candidates: 2 });

  resetGlobals();
  const again = freshStore("lib/githubConnectionStore.ts");
  let probes = 0;
  const single = await again.resolveGitHubToken(session(), async () => { probes += 1; return "invalid"; });
  assert.equal(single.token, "stored-a");
  assert.equal(probes, 0);
  // Network trouble ("unknown") never forces a reconnect.
  resetGlobals();
  const flaky = freshStore("lib/githubConnectionStore.ts");
  const unknown = await flaky.resolveGitHubToken(session("session-b"), async () => "unknown");
  assert.equal(unknown.token, "stored-a");
  assert.equal(unknown.reconnect, false);
  assert.deepEqual(await flaky.resolveGitHubToken(null), { reconnect: false, candidates: 0 });
});

// Real Postgres: set GITHUB_STORE_TEST_PG_URL, or in CI the postgres service on :5432 is used.
const adminUrl = process.env.GITHUB_STORE_TEST_PG_URL || (process.env.CI ? "postgres://postgres@127.0.0.1:5432/postgres" : "");

test("postgres: legacy jsonb-string rows are read and rewritten as objects; new writes are objects", { skip: !adminUrl && "no Postgres (set GITHUB_STORE_TEST_PG_URL)" }, async (t) => {
  const postgres = require("postgres");
  const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => undefined });
  const dbName = `github_store_${process.pid}`;
  let url = adminUrl;
  try {
    await admin.unsafe(`create database ${dbName}`);
    const parsed = new URL(adminUrl); parsed.pathname = `/${dbName}`; url = parsed.toString();
  } catch { /* single-database servers (pglite): use the admin database */ }
  await admin.end();
  t.after(async () => {
    await globalThis.__eliasGitHubDb?.end?.().catch(() => undefined);
    if (url === adminUrl) return;
    const cleanup = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => undefined });
    await cleanup.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await cleanup.end();
  });
  withEnv(t, { POSTGRES_URL: url, VERCEL: undefined });
  resetGlobals();
  const store = freshStore("lib/githubConnectionStore.ts");
  const crypto = freshStore("lib/assistant/crypto.ts");
  // Make the table through the store, then write a row the way the old code did. One shared client throughout, so
  // single-connection servers (pglite-socket) work too.
  await store.saveGitHubConnection(connection("seed-token", { userId: "github_seed" }));
  const sql = globalThis.__eliasGitHubDb;
  globalThis.__eliasGitHubRepositoryTaskDb = sql;
  globalThis.__eliasGitHubProposalDb = sql;
  await sql`delete from public.elias_github_connections where user_id = 'github_1'`; // re-runs on a shared test database
  const legacy = { userId: "github_1", login: "octo", tokenCiphertext: crypto.encryptSecret("legacy-token"), scopes: ["repo", "read:org"], connectionType: "repository", connectedAt: 1, updatedAt: 1 };
  await sql`insert into public.elias_github_connections (user_id, connection, updated_at) values (${legacy.userId}, ${JSON.stringify(legacy)}::jsonb, now())`;
  const [before] = await sql`select jsonb_typeof(connection) as kind from public.elias_github_connections where user_id = 'github_1'`;
  assert.equal(before.kind, "string", "fixture reproduces the double-encoded production row");

  const read = await store.getGitHubConnection("github_1");
  assert.equal(read.token, "legacy-token");
  const [after] = await sql`select jsonb_typeof(connection) as kind, connection->>'login' as login from public.elias_github_connections where user_id = 'github_1'`;
  assert.deepEqual({ ...after }, { kind: "object", login: "octo" });
  const [seed] = await sql`select jsonb_typeof(connection) as kind from public.elias_github_connections where user_id = 'github_seed'`;
  assert.equal(seed.kind, "object");

  const diagnosis = await store.diagnoseGitHubConnections();
  assert.equal(diagnosis.store, "postgres");
  assert.equal(JSON.stringify(diagnosis).includes("legacy-token"), false);
  assert.equal(JSON.stringify(diagnosis).includes("v2:"), false);

  // Repository tasks and write proposals use jsonb operators (jsonb_set, ->>, ||) that only work on objects.
  const tasks = freshStore("lib/githubRepositoryTaskStore.ts");
  await tasks.getGitHubRepositoryTask("rt_0", "github_1"); // creates the table
  await sql`delete from public.elias_github_repository_tasks where id = 'rt_1'`;
  await tasks.createGitHubRepositoryTask({ id: "rt_1", userId: "github_1", task: { id: "rt_1", status: "queued", approvals: [], workspace: [], events: [] }, updatedAt: 1 });
  const claimed = await tasks.claimGitHubRepositoryTaskStep("rt_1", "github_1");
  assert.equal(claimed.task.status, "running");
  await tasks.updateGitHubRepositoryTask("rt_1", "github_1", (record) => { record.task.status = "completed"; });
  assert.equal((await tasks.getGitHubRepositoryTask("rt_1", "github_1")).task.status, "completed");
  const [taskRow] = await sql`select jsonb_typeof(task) as kind from public.elias_github_repository_tasks where id = 'rt_1'`;
  assert.equal(taskRow.kind, "object");

  const proposals = freshStore("lib/githubWriteProposalStore.ts");
  if (typeof proposals.createGitHubWriteProposal === "function") {
    const proposal = await proposals.createGitHubWriteProposal("github_1", "create_branch", { owner: "o", repo: "r", branch: "b", base: "main" });
    const [proposalRow] = await sql`select jsonb_typeof(proposal) as kind from public.elias_github_write_proposals where id = ${proposal.id}`;
    assert.equal(proposalRow.kind, "object");
    const claimedProposal = await proposals.claimGitHubWriteProposal(proposal.id, "github_1", proposal.payloadHash);
    assert.equal(claimedProposal?.status, "executing");
    await proposals.completeGitHubWriteProposal(proposal.id, "github_1", { ok: true });
    const [done] = await sql`select proposal->>'status' as status from public.elias_github_write_proposals where id = ${proposal.id}`;
    assert.equal(done.status, "completed");
  }
});
