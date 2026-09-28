export type TaskOwnerRecord = { ownerUserId?: unknown };

/** Legacy records and missing identities fail closed. */
export function isTaskOwnedBy(task: TaskOwnerRecord | null | undefined, userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.length > 0 && typeof task?.ownerUserId === "string" && task.ownerUserId === userId;
}

export function filterTasksForOwner<T extends TaskOwnerRecord>(tasks: readonly T[], userId: string | null | undefined): T[] {
  if (typeof userId !== "string" || userId.length === 0) return [];
  return tasks.filter((task) => isTaskOwnedBy(task, userId));
}
