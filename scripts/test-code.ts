/* Integration test for the coding agent's Postgres pieces: the elias_code_sets store (jsonb objects, RLS on)
   and the repo tools end to end against the in-memory GitHub mock.
   Run: POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres npx tsx scripts/test-code.ts */
import assert from "node:assert/strict";
import { ready } from "@/lib/assistant/db";
import { CODE_TOOLS, getCodeSet, setGithubFetch } from "@/lib/assistant/code/github";
import { createMockGithub } from "@/lib/assistant/code/mockGithub";
import { postgresCodeStore } from "@/lib/assistant/code/store";

async function main() {
  const user = `code_${Date.now()}`;
  const gh = createMockGithub({ repo: "acme/app", files: { "src/a.ts": "export const a = 1;\n" } });
  setGithubFetch(gh.fetch);
  const ctx = { userId: user, conversationId: "conv1", timezone: "Africa/Lagos", githubToken: "t" };
  await CODE_TOOLS.repo_tree.run({ repo: "acme/app" }, ctx);
  await CODE_TOOLS.code_edit.run({ path: "src/a.ts", edits: [{ find: "= 1", replace: "= 2" }] }, ctx);
  const set = await getCodeSet(user, "conv1");
  assert.equal(set?.repo, "acme/app");
  assert.deepEqual(set?.files["src/a.ts"], { original: "export const a = 1;\n", content: "export const a = 2;\n" });
  const db = await ready();
  const row = (await db`select jsonb_typeof(files) as t, files->'src/a.ts'->>'content' as c from public.elias_code_sets where user_id = ${user}`)[0];
  assert.deepEqual([row.t, row.c], ["object", "export const a = 2;\n"], "files stored as a jsonb object, not a string");
  const committed = await CODE_TOOLS.code_commit.run({ message: "Bump a" }, ctx) as { branch: string; sha: string };
  assert.match(gh.branchFiles(committed.branch)["src/a.ts"], /= 2/);
  const after = await postgresCodeStore.get(user, "conv1");
  assert.deepEqual([after?.branch, after?.baseSha, Object.keys(after?.files || {}).length, after?.commits.length], [committed.branch, committed.sha, 0, 1]);
  assert.equal((await postgresCodeStore.latest(user))?.id, after?.id);
  const rls = await db`select relrowsecurity from pg_class where relname = 'elias_code_sets'`;
  assert.equal(rls[0].relrowsecurity, true, "RLS on elias_code_sets");
  await postgresCodeStore.remove(user, "conv1");
  assert.equal(await postgresCodeStore.get(user, "conv1"), null);
  console.log("code store checks passed");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
