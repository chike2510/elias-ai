import { randomBytes } from "node:crypto";
import { addMessage, ensureConversation, runTurn } from "@/lib/assistant/agent";
import { newId, ready } from "@/lib/assistant/db";
import { notifyUser } from "@/lib/assistant/push";
import { getGitHubConnection } from "@/lib/githubConnectionStore";
import { captureError } from "@/lib/observability";

/**
 * Background jobs: long work the user (or the agent, via start_background_job) hands off.
 * A job runs as a series of bounded "slices", each one agent turn with a small tool budget,
 * in its own hidden work conversation. Slices are claimed with a lease (lease_owner +
 * lease_until, `for update skip locked`) so two ticks never run the same job, and a slice
 * that dies simply lets its lease expire and is picked up again.
 */

export type JobKind = "research" | "task" | "code";
export type JobStatus = "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";
export type JobStep = { n: number; at: string; summary: string; tools: string[]; ok: boolean };
export type Job = {
  id: string; title: string; kind: JobKind; prompt: string; status: JobStatus; steps: JobStep[]; result: string | null; error: string | null;
  slices: number; maxSlices: number; conversationId: string; workConversationId: string | null; approvalIds: string[];
  createdAt: string; updatedAt: string; finishedAt: string | null;
};
type JobRow = Job & { userId: string; timezone: string; claims: number };

export const ACTIVE: JobStatus[] = ["queued", "running", "waiting_approval"];
const MAX_ACTIVE_PER_USER = 3;
const LEASE_SECONDS = 270; // under the 300s function limit
const SLICE_TOOL_STEPS = 5;
const DEFAULT_SLICES: Record<JobKind, number> = { research: 5, task: 6, code: 10 };
/** Code jobs edit, commit and wait on CI, so each slice gets more tool steps. */
const CODE_SLICE_TOOL_STEPS = 8;

function row(item: Record<string, unknown>): JobRow {
  const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;
  return {
    id: String(item.id), userId: String(item.user_id), title: String(item.title), kind: (item.kind === "research" ? "research" : item.kind === "code" ? "code" : "task"), prompt: String(item.prompt),
    status: String(item.status) as JobStatus, steps: Array.isArray(item.steps) ? item.steps as JobStep[] : [], result: (item.result as string) || null, error: (item.error as string) || null,
    slices: Number(item.slices || 0), maxSlices: Number(item.max_slices || 6), claims: Number(item.claims || 0), conversationId: String(item.conversation_id),
    workConversationId: (item.work_conversation_id as string) || null, approvalIds: Array.isArray(item.approval_ids) ? item.approval_ids as string[] : [],
    timezone: String(item.timezone || "Africa/Lagos"), createdAt: iso(item.created_at)!, updatedAt: iso(item.updated_at)!, finishedAt: iso(item.finished_at),
  };
}

function publicJob(job: JobRow): Job {
  const { userId: _u, timezone: _t, claims: _c, ...rest } = job;
  return rest;
}

export async function createJob(userId: string, input: { title?: string; prompt: string; kind?: string; conversationId?: string; timezone?: string; announce?: boolean }) {
  const prompt = input.prompt.trim().slice(0, 6000);
  if (!prompt) throw new Error("Tell me what the job should do.");
  const kind: JobKind = input.kind === "research" ? "research" : input.kind === "code" ? "code" : "task";
  const title = (input.title || prompt).replace(/\s+/g, " ").trim().slice(0, 80);
  const db = await ready();
  const active = Number((await db`select count(*)::int as n from public.elias_jobs where user_id = ${userId} and status in ('queued', 'running', 'waiting_approval')`)[0]?.n || 0);
  if (active >= MAX_ACTIVE_PER_USER) throw new Error(`You already have ${active} background jobs going. Cancel one or wait for one to finish.`);
  const conversationId = await ensureConversation(userId, input.conversationId, `Background: ${title}`, "chat");
  const workConversationId = await ensureConversation(userId, undefined, `Job: ${title}`, "job");
  const rows = await db`insert into public.elias_jobs (id, user_id, conversation_id, work_conversation_id, title, kind, prompt, max_slices, timezone)
    values (${newId("job")}, ${userId}, ${conversationId}, ${workConversationId}, ${title}, ${kind}, ${prompt}, ${DEFAULT_SLICES[kind]}, ${input.timezone || "Africa/Lagos"}) returning *`;
  const job = row(rows[0]);
  if (input.announce) await addMessage(userId, conversationId, "assistant", `On it in the background: **${title}**. I'll post the result here and notify you when it's done.`, { kind: "job_started", jobId: job.id });
  return publicJob(job);
}

export async function listJobs(userId: string, limit = 30) {
  const db = await ready();
  const rows = await db`select * from public.elias_jobs where user_id = ${userId} order by (status in ('queued', 'running', 'waiting_approval')) desc, created_at desc limit ${limit}`;
  return rows.map((item) => publicJob(row(item)));
}

export async function getJob(userId: string, id: string) {
  const db = await ready();
  const found = (await db`select * from public.elias_jobs where id = ${id} and user_id = ${userId}`)[0];
  return found ? publicJob(row(found)) : null;
}

export async function isJobConversation(conversationId: string) {
  const db = await ready();
  return Boolean((await db`select 1 from public.elias_jobs where work_conversation_id = ${conversationId} limit 1`)[0]);
}

export async function cancelJob(userId: string, id: string) {
  const db = await ready();
  const rows = await db`update public.elias_jobs set status = 'cancelled', lease_owner = null, lease_until = null, finished_at = now(), updated_at = now()
    where id = ${id} and user_id = ${userId} and status in ('queued', 'running', 'waiting_approval') returning *`;
  return rows[0] ? publicJob(row(rows[0])) : null;
}

/** Claims runnable jobs: queued, or running with an expired lease (a slice that died). Exclusive across ticks. */
export async function claimJobs(limit = 1, filter: { jobId?: string; userId?: string } = {}) {
  const db = await ready();
  const owner = randomBytes(8).toString("hex");
  const lease = `${LEASE_SECONDS} seconds`;
  const rows = filter.jobId
    ? await db`update public.elias_jobs set status = 'running', lease_owner = ${owner}, lease_until = now() + ${lease}::interval, claims = claims + 1, updated_at = now()
      where id in (select id from public.elias_jobs where id = ${filter.jobId} and (status = 'queued' or (status = 'running' and (lease_until is null or lease_until < now()))) for update skip locked) returning *`
    : filter.userId
    ? await db`update public.elias_jobs set status = 'running', lease_owner = ${owner}, lease_until = now() + ${lease}::interval, claims = claims + 1, updated_at = now()
      where id in (select id from public.elias_jobs where user_id = ${filter.userId} and (status = 'queued' or (status = 'running' and (lease_until is null or lease_until < now()))) order by updated_at limit ${limit} for update skip locked) returning *`
    : await db`update public.elias_jobs set status = 'running', lease_owner = ${owner}, lease_until = now() + ${lease}::interval, claims = claims + 1, updated_at = now()
      where id in (select id from public.elias_jobs where status = 'queued' or (status = 'running' and (lease_until is null or lease_until < now())) order by updated_at limit ${limit} for update skip locked) returning *`;
  return rows.map((item) => ({ job: row(item), owner }));
}

export async function hasRunnableJobs() {
  const db = await ready();
  return Boolean((await db`select 1 from public.elias_jobs where status = 'queued' or (status = 'running' and lease_until < now()) limit 1`)[0]);
}

function sliceContext(job: JobRow, n: number, last: boolean) {
  return `BACKGROUND JOB "${job.title}" (${job.kind}). Slice ${n} of at most ${job.maxSlices}.
TASK: ${job.prompt}

HOW TO WORK: Make real progress this slice with tools (up to ${job.kind === "code" ? CODE_SLICE_TOOL_STEPS : SLICE_TOOL_STEPS} tool steps). ${job.kind === "research" ? "Deep research: search several angles, open the best sources, cross-check facts, note URLs." : job.kind === "code" ? "Coding job: the working set (staged edits, branch, CI state) persists between slices; commit before a slice ends when a change is complete, and code_verify after each commit." : "Do the steps in order; check each one worked before moving on."}
Your earlier replies in this conversation are your notes from previous slices; build on them, don't redo work.
Anything that sends, books, pays, invites or deletes pauses for the user's approval: just call the tool and end the slice.
You are already inside a background job: never call start_background_job or background_jobs.
${last ? "This is the LAST slice: do not call tools. Write the final result now and end with STATUS: DONE.\n" : ""}
END YOUR REPLY with exactly one of these on its own line:
STATUS: CONTINUE, then your working notes (every finding, URL and decision the next slice needs; it will not see tool output).
STATUS: DONE, then the final result for the user. It is posted to their chat: lead with the answer, then key details and sources. Short sections or bullets are fine here, unlike normal chat.`;
}

/** Splits a slice reply into its status and the text after the marker. */
export function parseSlice(reply: string): { status: "done" | "continue" | null; text: string } {
  const matches = [...reply.matchAll(/STATUS:\s*(DONE|CONTINUE)\b[:.\-\s]*/gi)];
  if (!matches.length) return { status: null, text: reply.trim() };
  const last = matches[matches.length - 1];
  const after = reply.slice((last.index || 0) + last[0].length).trim();
  const before = reply.slice(0, last.index || 0).trim();
  return { status: last[1].toUpperCase() === "DONE" ? "done" : "continue", text: after || before };
}

async function appendStep(jobId: string, owner: string, step: JobStep, set: { status: JobStatus; slices: number; approvalIds?: string[]; result?: string | null; error?: string | null; finished?: boolean }) {
  const db = await ready();
  const rows = await db`update public.elias_jobs set steps = steps || ${db.json([step] as never)}, status = ${set.status}, slices = ${set.slices},
    approval_ids = ${db.json((set.approvalIds || []) as never)}, result = coalesce(${set.result ?? null}, result), error = ${set.error ?? null},
    finished_at = ${set.finished ? new Date() : null}, lease_owner = null, lease_until = null, updated_at = now()
    where id = ${jobId} and lease_owner = ${owner} and status = 'running' returning id`;
  return rows.length > 0; // false when the job was cancelled mid-slice
}

async function finish(job: JobRow, owner: string, step: JobStep, result: string, failed = false) {
  const ok = await appendStep(job.id, owner, step, { status: failed ? "failed" : "done", slices: step.n, result: failed ? null : result, error: failed ? result : null, finished: true });
  if (!ok) return false;
  const text = failed
    ? `Background job **${job.title}** couldn't finish: ${result}`
    : `Background job done: **${job.title}**\n\n${result}`;
  await addMessage(job.userId, job.conversationId, "assistant", text, { kind: failed ? "job_failed" : "job_result", jobId: job.id });
  await notifyUser(job.userId, "jobs", { title: failed ? `Job stopped: ${job.title}` : `Done: ${job.title}`, body: failed ? result : result.replace(/[*#`>_]/g, ""), url: `/chat?id=${job.conversationId}`, tag: `job-${job.id}` });
  return true;
}

/** Runs one slice of a claimed job. Returns whether the job wants another slice. */
export async function runSlice(job: JobRow, owner: string): Promise<{ id: string; status: JobStatus; more: boolean }> {
  const n = job.slices + 1;
  const last = n >= job.maxSlices;
  const at = new Date().toISOString();
  if (job.claims > job.maxSlices + 3) {
    await finish(job, owner, { n, at, summary: "Stopped after repeated interruptions", tools: [], ok: false }, "it kept getting interrupted. Try handing it off again, maybe split into smaller parts.", true);
    return { id: job.id, status: "failed", more: false };
  }
  try {
    const githubToken = await getGitHubConnection(job.userId).then((item) => item?.token).catch(() => undefined);
    const turn = await runTurn({
      userId: job.userId, conversationId: job.workConversationId || undefined, title: `Job: ${job.title}`, origin: "job", timezone: job.timezone, githubToken,
      text: n === 1 ? `Start the job: ${job.prompt}` : `Continue the job (slice ${n}).`, maxSteps: last ? 1 : job.kind === "code" ? CODE_SLICE_TOOL_STEPS : SLICE_TOOL_STEPS, extraContext: sliceContext(job, n, last),
      ...(job.kind === "code" ? { mode: "code" as const, codeConversationId: job.conversationId, modelChoice: "strong" } : {}),
    });
    const tools = turn.steps.slice(0, 8);
    if (turn.approvals.length) {
      const ids = turn.approvals.map((item) => item.id);
      const ok = await appendStep(job.id, owner, { n, at, summary: `Waiting for your OK: ${turn.approvals[0].summary.split("\n")[0].slice(0, 140)}`, tools, ok: true }, { status: "waiting_approval", slices: n, approvalIds: ids });
      if (ok) await notifyUser(job.userId, "approvals", { title: `Approval needed: ${job.title}`, body: turn.approvals[0].summary.split("\n")[0], url: `/chat?id=${job.workConversationId}`, tag: `approval-${ids[0]}` });
      return { id: job.id, status: ok ? "waiting_approval" : "cancelled", more: false };
    }
    const parsed = parseSlice(turn.reply);
    if (parsed.status === "done" || last) {
      const ok = await finish(job, owner, { n, at, summary: "Finished", tools, ok: true }, parsed.text || turn.reply);
      return { id: job.id, status: ok ? "done" : "cancelled", more: false };
    }
    const ok = await appendStep(job.id, owner, { n, at, summary: parsed.text.split("\n").find((line) => line.trim())?.replace(/[*#`>_-]/g, "").trim().slice(0, 160) || "Working…", tools, ok: true }, { status: "queued", slices: n });
    return { id: job.id, status: ok ? "queued" : "cancelled", more: ok };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void captureError(error, { area: "job", jobId: job.id });
    const failures = job.steps.filter((step) => !step.ok).length + 1;
    if (failures >= 2) {
      await finish(job, owner, { n, at, summary: `Error: ${message.slice(0, 140)}`, tools: [], ok: false }, message.slice(0, 400), true);
      return { id: job.id, status: "failed", more: false };
    }
    const ok = await appendStep(job.id, owner, { n, at, summary: `Hit a snag, retrying: ${message.slice(0, 120)}`, tools: [], ok: false }, { status: "queued", slices: job.slices });
    return { id: job.id, status: ok ? "queued" : "cancelled", more: ok };
  }
}

/** Claims and runs up to `limit` job slices (one slice per job). */
export async function advanceJobs(limit = 1, filter: { jobId?: string; userId?: string } = {}) {
  const claimed = await claimJobs(limit, filter);
  const results: Array<{ id: string; status: JobStatus; more: boolean }> = [];
  for (const { job, owner } of claimed) results.push(await runSlice(job, owner));
  return results;
}

/** After an approval decision: when a waiting job has no pending approvals left, queue it again. Returns the job id to kick. */
export async function resumeAfterApproval(userId: string, approvalId: string) {
  const db = await ready();
  const job = (await db`select * from public.elias_jobs where user_id = ${userId} and status = 'waiting_approval' and approval_ids @> ${db.json([approvalId] as never)} limit 1`)[0];
  if (!job) return null;
  const ids = (job.approval_ids || []) as string[];
  const pending = Number((await db`select count(*)::int as n from public.elias_approvals where id = any(${db.array(ids.length ? ids : ["-"])}::text[]) and status = 'pending'`)[0]?.n || 0);
  if (pending) return null;
  const decided = await db`select status from public.elias_approvals where id = ${approvalId}`;
  const step: JobStep = { n: Number(job.slices), at: new Date().toISOString(), summary: decided[0]?.status === "declined" ? "You declined; carrying on without it" : "You approved; carrying on", tools: [], ok: true };
  const rows = await db`update public.elias_jobs set status = 'queued', steps = steps || ${db.json([step] as never)}, updated_at = now() where id = ${job.id as string} and status = 'waiting_approval' returning id`;
  return rows[0] ? String(rows[0].id) : null;
}

function baseUrl() {
  const explicit = process.env.ELIAS_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/**
 * Fire-and-forget: asks /api/cron/jobs (a fresh function with its own time budget) to run the
 * next slice. Returns false when it can't (no public URL or CRON_SECRET, e.g. local dev);
 * the 5-minute cron tick picks the job up anyway.
 */
export async function kickJobs(jobId?: string) {
  const base = baseUrl();
  const secret = process.env.CRON_SECRET;
  if (!base || !secret || process.env.ELIAS_DISABLE_JOB_KICK) return false;
  try {
    const response = await fetch(`${base}/api/cron/jobs`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(8000), cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
