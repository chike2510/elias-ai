/* Coding-agent evals against an in-memory GitHub (lib/assistant/code/mockGithub.ts).
 *
 * Each case in evals/code.jsonl gives a repo, a CI rule, and a `script`: the tool calls a scripted model makes
 * in order (one per model step), then `reply`. The score measures Elias's side: what the tools did to the repo,
 * what paused for approval, what was refused, which cards showed, and that main was never touched without approval.
 * Cases with `approve: true` then approve the first pending approval and check the result.
 *
 * Needs Postgres (PGlite works):  POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres npx tsx evals/code.ts
 * Options: ELIAS_EVAL_FILTER=<id prefix>, ELIAS_EVAL_JSON=path. */
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Step = { tool: string; args?: Record<string, unknown> };
type Expect = {
  tools?: string[]; approval?: string | null; executed?: string[]; notExecuted?: string[]; errorFrom?: string; errorMatches?: string;
  branchFile?: { path: string; includes?: string; absent?: boolean }; mainUnchanged?: boolean; card?: string; ci?: string; attempts?: number;
  noWrites?: boolean; prOpened?: boolean; merged?: boolean; stagedFiles?: number; outputMatches?: { tool: string; pattern: string };
  afterApprove?: { prOpened?: boolean; merged?: boolean; mainFile?: { path: string; includes: string } };
};
type Case = { id: string; category: string; input: string; mode?: "code" | "chat"; repo: { files: Record<string, string>; failIf?: string }; prepare?: Step[]; script: Step[]; reply?: string; approve?: boolean; expect: Expect };

const cases: Case[] = readFileSync(new URL("./code.jsonl", import.meta.url), "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
const filter = process.env.ELIAS_EVAL_FILTER;
const selected = filter ? cases.filter((item) => item.id.startsWith(filter) || item.category === filter) : cases;
let current: Case | null = null;
const toolOutputs: Array<{ tool: string; content: string }> = [];

/** Scripted model: the Nth tool result since the user's message triggers script step N+1. */
function startModel(): Promise<number> {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || "{}") as { messages: Array<{ role: string; content: string | null; tool_call_id?: string }>; tools?: unknown[]; stream?: boolean };
    const lastUser = data.messages.map((item) => item.role).lastIndexOf("user");
    const done = data.messages.slice(lastUser + 1).filter((item) => item.role === "tool");
    if (done.length) { const last = done[done.length - 1]; toolOutputs.push({ tool: current?.script[done.length - 1]?.tool || "?", content: String(last.content || "") }); }
    const next = current?.script[done.length];
    const message: Record<string, unknown> = !data.tools ? { role: "assistant", content: '{"facts":[]}' }
      : next ? { role: "assistant", content: null, tool_calls: [{ id: `call_${done.length}_${Date.now()}`, type: "function", function: { name: next.tool, arguments: JSON.stringify(next.args || {}) } }] }
      : { role: "assistant", content: current?.reply || "Done." };
    if (!data.stream) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message }] })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    const calls = message.tool_calls as Array<{ id: string; type: string; function: { name: string; arguments: string } }> | undefined;
    if (calls) calls.forEach((call, index) => send({ tool_calls: [{ index, ...call }] }));
    else send({ content: message.content });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function main() {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is required.");
  for (const key of ["VERCEL_API_TOKEN", "PAYSTACK_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "BROWSERBASE_API_KEY", "GITHUB_TOKEN"]) delete process.env[key];
  process.env.ELIAS_AGENT_BASE_URL = `http://127.0.0.1:${await startModel()}`;
  process.env.ELIAS_AGENT_PROVIDERS = "custom";
  process.env.ELIAS_EMBED_PROVIDER = "off";
  process.env.ELIAS_DISABLE_JOB_KICK = "1";
  const { runTurn, decideApproval } = await import("@/lib/assistant/agent");
  const { setGithubFetch, getCodeSet, clearCodeCaches, CODE_TOOLS } = await import("@/lib/assistant/code/github");
  const { setVerifyClock } = await import("@/lib/assistant/code/verify");
  const { createMockGithub } = await import("@/lib/assistant/code/mockGithub");
  let now = Date.parse("2026-10-08T12:00:00Z");
  setVerifyClock({ now: () => now, sleep: async (ms: number) => { now += ms; } });
  const run = `codeeval_${Date.now()}`;
  const results: Array<{ id: string; category: string; pass: boolean; failures: string[]; tools: string[] }> = [];

  for (const item of selected) {
    current = item;
    toolOutputs.length = 0;
    const failIf = item.repo.failIf;
    const gh = createMockGithub({ repo: "acme/app", files: item.repo.files, ci: (files) => failIf && Object.values(files).some((text) => text.includes(failIf)) ? { failLog: `##[group]Run npx tsc --noEmit\nsrc/app.ts(3,1): error TS2304: Cannot find name '${failIf}'.\n##[error]Process completed with exit code 2.` } : null, preview: (sha) => `https://app-git-${sha.slice(0, 6)}.vercel.app` });
    setGithubFetch(gh.fetch);
    clearCodeCaches();
    const mainBefore = JSON.stringify(gh.branchFiles("main"));
    const userId = `${run}_${item.id}`;
    const tools: string[] = [];
    const failures: string[] = [];
    try {
      let conversationId: string | undefined;
      if (item.prepare?.length) {
        // Prior state built directly with the tools (e.g. a pushed branch with an open PR).
        const { ensureConversation } = await import("@/lib/assistant/agent");
        conversationId = await ensureConversation(userId, undefined, "Code eval", "code");
        const ctx = { userId, conversationId, timezone: "Africa/Lagos", githubToken: "eval-token", approved: true };
        const { VERIFY_TOOLS } = await import("@/lib/assistant/code/verify");
        const { PR_TOOLS } = await import("@/lib/assistant/code/pr");
        const all = { ...CODE_TOOLS, ...VERIFY_TOOLS, ...PR_TOOLS } as Record<string, { run: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown> }>;
        for (const step of item.prepare) await all[step.tool].run(step.args || {}, ctx);
      }
      const writesBefore = gh.calls.filter((call) => call.method !== "GET").length;
      const turn = await runTurn({ userId, conversationId, text: item.input, timezone: "Africa/Lagos", githubToken: "eval-token", mode: item.mode || "code", onEvent: (event) => { if (event.type === "status") tools.push(event.tool); } });
      const e = item.expect;
      const ok = (tool: string) => turn.actions.some((action) => action.tool === tool && action.ok);
      if (e.tools && JSON.stringify(tools) !== JSON.stringify(e.tools)) failures.push(`tools: expected ${e.tools.join(",")}, got ${tools.join(",")}`);
      if (e.approval !== undefined) {
        const got = turn.approvals[0]?.tool ?? null;
        if (got !== e.approval) failures.push(`approval: expected ${e.approval}, got ${got}`);
      }
      for (const tool of e.executed || []) if (!ok(tool)) failures.push(`executed: ${tool} did not run ok`);
      for (const tool of e.notExecuted || []) if (ok(tool)) failures.push(`notExecuted: ${tool} ran`);
      const outputsOf = (tool: string) => item.script.map((step, index) => step.tool === tool ? toolOutputs[index]?.content || "" : null).filter((value): value is string => value !== null);
      if (e.errorFrom) {
        const outputs = outputsOf(e.errorFrom).filter((output) => output.startsWith("Error") || /"ok":false/.test(output));
        if (!outputs.length) failures.push(`errorFrom: ${e.errorFrom} didn't fail`);
        else if (e.errorMatches && !outputs.some((output) => new RegExp(e.errorMatches!, "i").test(output))) failures.push(`errorMatches: /${e.errorMatches}/ not in ${outputs[0].slice(0, 200)}`);
      }
      if (e.outputMatches && !outputsOf(e.outputMatches.tool).some((output) => new RegExp(e.outputMatches!.pattern, "i").test(output))) failures.push(`output of ${e.outputMatches.tool}: /${e.outputMatches.pattern}/ not found`);
      const set = await getCodeSet(userId, turn.conversationId);
      if (e.branchFile) {
        const files = set?.branch ? gh.branchFiles(set.branch) : {};
        const text = files[e.branchFile.path];
        if (e.branchFile.absent ? text !== undefined : text === undefined || (e.branchFile.includes && !text.includes(e.branchFile.includes))) failures.push(`branchFile: ${e.branchFile.path} on ${set?.branch || "(no branch)"} is ${text === undefined ? "missing" : JSON.stringify(text.slice(0, 80))}`);
        if (set?.branch && !set.branch.startsWith("elias/")) failures.push(`branch ${set.branch} isn't elias/*`);
      }
      if (e.mainUnchanged && JSON.stringify(gh.branchFiles("main")) !== mainBefore) failures.push("main changed");
      if (e.card && !turn.cards.some((card) => card.kind === e.card)) failures.push(`card: expected ${e.card}`);
      if (e.ci && set?.verify?.status !== e.ci) failures.push(`ci: expected ${e.ci}, got ${set?.verify?.status}`);
      if (e.attempts !== undefined && set?.verify?.attempt !== e.attempts) failures.push(`attempts: expected ${e.attempts}, got ${set?.verify?.attempt}`);
      if (e.noWrites && gh.calls.filter((call) => call.method !== "GET").length !== writesBefore) failures.push("noWrites: GitHub was written to");
      if (e.prOpened !== undefined && (gh.pulls.length > 0) !== e.prOpened) failures.push(`prOpened: expected ${e.prOpened}`);
      if (e.merged !== undefined && gh.pulls.some((pull) => pull.merged) !== e.merged) failures.push(`merged: expected ${e.merged}`);
      if (e.stagedFiles !== undefined && Object.keys(set?.files || {}).length !== e.stagedFiles) failures.push(`stagedFiles: expected ${e.stagedFiles}, got ${Object.keys(set?.files || {}).length}`);
      if (item.approve && e.afterApprove) {
        current = { ...item, script: [], reply: "Done." };
        const pending = turn.approvals[0];
        if (!pending) failures.push("approve: nothing pending");
        else {
          await decideApproval({ userId, approvalId: pending.id, decision: "approve", githubToken: "eval-token", timezone: "Africa/Lagos" });
          const a = e.afterApprove;
          if (a.prOpened !== undefined && (gh.pulls.length > 0) !== a.prOpened) failures.push(`afterApprove.prOpened: expected ${a.prOpened}`);
          if (a.merged !== undefined && gh.pulls.some((pull) => pull.merged) !== a.merged) failures.push(`afterApprove.merged: expected ${a.merged}`);
          if (a.mainFile && !(gh.branchFiles("main")[a.mainFile.path] || "").includes(a.mainFile.includes)) failures.push(`afterApprove.mainFile: ${a.mainFile.path} lacks ${a.mainFile.includes}`);
        }
      }
    } catch (error) {
      failures.push(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    results.push({ id: item.id, category: item.category, pass: !failures.length, failures, tools });
  }

  const byCategory = new Map<string, { pass: number; total: number }>();
  for (const result of results) {
    const bucket = byCategory.get(result.category) || { pass: 0, total: 0 };
    bucket.total += 1; if (result.pass) bucket.pass += 1;
    byCategory.set(result.category, bucket);
  }
  for (const result of results.filter((item) => !item.pass)) console.log(`FAIL ${result.id}: ${result.failures.join("; ")}\n     tools: ${result.tools.join(",")}`);
  for (const [category, bucket] of byCategory) console.log(`${category.padEnd(12)} ${bucket.pass}/${bucket.total}`);
  const passed = results.filter((item) => item.pass).length;
  console.log(`\nCODE score: ${passed}/${results.length}`);
  if (process.env.ELIAS_EVAL_JSON) writeFileSync(process.env.ELIAS_EVAL_JSON, JSON.stringify({ results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
