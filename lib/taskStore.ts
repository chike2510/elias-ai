import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

type StoreState = {
  tasks: Map<string, TaskRecord>;
  loaded: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __eliasTaskStore: StoreState | undefined;
}

function storePath() {
  return process.env.ELIAS_TASK_STORE_PATH || join(process.cwd(), ".elias", "tasks.json");
}

function state(): StoreState {
  if (!globalThis.__eliasTaskStore) globalThis.__eliasTaskStore = { tasks: new Map(), loaded: false };
  const current = globalThis.__eliasTaskStore;
  if (!current.loaded) {
    current.loaded = true;
    const filePath = storePath();
    if (filePath && existsSync(filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TaskRecord[];
        for (const task of parsed) current.tasks.set(task.id, task);
      } catch {
        // An unreadable optional store falls back to a clean in-memory session.
      }
    }
  }
  return current;
}

function persist() {
  const filePath = storePath();
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify([...state().tasks.values()]), "utf8");
  } catch {
    // The task contract remains usable when the optional local store is read-only.
  }
}

function refresh() {
  const current = state();
  const filePath = storePath();
  if (!existsSync(filePath)) return current;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TaskRecord[];
    current.tasks = new Map(parsed.map((task) => [task.id, task]));
  } catch {
    // Keep the last readable state if the optional store is temporarily unavailable.
  }
  return current;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function save(task: TaskRecord) {
  task.updatedAt = Date.now();
  state().tasks.set(task.id, clone(task));
  persist();
  return clone(task);
}

export function createStoredTask(task: TaskRecord) {
  return save(task);
}

export function restoreStoredTask(task: TaskRecord) {
  return save(task);
}

export function getStoredTask(id: string): TaskRecord | undefined {
  const task = refresh().tasks.get(id);
  return task ? clone(task) : undefined;
}

export function listStoredTasks(projectId?: string): TaskRecord[] {
  return [...refresh().tasks.values()]
    .filter((task) => !projectId || task.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(clone);
}

export function snapshotStoredTask(id: string): TaskSnapshot | undefined {
  const task = getStoredTask(id);
  return task ? taskSnapshot(task) : undefined;
}

export function updateStoredTask(id: string, update: (task: TaskRecord) => void): TaskRecord {
  const task = getStoredTask(id);
  if (!task) throw new Error("Task not found.");
  update(task);
  return save(task);
}

export function setTaskStatus(id: string, status: TaskStatus, error?: string) {
  return updateStoredTask(id, (task) => {
    const now = Date.now();
    task.status = status;
    task.error = error;
    if (status === "running" || status === "planning") task.startedAt ||= now;
    if (["completed", "failed", "cancelled"].includes(status)) task.completedAt = now;
  });
}

export function recordTaskEvent(
  id: string,
  activity: Omit<AgentActivity, "id" | "createdAt"> & { stepId?: string; toolId?: string; evidence?: TaskEvent["evidence"] },
) {
  const event: TaskEvent = {
    id: `evt_${crypto.randomUUID()}`,
    taskId: id,
    createdAt: Date.now(),
    ...activity,
  };
  updateStoredTask(id, (task) => {
    task.events.push(event);
    if (event.stepId) {
      const step = task.plan.find((item) => item.id === event.stepId);
      if (step) {
        step.evidenceEventIds.push(event.id);
        step.updatedAt = event.createdAt;
      }
    }
  });
  return event;
}

export function recordToolResult(id: string, result: ToolResult) {
  updateStoredTask(id, (task) => task.toolResults.push(result));
  return result;
}

export function requestTaskApproval(id: string, permission: PermissionLevel, question: string): TaskApproval {
  const approval: TaskApproval = {
    id: `approval_${crypto.randomUUID()}`,
    taskId: id,
    permission,
    question,
    status: "pending",
    createdAt: Date.now(),
  };
  updateStoredTask(id, (task) => {
    task.approvals.push(approval);
    task.status = "waiting_approval";
  });
  return approval;
}

export function resolveTaskApproval(id: string, approvalId: string, approved: boolean): TaskRecord {
  return updateStoredTask(id, (task) => {
    const approval = task.approvals.find((item) => item.id === approvalId);
    if (!approval) throw new Error("Approval not found.");
    approval.status = approved ? "approved" : "rejected";
    approval.resolvedAt = Date.now();
    approval.resolvedBy = "user";
    const permission = task.permissions.find((item) => item.level === approval.permission);
    if (permission && approved) {
      permission.granted = true;
      permission.grantedAt = approval.resolvedAt;
      permission.grantedBy = "user";
    }
    task.status = approved ? "queued" : "paused";
  });
}

export function createTaskCheckpoint(id: string, label: string, reason: TaskCheckpoint["reason"], files: WorkspaceFile[]): TaskCheckpoint {
  const checkpoint: TaskCheckpoint = {
    id: `checkpoint_${crypto.randomUUID()}`,
    taskId: id,
    label,
    reason,
    createdAt: Date.now(),
    files: clone(files),
  };
  updateStoredTask(id, (task) => {
    checkpoint.parentId = task.checkpoints.at(-1)?.id;
    task.checkpoints.push(checkpoint);
  });
  return checkpoint;
}

export function restoreTaskCheckpoint(id: string, checkpointId: string): TaskRecord {
  return updateStoredTask(id, (task) => {
    const checkpoint = task.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error("Checkpoint not found.");
    task.workspace = clone(checkpoint.files);
    task.status = "paused";
    task.events.push({
      id: `evt_${crypto.randomUUID()}`,
      taskId: id,
      kind: "action",
      label: "Checkpoint restored",
      status: "completed",
      detail: checkpoint.label,
      createdAt: Date.now(),
      evidence: { type: "json", value: { checkpointId } },
    });
  });
}

export function grantTaskPermission(id: string, permission: PermissionLevel) {
  return updateStoredTask(id, (task) => {
    const item = task.permissions.find((value) => value.level === permission);
    if (!item) throw new Error("Permission not found.");
    item.granted = true;
    item.grantedAt = Date.now();
    item.grantedBy = "user";
  });
}
