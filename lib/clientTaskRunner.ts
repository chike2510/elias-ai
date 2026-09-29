import type { TaskRecord } from "@/lib/task";

const STOP_AFTER_STEP = new Set<TaskRecord["status"]>(["completed", "failed", "cancelled", "waiting_approval", "paused"]);
const STOP_BEFORE_STEP = new Set<TaskRecord["status"]>(["completed", "cancelled", "waiting_approval"]);
const SNAPSHOT_STATUS_RANK: Record<TaskRecord["status"], number> = {
  queued: 0,
  planning: 1,
  running: 2,
  paused: 3,
  waiting_approval: 4,
  failed: 5,
  cancelled: 6,
  completed: 6,
};

type ContinueOptions = {
  advance: (task: TaskRecord) => Promise<TaskRecord>;
  onUpdate?: (task: TaskRecord) => void;
  maxSteps?: number;
};

export async function continueTaskSteps(initial: TaskRecord, options: ContinueOptions) {
  let current = initial;
  const maxSteps = Math.max(1, Math.min(12, Math.floor(options.maxSteps ?? 12)));
  if (STOP_BEFORE_STEP.has(current.status)) return current;

  for (let index = 0; index < maxSteps; index += 1) {
    current = await options.advance(current);
    options.onUpdate?.(current);
    if (STOP_AFTER_STEP.has(current.status)) break;
  }
  return current;
}

export function isTaskSnapshotAtLeastAsFresh(previous: TaskRecord | null | undefined, incoming: TaskRecord) {
  if (!previous || incoming.updatedAt > previous.updatedAt) return true;
  if (incoming.updatedAt < previous.updatedAt) return false;
  const previousCompleted = previous.plan.filter((step) => step.status === "completed").length;
  const incomingCompleted = incoming.plan.filter((step) => step.status === "completed").length;
  const previousStatusRank = SNAPSHOT_STATUS_RANK[previous.status];
  const incomingStatusRank = SNAPSHOT_STATUS_RANK[incoming.status];
  if (incoming.events.length !== previous.events.length) return incoming.events.length > previous.events.length;
  if (incomingCompleted !== previousCompleted) return incomingCompleted > previousCompleted;
  if (incoming.artifacts.length !== previous.artifacts.length) return incoming.artifacts.length > previous.artifacts.length;
  return incomingStatusRank >= previousStatusRank;
}

export function selectActiveTaskSnapshot(current: TaskRecord | null, incoming: TaskRecord, expectedTaskId?: string, force = false) {
  if (expectedTaskId && current?.id !== expectedTaskId) return current;
  if (!force && current && current.id !== incoming.id && incoming.updatedAt < current.updatedAt) return current;
  if (current?.id === incoming.id && !isTaskSnapshotAtLeastAsFresh(current, incoming)) return current;
  return incoming;
}

export function upsertRecentTaskSnapshot(tasks: TaskRecord[], incoming: TaskRecord, limit = 4) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const previous = byId.get(incoming.id);
  if (isTaskSnapshotAtLeastAsFresh(previous, incoming)) byId.set(incoming.id, incoming);
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
}

export function taskArtifactSyncKey(taskId: string, artifact: Pick<TaskRecord["artifacts"][number], "id" | "createdAt" | "size">) {
  return `${taskId}:${artifact.id}:${artifact.createdAt}:${artifact.size ?? ""}`;
}
