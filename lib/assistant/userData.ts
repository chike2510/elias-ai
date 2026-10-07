import { ready } from "@/lib/assistant/db";

export type NotifyType = "brief" | "reminders" | "approvals" | "jobs";
export const NOTIFY_TYPES: NotifyType[] = ["brief", "reminders", "approvals", "jobs"];
export type NotifyPrefs = Record<NotifyType, boolean>;
export const DEFAULT_NOTIFY: NotifyPrefs = { brief: true, reminders: true, approvals: true, jobs: true };

/** The free-form per-user JSON in elias_user_settings.data (city, notify prefs, onboarding state, preferred name). */
export async function getUserData(userId: string): Promise<Record<string, unknown>> {
  const db = await ready();
  const row = (await db`select data from public.elias_user_settings where user_id = ${userId}`)[0];
  return (row?.data || {}) as Record<string, unknown>;
}

/** Shallow-merges keys into elias_user_settings.data. */
export async function mergeUserData(userId: string, patch: Record<string, unknown>) {
  const db = await ready();
  await db`insert into public.elias_user_settings (user_id, data) values (${userId}, ${db.json(patch as never)})
    on conflict (user_id) do update set data = public.elias_user_settings.data || excluded.data, updated_at = now()`;
}

export function notifyPrefsFrom(data: Record<string, unknown>): NotifyPrefs {
  const saved = (data.notify && typeof data.notify === "object" ? data.notify : {}) as Partial<Record<string, unknown>>;
  return Object.fromEntries(NOTIFY_TYPES.map((type) => [type, typeof saved[type] === "boolean" ? saved[type] : DEFAULT_NOTIFY[type]])) as NotifyPrefs;
}

export async function getNotifyPrefs(userId: string) {
  return notifyPrefsFrom(await getUserData(userId));
}

export async function setNotifyPrefs(userId: string, patch: Partial<Record<string, unknown>>) {
  const current = await getNotifyPrefs(userId);
  const next = { ...current };
  for (const type of NOTIFY_TYPES) if (typeof patch[type] === "boolean") next[type] = patch[type] as boolean;
  await mergeUserData(userId, { notify: next });
  return next;
}
