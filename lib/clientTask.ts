import type { TaskRecord } from "@/lib/task";

const PREFIX = "elias:task:";
const MAX_CACHE_BYTES = 4_500_000;

export function cacheTaskSnapshot(task: TaskRecord) {
  if (typeof window === "undefined") return;
  try {
    const value = JSON.stringify(task);
    if (new Blob([value]).size <= MAX_CACHE_BYTES) window.localStorage.setItem(`${PREFIX}${task.id}`, value);
  } catch {
    // Local storage is an enhancement; server responses remain authoritative when available.
  }
}

function normalizeCachedTask(value: unknown): TaskRecord | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<TaskRecord>;
  if (typeof task.id !== "string" || typeof task.updatedAt !== "number") return null;
  if (!Array.isArray(task.plan) || !Array.isArray(task.permissions) || !Array.isArray(task.approvals) || !Array.isArray(task.checkpoints) || !Array.isArray(task.events) || !Array.isArray(task.artifacts) || !Array.isArray(task.toolResults) || !Array.isArray(task.workspace)) return null;
  return task as TaskRecord;
}

export function getCachedTaskSnapshot(id: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${id}`);
    return raw ? normalizeCachedTask(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function listCachedTaskSnapshots() {
  if (typeof window === "undefined") return [] as TaskRecord[];
  const tasks: TaskRecord[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const task = getCachedTaskSnapshot(key.slice(PREFIX.length));
      if (task) tasks.push(task);
    }
  } catch {
    return tasks;
  }
  return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
}
