import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function hash(payload) { return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex"); }
function loadTypeScript(sourcePath, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath); loaded.filename = sourcePath; loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) { if (Object.hasOwn(mocks, request)) return mocks[request]; return originalLoad.call(this, request, parent, isMain); };
  try { loaded._compile(compiled, sourcePath); } finally { Module._load = originalLoad; }
  return loaded.exports;
}
function response(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers }); }

const fakeProposals = () => {
  let proposal;
  let receipt;
  const functions = {
    async createGitHubWriteProposal(userId, action, payload) {
      proposal = { id: "proposal_fixture", userId, action, payloadHash: hash(payload), owner: payload.owner, repo: payload.repo, branch: payload.branch, base: payload.base, files: payload.files, expiresAt: Date.now() + 60_000, status: "pending" };
      return structuredClone(proposal);
    },
    async claimGitHubWriteProposal(id, userId, payloadHash) {
      if (!proposal || proposal.id !== id || proposal.userId !== userId || proposal.status !== "pending" || proposal.payloadHash !== payloadHash || proposal.expiresAt <= Date.now()) return undefined;
      proposal.status = "executing"; return { id: proposal.id };
    },
    async completeGitHubWriteProposal(id, userId, value) { assert.equal(id, proposal.id); assert.equal(userId, proposal.userId); proposal.status = "completed"; receipt = value; },
    async failGitHubWriteProposal(id, userId, value) { assert.equal(id, proposal.id); assert.equal(userId, proposal.userId); proposal.status = "failed"; proposal.error = value; },
    hashGitHubWritePayload: hash,
  };
  return { functions, get proposal() { return proposal; }, get receipt() { return receipt; } };
}

test("atomic commit requires exact one-use approval and creates only a feature branch with the proposed tree", async (t) => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  const proposals = fakeProposals();
  let blobNumber = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    calls.push({ url: url.toString(), method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.pathname === "/user") return response({ login: "alice" }, 200, { "x-oauth-scopes": "repo" });
    if (url.pathname.endsWith(`/git/commits/${"a".repeat(40)}`)) return response({ tree: { sha: "base-tree" } });
    if (url.pathname.endsWith("/git/blobs") && method === "POST") return response({ sha: `blob-${++blobNumber}` }, 201);
    if (url.pathname.endsWith("/git/trees") && method === "POST") return response({ sha: "new-tree" }, 201);
    if (url.pathname.endsWith("/git/commits") && method === "POST") return response({ sha: "new-commit", html_url: "https://github.com/acme/widget/commit/new-commit" }, 201);
    if (url.pathname.endsWith("/git/refs") && method === "POST") return response({ ref: "refs/heads/elias/task-42" }, 201);
    throw new Error(`Unexpected mocked network request: ${method} ${url}`);
  };
  t.after(() => { globalThis.fetch = oldFetch; });

  const route = loadTypeScript(path.resolve("app/api/github/actions/route.ts"), {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth": { getSession: async () => ({ userId: "alice" }) },
    "@/lib/githubConnectionStore": { getGitHubToken: async () => "mock-token" },
    "@/lib/githubWriteProposalStore": proposals.functions,
  });
  const payload = { action: "commit_files", owner: "acme", repo: "widget", branch: "elias/task-42", base: "main", baseSha: "a".repeat(40), message: "Update project", files: [{ path: "src/new.ts", content: "export const value = 1;" }, { path: "src/old.ts", delete: true }] };
  const post = async (value) => route.POST(new Request("https://elias.test/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }));

  const preparedResponse = await post({ ...payload, phase: "prepare" });
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  assert.equal(prepared.proposalId, "proposal_fixture");
  assert.equal(proposals.proposal.files[1].delete, true);

  const beforeTamper = calls.filter((call) => call.method === "POST").length;
  const tampered = await post({ ...payload, files: [{ ...payload.files[0], content: "tampered" }, payload.files[1]], phase: "execute", proposalId: prepared.proposalId, confirm: "CONFIRM_GITHUB_COMMIT_FILES" });
  assert.equal(tampered.status, 409);
  assert.equal(calls.filter((call) => call.method === "POST").length, beforeTamper);

  const executedResponse = await post({ ...payload, phase: "execute", proposalId: prepared.proposalId, confirm: "CONFIRM_GITHUB_COMMIT_FILES" });
  assert.equal(executedResponse.status, 200);
  const executed = await executedResponse.json();
  assert.equal(executed.branch, "elias/task-42");
  assert.equal(executed.base, "main");
  assert.equal(executed.baseSha, "a".repeat(40));
  assert.equal(executed.commitSha, "new-commit");
  assert.deepEqual(executed.files, ["src/new.ts", "src/old.ts"]);
  const treeCall = calls.find((call) => call.url.endsWith("/git/trees") && call.method === "POST");
  assert.equal(treeCall.body.base_tree, "base-tree");
  assert.ok(treeCall.body.tree.some((entry) => entry.path === "src/old.ts" && entry.sha === null));
  const commitCall = calls.find((call) => call.url.endsWith("/git/commits") && call.method === "POST");
  assert.deepEqual(commitCall.body.parents, ["a".repeat(40)]);
  const refCall = calls.find((call) => call.url.endsWith("/git/refs") && call.method === "POST");
  assert.equal(refCall.body.ref, "refs/heads/elias/task-42");
  assert.equal(refCall.body.sha, "new-commit");
  assert.equal(proposals.proposal.status, "completed");
  assert.ok(proposals.receipt.commitSha);
  assert.equal(calls.some((call) => call.method === "PATCH"), false, "the base branch must never be updated");

  const replay = await post({ ...payload, phase: "execute", proposalId: prepared.proposalId, confirm: "CONFIRM_GITHUB_COMMIT_FILES" });
  assert.equal(replay.status, 409);
  assert.equal(calls.filter((call) => call.method === "POST").length, beforeTamper + 4);
});

test("repository-task commit payload validation rejects environment secrets and duplicate paths", async (t) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ login: "alice" }, 200, { "x-oauth-scopes": "repo" });
  t.after(() => { globalThis.fetch = oldFetch; });
  const proposals = fakeProposals();
  const route = loadTypeScript(path.resolve("app/api/github/actions/route.ts"), {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth": { getSession: async () => ({ userId: "alice" }) },
    "@/lib/githubConnectionStore": { getGitHubToken: async () => "mock-token" },
    "@/lib/githubWriteProposalStore": proposals.functions,
  });
  const post = (files, baseSha) => route.POST(new Request("https://elias.test/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit_files", owner: "acme", repo: "widget", branch: "elias/task-1", base: "main", baseSha, files, phase: "prepare" }) }));
  assert.equal((await post([{ path: ".env", content: "API_KEY=secret" }])).status, 400);
  assert.equal((await post([{ path: "same.ts", content: "one" }, { path: "same.ts", content: "two" }])).status, 400);
  assert.equal((await post([{ path: "valid.ts", content: "valid" }], "not-a-commit-sha")).status, 400);
  assert.equal(proposals.proposal, undefined);
});
