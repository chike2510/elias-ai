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

export function getCachedTaskSnapshot(id: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${id}`);
    return raw ? JSON.parse(raw) as TaskRecord : null;
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
