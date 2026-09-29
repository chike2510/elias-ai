import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
function loadTypeScript(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(sourcePath); loaded.filename = sourcePath; loaded.paths = Module._nodeModulePaths(dirname(sourcePath)); loaded._compile(compiled, sourcePath); return loaded.exports;
}

test("an approved commit proposal is exact-payload, owner-bound, and single-use", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "elias-github-proposal-"));
  const oldPath = process.env.ELIAS_GITHUB_PROPOSAL_STORE_PATH;
  const oldPostgres = process.env.POSTGRES_URL;
  const oldVercel = process.env.VERCEL;
  process.env.ELIAS_GITHUB_PROPOSAL_STORE_PATH = join(directory, "proposals.json"); delete process.env.POSTGRES_URL; delete process.env.VERCEL;
  globalThis.__eliasGitHubProposalStore = undefined;
  const store = loadTypeScript(path.resolve("lib/githubWriteProposalStore.ts"));
  t.after(() => {
    if (oldPath === undefined) delete process.env.ELIAS_GITHUB_PROPOSAL_STORE_PATH; else process.env.ELIAS_GITHUB_PROPOSAL_STORE_PATH = oldPath;
    if (oldPostgres === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = oldPostgres;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    globalThis.__eliasGitHubProposalStore = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  const payload = { owner: "acme", repo: "widget", branch: "elias/task-42", base: "main", message: "Update the project", files: [{ path: "src/new.ts", content: "export const x = 1;" }, { path: "src/old.ts", delete: true }] };
  const proposal = await store.createGitHubWriteProposal("alice", "commit_files", payload, 60_000);
  assert.equal(proposal.files[0].path, "src/new.ts");
  assert.match(proposal.files[0].contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(proposal.files[1], { path: "src/old.ts", contentHash: null, deleted: true });
  const changedPayload = { ...payload, files: [{ ...payload.files[0], content: "tampered" }, payload.files[1]] };
  assert.equal(await store.claimGitHubWriteProposal(proposal.id, "alice", store.hashGitHubWritePayload(changedPayload)), undefined);
  assert.equal(await store.claimGitHubWriteProposal(proposal.id, "bob", store.hashGitHubWritePayload(payload)), undefined);
  const claimed = await store.claimGitHubWriteProposal(proposal.id, "alice", store.hashGitHubWritePayload(payload));
  assert.equal(claimed.status, "executing");
  assert.equal(await store.claimGitHubWriteProposal(proposal.id, "alice", store.hashGitHubWritePayload(payload)), undefined);
  await store.completeGitHubWriteProposal(proposal.id, "alice", { commitSha: "abc123", message: "Committed." });
  assert.equal(globalThis.__eliasGitHubProposalStore.proposals.get(proposal.id).status, "completed");
});
