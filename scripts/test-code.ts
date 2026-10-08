/* Integration test for the coding agent's Postgres pieces: the elias_code_sets store (jsonb objects, RLS on)
   and the repo tools end to end against the in-memory GitHub mock.
   Run: POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres npx tsx scripts/test-code.ts */
import assert from "node:assert/strict";
import { ready } from "@/lib/assistant/db";
import { CODE_TOOLS, getCodeSet, setGithubFetch } from "@/lib/assistant/code/github";
import { createMockGithub } from "@/lib/assistant/code/mockGithub";
import { postgresCodeStore } from "@/lib/assistant/code/store";
import { conversationMode, ensureConversation, runTurn } from "@/lib/assistant/agent";
import { createJob, listJobs } from "@/lib/assistant/jobs";
import http from "node:http";
import type { AddressInfo } from "node:net";

/** Scripted model: records each request; in code mode it opens the repo, then answers. */
type Seen = { tools: string[]; system: string; model: string };
const seen: Seen[] = [];
function startModel(): Promise<number> {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || "{}") as { model: string; messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }>; stream?: boolean };
    if (data.tools) seen.push({ tools: data.tools.map((tool) => tool.function.name), system: data.messages[0].content, model: data.model });
    const last = data.messages[data.messages.length - 1];
    const wantsTree = data.tools?.some((tool) => tool.function.name === "repo_tree") && last.role !== "tool";
    const message = !data.tools ? { role: "assistant", content: '{"facts":[]}' } : wantsTree
      ? { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "repo_tree", arguments: JSON.stringify({ repo: "acme/app" }) } }] }
      : { role: "assistant", content: last.role === "tool" ? `Opened: ${last.content.slice(0, 60)}` : "Hi." };
    if (!data.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message }] })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    const calls = (message as { tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }).tool_calls;
    if (calls) calls.forEach((call, index) => send({ tool_calls: [{ index, ...call }] }));
    else send({ content: message.content });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

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

  // Code mode: conversation kind, tools offered, prompt, strong tier, code jobs.
  process.env.ELIAS_AGENT_BASE_URL = `http://127.0.0.1:${await startModel()}`;
  process.env.ELIAS_AGENT_PROVIDERS = "custom";
  process.env.ELIAS_AGENT_FAST_MODEL = "mock-fast";
  process.env.ELIAS_AGENT_STRONG_MODEL = "mock-strong";
  process.env.ELIAS_DISABLE_JOB_KICK = "1";
  const chat = await runTurn({ userId: user, text: "hello there", githubToken: "t" });
  assert.ok(!seen[seen.length - 1].tools.includes("repo_tree"), "chat mode hides code tools");
  assert.equal((await conversationMode(user, chat.conversationId)).mode, "chat");
  const coded = await runTurn({ userId: user, text: "open the repo", githubToken: "t", mode: "code" });
  const first = seen.find((item) => item.tools.includes("repo_tree"));
  assert.ok(first && first.tools.includes("code_commit") && first.tools.includes("code_verify") && first.tools.includes("code_start_job"), "code mode offers code tools");
  assert.match(first!.system, /CODE MODE/);
  assert.match(first!.system, /WORKING SET: no repo opened/);
  assert.equal(coded.tier, "strong");
  assert.match(coded.reply, /Opened/);
  assert.equal((await conversationMode(user, coded.conversationId)).mode, "code", "conversation stored as kind code");
  assert.equal((await getCodeSet(user, coded.conversationId))?.repo, "acme/app");
  // A later turn without mode resolves code mode from the conversation and shows the working set.
  seen.length = 0;
  await runTurn({ userId: user, conversationId: coded.conversationId, text: "what now", githubToken: "t" });
  assert.match(seen[0].system, /WORKING SET: acme\/app, base main/);
  // Code jobs: kind code, and their work conversation uses the parent chat's working set.
  const job = await createJob(user, { title: "Refactor", prompt: "Refactor a", kind: "code", conversationId: coded.conversationId });
  assert.equal(job.kind, "code");
  assert.equal((await listJobs(user)).find((item) => item.id === job.id)?.kind, "code");
  assert.deepEqual(await conversationMode(user, job.workConversationId!), { mode: "code", codeKey: coded.conversationId });
  const other = await ensureConversation(user, undefined, "plain", "chat");
  assert.equal((await conversationMode(user, other)).mode, "chat");
  console.log("code mode checks passed");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
