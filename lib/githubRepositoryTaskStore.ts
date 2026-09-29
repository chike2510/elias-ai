import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import type { TaskRecord } from "@/lib/task";

export type GitHubRepositoryTaskRecord = {
  id: string;
  userId: string;
  task: TaskRecord;
  updatedAt: number;
};

type StoreState = { tasks: Map<string, GitHubRepositoryTaskRecord>; loaded: boolean };
declare global {
  var __eliasGitHubRepositoryTaskStore: StoreState | undefined;
  var __eliasGitHubRepositoryTaskDb: ReturnType<typeof postgres> | undefined;
  var __eliasGitHubRepositoryTaskSchema: Promise<void> | undefined;
}

function storePath() { return process.env.ELIAS_GITHUB_REPOSITORY_TASKS_PATH || join(process.cwd(), ".elias", "github-repository-tasks.json"); }
function useRemoteStore() {
  if (process.env.VERCEL && !process.env.POSTGRES_URL) throw new Error("Durable repository-task storage is not configured. Add POSTGRES_URL to the Vercel environment and redeploy.");
  return Boolean(process.env.POSTGRES_URL);
}
function db() { globalThis.__eliasGitHubRepositoryTaskDb ||= postgres(process.env.POSTGRES_URL!, { max: 1, prepare: false }); return globalThis.__eliasGitHubRepositoryTaskDb; }
function state() {
  if (!globalThis.__eliasGitHubRepositoryTaskStore) globalThis.__eliasGitHubRepositoryTaskStore = { tasks: new Map(), loaded: false };
  const current = globalThis.__eliasGitHubRepositoryTaskStore;
  if (!current.loaded) {
    current.loaded = true;
    const filePath = storePath();
    if (existsSync(filePath)) {
      try {
        const items = JSON.parse(readFileSync(filePath, "utf8")) as GitHubRepositoryTaskRecord[];
        for (const item of items) if (item && typeof item.id === "string" && typeof item.userId === "string" && item.task) current.tasks.set(item.id, item);
      } catch { /* Local development state is best effort. */ }
    }
  }
  return current;
}
function clone<T>(value: T): T { return structuredClone(value); }
function persistLocal() { const filePath = storePath(); mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, JSON.stringify([...state().tasks.values()]), "utf8"); }
async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasGitHubRepositoryTaskSchema ||= (async () => {
    await db()`create table if not exists public.elias_github_repository_tasks (id text primary key, user_id text not null, task jsonb not null, updated_at timestamptz not null default now())`;
    await db()`create index if not exists elias_github_repository_tasks_user_idx on public.elias_github_repository_tasks(user_id, updated_at desc)`;
  })();
  await globalThis.__eliasGitHubRepositoryTaskSchema;
}

export async function createGitHubRepositoryTask(record: GitHubRepositoryTaskRecord) {
  const saved = { ...clone(record), updatedAt: Date.now() };
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`insert into public.elias_github_repository_tasks (id, user_id, task, updated_at) values (${saved.id}, ${saved.userId}, ${JSON.stringify(saved.task)}::jsonb, now())`;
  } else {
    if (state().tasks.has(saved.id)) throw new Error("Repository task already exists.");
    state().tasks.set(saved.id, saved);
    persistLocal();
  }
  return clone(saved);
}

export async function getGitHubRepositoryTask(id: string, userId: string) {
  if (!userId) return undefined;
  if (useRemoteStore()) {
    await ensureSchema();
    const rows = await db()<Array<{ task: TaskRecord; updated_at: Date | string }>>`select task, updated_at from public.elias_github_repository_tasks where id = ${id} and user_id = ${userId} limit 1`;
    const row = rows[0];
    return row ? { id, userId, task: clone(row.task), updatedAt: new Date(row.updated_at).getTime() } : undefined;
  }
  const record = state().tasks.get(id);
  return record?.userId === userId ? clone(record) : undefined;
}

export async function claimGitHubRepositoryTaskStep(id: string, userId: string) {
  if (!userId) return undefined;
  const claimable = ["queued", "planning", "paused", "failed"];
  if (useRemoteStore()) {
    await ensureSchema();
    const rows = await db()<Array<{ task: TaskRecord; updated_at: Date | string }>>`update public.elias_github_repository_tasks set task = jsonb_set(task, '{status}', '"running"'::jsonb, true), updated_at = now() where id = ${id} and user_id = ${userId} and task->>'status' in ('queued', 'planning', 'paused', 'failed') and not exists (select 1 from jsonb_array_elements(coalesce(task->'approvals', '[]'::jsonb)) as approvals(value) where value->>'status' = 'pending') returning task, updated_at`;
    const row = rows[0];
    return row ? { id, userId, task: clone(row.task), updatedAt: new Date(row.updated_at).getTime() } : undefined;
  }
  const current = state().tasks.get(id);
  if (!current || current.userId !== userId || !claimable.includes(current.task.status) || (current.task.approvals || []).some((approval) => approval.status === "pending")) return undefined;
  const claimed = clone(current);
  claimed.task.status = "running";
  claimed.updatedAt = Date.now();
  state().tasks.set(id, claimed);
  persistLocal();
  return clone(claimed);
}

export async function updateGitHubRepositoryTask(id: string, userId: string, update: (record: GitHubRepositoryTaskRecord) => void) {
  const record = await getGitHubRepositoryTask(id, userId);
  if (!record) throw new Error("Repository task not found.");
  update(record);
  record.updatedAt = Date.now();
  if (useRemoteStore()) {
    await ensureSchema();
    const rows = await db()<Array<{ id: string }>>`update public.elias_github_repository_tasks set task = ${JSON.stringify(record.task)}::jsonb, updated_at = now() where id = ${id} and user_id = ${userId} returning id`;
    if (!rows[0]) throw new Error("Repository task not found.");
  } else {
    const current = state().tasks.get(id);
    if (!current || current.userId !== userId) throw new Error("Repository task not found.");
    state().tasks.set(id, clone(record));
    persistLocal();
  }
  return clone(record);
}
