import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import {
  type PermissionLevel,
  type TaskApproval,
  type TaskCheckpoint,
  type TaskEvent,
  type TaskRecord,
  type TaskSnapshot,
  type TaskStatus,
  taskSnapshot,
} from "@/lib/task";
import type { AgentActivity, ToolResult, WorkspaceFile } from "@/lib/types";

type StoreState = { tasks: Map<string, TaskRecord>; loaded: boolean };

declare global { var __eliasTaskStore: StoreState | undefined; var __eliasTaskDb: ReturnType<typeof postgres> | undefined; var __eliasTaskSchema: Promise<void> | undefined; }

function storePath() { return process.env.ELIAS_TASK_STORE_PATH || join(process.cwd(), ".elias", "tasks.json"); }
function useRemoteStore() {
  if (process.env.VERCEL && !process.env.POSTGRES_URL) throw new Error("Durable task storage is not configured. Add POSTGRES_URL to the Vercel Production environment and redeploy.");
  return Boolean(process.env.POSTGRES_URL);
}
function db() { globalThis.__eliasTaskDb ||= postgres(process.env.POSTGRES_URL!, { max: 1, prepare: false }); return globalThis.__eliasTaskDb; }

async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasTaskSchema ||= (async () => {
    await db()`create table if not exists public.elias_task_records (id text primary key, task jsonb not null, updated_at timestamptz not null default now())`;
    await db()`create index if not exists elias_task_records_updated_idx on public.elias_task_records(updated_at desc)`;
  })();
  await globalThis.__eliasTaskSchema;
}

function state(): StoreState {
  if (!globalThis.__eliasTaskStore) globalThis.__eliasTaskStore = { tasks: new Map(), loaded: false };
  const current = globalThis.__eliasTaskStore;
  if (!current.loaded) {
    current.loaded = true;
    const filePath = storePath();
    if (filePath && existsSync(filePath)) {
      try { const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TaskRecord[]; for (const task of parsed) current.tasks.set(task.id, task); } catch { /* local store is best effort */ }
    }
  }
  return current;
}

function persistLocal() { try { const filePath = storePath(); mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, JSON.stringify([...state().tasks.values()]), "utf8"); } catch { /* local store is best effort */ } }
function clone<T>(value: T): T { return structuredClone(value); }

async function remoteGet(id: string) { await ensureSchema(); const rows = await db()<Array<{ task: TaskRecord }>>`select task from public.elias_task_records where id = ${id} limit 1`; return rows[0]?.task ? clone(rows[0].task) : undefined; }
async function remoteSave(task: TaskRecord) { await ensureSchema(); task.updatedAt = Date.now(); await db()`insert into public.elias_task_records (id, task, updated_at) values (${task.id}, ${JSON.stringify(task)}::jsonb, now()) on conflict (id) do update set task = excluded.task, updated_at = now()`; return clone(task); }

export async function createStoredTask(task: TaskRecord) { return useRemoteStore() ? remoteSave(task) : localSave(task); }
export async function restoreStoredTask(task: TaskRecord) { return useRemoteStore() ? remoteSave(task) : localSave(task); }
function localSave(task: TaskRecord) { task.updatedAt = Date.now(); state().tasks.set(task.id, clone(task)); persistLocal(); return clone(task); }

export async function getStoredTask(id: string): Promise<TaskRecord | undefined> {
  if (useRemoteStore()) return remoteGet(id);
  const current = state(); const filePath = storePath();
  if (existsSync(filePath)) { try { const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TaskRecord[]; current.tasks = new Map(parsed.map((task) => [task.id, task])); } catch { /* retain last local state */ } }
  const task = current.tasks.get(id); return task ? clone(task) : undefined;
}

export async function listStoredTasks(projectId?: string, conversationId?: string) {
  let tasks: TaskRecord[];
  if (useRemoteStore()) { await ensureSchema(); const rows = await db()<Array<{ task: TaskRecord }>>`select task from public.elias_task_records order by updated_at desc`; tasks = rows.map((row) => row.task); }
  else { tasks = [...(await Promise.all([...state().tasks.keys()].map((id) => getStoredTask(id)))).filter((task): task is TaskRecord => Boolean(task))]; }
  return tasks.filter((task) => (!projectId || task.projectId === projectId) && (!conversationId || task.conversationId === conversationId)).sort((a, b) => b.updatedAt - a.updatedAt).map(clone);
}

export async function snapshotStoredTask(id: string): Promise<TaskSnapshot | undefined> { const task = await getStoredTask(id); return task ? taskSnapshot(task) : undefined; }

export async function updateStoredTask(id: string, update: (task: TaskRecord) => void) {
  const task = await getStoredTask(id); if (!task) throw new Error("Task not found."); update(task); return useRemoteStore() ? remoteSave(task) : localSave(task);
}

export async function setTaskStatus(id: string, status: TaskStatus, error?: string) { return updateStoredTask(id, (task) => { const now = Date.now(); task.status = status; task.error = error; if (status === "running" || status === "planning") task.startedAt ||= now; if (["completed", "failed", "cancelled"].includes(status)) task.completedAt = now; }); }

export async function recordTaskEvent(id: string, activity: Omit<AgentActivity, "id" | "createdAt"> & { stepId?: string; toolId?: string; evidence?: TaskEvent["evidence"] }) {
  const event: TaskEvent = { id: `evt_${crypto.randomUUID()}`, taskId: id, createdAt: Date.now(), ...activity };
  await updateStoredTask(id, (task) => { task.events.push(event); if (event.stepId) { const step = task.plan.find((item) => item.id === event.stepId); if (step) { step.evidenceEventIds.push(event.id); step.updatedAt = event.createdAt; } } });
  return event;
}

export async function recordToolResult(id: string, result: ToolResult) { await updateStoredTask(id, (task) => task.toolResults.push(result)); return result; }

export async function requestTaskApproval(id: string, permission: PermissionLevel, question: string) {
  const approval: TaskApproval = { id: `approval_${crypto.randomUUID()}`, taskId: id, permission, question, status: "pending", createdAt: Date.now() };
  await updateStoredTask(id, (task) => { task.approvals.push(approval); task.status = "waiting_approval"; }); return approval;
}

export async function resolveTaskApproval(id: string, approvalId: string, approved: boolean) { return updateStoredTask(id, (task) => { const approval = task.approvals.find((item) => item.id === approvalId); if (!approval) throw new Error("Approval not found."); approval.status = approved ? "approved" : "rejected"; approval.resolvedAt = Date.now(); approval.resolvedBy = "user"; const permission = task.permissions.find((item) => item.level === approval.permission); if (permission && approved) { permission.granted = true; permission.grantedAt = approval.resolvedAt; permission.grantedBy = "user"; } task.status = approved ? "queued" : "paused"; }); }

export async function createTaskCheckpoint(id: string, label: string, reason: TaskCheckpoint["reason"], files: WorkspaceFile[]) { const checkpoint: TaskCheckpoint = { id: `checkpoint_${crypto.randomUUID()}`, taskId: id, label, reason, createdAt: Date.now(), files: clone(files) }; await updateStoredTask(id, (task) => { checkpoint.parentId = task.checkpoints.at(-1)?.id; task.checkpoints.push(checkpoint); }); return checkpoint; }

export async function restoreTaskCheckpoint(id: string, checkpointId: string) { return updateStoredTask(id, (task) => { const checkpoint = task.checkpoints.find((item) => item.id === checkpointId); if (!checkpoint) throw new Error("Checkpoint not found."); task.workspace = clone(checkpoint.files); task.status = "paused"; task.events.push({ id: `evt_${crypto.randomUUID()}`, taskId: id, kind: "action", label: "Checkpoint restored", status: "completed", detail: checkpoint.label, createdAt: Date.now(), evidence: { type: "json", value: { checkpointId } } }); }); }

export async function grantTaskPermission(id: string, permission: PermissionLevel) { return updateStoredTask(id, (task) => { const item = task.permissions.find((value) => value.level === permission); if (!item) throw new Error("Permission not found."); item.granted = true; item.grantedAt = Date.now(); item.grantedBy = "user"; }); }
