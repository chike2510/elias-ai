import { newId, ready } from "@/lib/assistant/db";
import type { RunAction } from "@/lib/browserRun/core";

/**
 * Browser runs live in Postgres so any runner (Cloudflare Worker, Node slice) can drive them and the app only watches:
 * elias_browser_runs holds the run state, elias_browser_run_steps one row per step with its small JPEG frame.
 */

export type RunStatus = "queued" | "running" | "awaiting_approval" | "awaiting_input" | "done" | "failed" | "stopped";
export const TERMINAL: RunStatus[] = ["done", "failed", "stopped"];

/** A pause: the action waiting for approval, or the question waiting for an answer. */
export type Pending =
  | { type: "approval"; summary: string; action: RunAction; key: string; history: string; since: string }
  | { type: "input"; kind: "question" | "captcha" | "code"; question: string; target?: number; x?: number; y?: number; since: string };
export type Resolution = { type: "approve" } | { type: "deny" } | { type: "answer"; text: string };

export type BrowserRun = {
  id: string; userId: string; conversationId: string | null; goal: string; startUrl: string;
  status: RunStatus; statusText: string; step: number; maxSteps: number; runner: string;
  pending: Pending | null; resolution: Resolution | null; keys: string[]; history: string[];
  summary: string | null; error: string | null; createdAt: string; updatedAt: string;
};
export type RunStep = { step: number; url: string; title: string; statusText: string; action: RunAction | null; click: { x: number; y: number } | null; frame: string | null; createdAt: string };

async function db() {
  const sql = await ready();
  globalThis.__eliasBrowserRunSchema ||= (async () => {
    await sql`create table if not exists public.elias_browser_runs (
      id text primary key, user_id text not null, conversation_id text, goal text not null, start_url text not null,
      status text not null default 'queued', status_text text not null default 'Starting the browser…',
      step integer not null default 0, max_steps integer not null default 30, runner text not null default 'worker',
      pending jsonb, resolution jsonb, keys jsonb not null default '[]'::jsonb, history jsonb not null default '[]'::jsonb,
      summary text, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await sql`create index if not exists elias_browser_runs_user_idx on public.elias_browser_runs(user_id, created_at desc)`;
    await sql`create table if not exists public.elias_browser_run_steps (
      run_id text not null references public.elias_browser_runs(id) on delete cascade, step integer not null,
      url text not null default '', title text not null default '', status_text text not null default '',
      action jsonb, click jsonb, frame text, created_at timestamptz not null default now(), primary key (run_id, step))`;
  })().catch((error) => { globalThis.__eliasBrowserRunSchema = undefined; throw error; });
  await globalThis.__eliasBrowserRunSchema;
  return sql;
}

declare global { var __eliasBrowserRunSchema: Promise<void> | undefined; }

const json = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
};

function toRun(row: Record<string, unknown>): BrowserRun {
  return {
    id: String(row.id), userId: String(row.user_id), conversationId: (row.conversation_id as string) || null,
    goal: String(row.goal), startUrl: String(row.start_url), status: row.status as RunStatus, statusText: String(row.status_text || ""),
    step: Number(row.step), maxSteps: Number(row.max_steps), runner: String(row.runner),
    pending: json<Pending | null>(row.pending, null), resolution: json<Resolution | null>(row.resolution, null),
    keys: json<string[]>(row.keys, []), history: json<string[]>(row.history, []),
    summary: (row.summary as string) || null, error: (row.error as string) || null,
    createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function createRun(input: { userId: string; conversationId: string | null; goal: string; startUrl: string; runner: string; maxSteps?: number }) {
  const sql = await db();
  const id = newId("brun");
  const rows = await sql`insert into public.elias_browser_runs (id, user_id, conversation_id, goal, start_url, runner, max_steps)
    values (${id}, ${input.userId}, ${input.conversationId}, ${input.goal.slice(0, 2000)}, ${input.startUrl}, ${input.runner}, ${input.maxSteps || 30}) returning *`;
  return toRun(rows[0]);
}

/** Reads a run. Pass userId for app reads; the worker endpoint reads by id after checking its shared secret. */
export async function getRun(id: string, userId?: string) {
  const sql = await db();
  const rows = userId
    ? await sql`select * from public.elias_browser_runs where id = ${id} and user_id = ${userId}`
    : await sql`select * from public.elias_browser_runs where id = ${id}`;
  return rows[0] ? toRun(rows[0]) : null;
}

export type RunPatch = Partial<Pick<BrowserRun, "status" | "statusText" | "step" | "pending" | "resolution" | "keys" | "history" | "summary" | "error">>;

export async function updateRun(id: string, patch: RunPatch) {
  const sql = await db();
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.statusText !== undefined) row.status_text = patch.statusText.slice(0, 120);
  if (patch.step !== undefined) row.step = patch.step;
  if (patch.pending !== undefined) row.pending = patch.pending ? sql.json(patch.pending as never) : null;
  if (patch.resolution !== undefined) row.resolution = patch.resolution ? sql.json(patch.resolution as never) : null;
  if (patch.keys !== undefined) row.keys = sql.json(patch.keys.slice(-10));
  if (patch.history !== undefined) row.history = sql.json(patch.history.slice(-40));
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.error !== undefined) row.error = patch.error;
  const rows = await sql`update public.elias_browser_runs set ${sql(row)}, updated_at = now() where id = ${id} returning *`;
  return rows[0] ? toRun(rows[0]) : null;
}

/** Writes the user's answer to a pause, only while the run is still paused (or stops a live run). */
export async function resolveRun(id: string, userId: string, resolution: Resolution | "stop") {
  const sql = await db();
  const rows = resolution === "stop"
    ? await sql`update public.elias_browser_runs set status = 'stopped', status_text = 'Stopped', pending = null, error = 'Stopped by you.', updated_at = now()
        where id = ${id} and user_id = ${userId} and status not in ('done', 'failed', 'stopped') returning *`
    : await sql`update public.elias_browser_runs set resolution = ${sql.json(resolution as never)}, updated_at = now()
        where id = ${id} and user_id = ${userId} and status in ('awaiting_approval', 'awaiting_input') returning *`;
  return rows[0] ? toRun(rows[0]) : null;
}

export async function addStep(runId: string, step: { step: number; url: string; title: string; statusText: string; action: RunAction | null; click: { x: number; y: number } | null; frame: string | null }) {
  const sql = await db();
  await sql`insert into public.elias_browser_run_steps (run_id, step, url, title, status_text, action, click, frame)
    values (${runId}, ${step.step}, ${step.url.slice(0, 2000)}, ${step.title.slice(0, 300)}, ${step.statusText.slice(0, 120)}, ${step.action ? sql.json(step.action as never) : null}, ${step.click ? sql.json(step.click) : null}, ${step.frame})
    on conflict (run_id, step) do update set url = excluded.url, title = excluded.title, status_text = excluded.status_text,
      action = coalesce(excluded.action, elias_browser_run_steps.action), click = coalesce(excluded.click, elias_browser_run_steps.click), frame = coalesce(excluded.frame, elias_browser_run_steps.frame)`;
}

/** Marks what the runner is about to do on the frame it decided from (the card draws the zoom circle there). */
export async function markStepAction(runId: string, step: number, action: RunAction, statusText: string) {
  const sql = await db();
  const click = "x" in action ? { x: action.x, y: action.y } : null;
  await sql`update public.elias_browser_run_steps set action = ${sql.json(action as never)}, click = ${click ? sql.json(click) : null}, status_text = ${statusText.slice(0, 120)}
    where run_id = ${runId} and step = ${step}`;
}

export async function latestStep(runId: string, withFrame = true): Promise<RunStep | null> {
  const sql = await db();
  const rows = withFrame
    ? await sql`select * from public.elias_browser_run_steps where run_id = ${runId} order by step desc limit 1`
    : await sql`select run_id, step, url, title, status_text, action, click, null as frame, created_at from public.elias_browser_run_steps where run_id = ${runId} order by step desc limit 1`;
  const row = rows[0];
  if (!row) return null;
  return { step: Number(row.step), url: String(row.url), title: String(row.title), statusText: String(row.status_text), action: json<RunAction | null>(row.action, null), click: json<{ x: number; y: number } | null>(row.click, null), frame: (row.frame as string) || null, createdAt: new Date(row.created_at as string).toISOString() };
}
