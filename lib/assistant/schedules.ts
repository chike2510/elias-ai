import { newId, ready } from "@/lib/assistant/db";

export type ScheduleSpec =
  | { type: "once"; at: string }
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; days: number[]; time: string }; // days: 0=Sunday..6=Saturday

export type Schedule = { id: string; name: string; prompt: string; spec: ScheduleSpec; timezone: string; status: string; nextRunAt: string | null; lastRunAt: string | null; lastResult: string | null; conversationId: string | null; kind: string };

function parts(date: Date, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second), weekday };
}

/** UTC instant for a wall-clock time in a timezone (two-pass offset correction handles DST). */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i += 1) {
    const p = parts(new Date(guess), timezone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(year, month - 1, day, hour, minute) - asUtc;
  }
  return new Date(guess);
}

export function validTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return true; } catch { return false; }
}

export function nextRun(spec: ScheduleSpec, timezone: string, after = new Date()): Date | null {
  if (spec.type === "once") { const at = new Date(spec.at); return Number.isNaN(at.getTime()) || at <= after ? null : at; }
  if (spec.type === "interval") return new Date(after.getTime() + Math.max(15, spec.minutes) * 60_000);
  const [hour, minute] = spec.time.split(":").map(Number);
  const now = parts(after, timezone);
  for (let offset = 0; offset < 8; offset += 1) {
    const base = new Date(Date.UTC(now.year, now.month - 1, now.day + offset, 12));
    const candidate = zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute || 0, timezone);
    if (candidate <= after) continue;
    if (spec.type === "weekly" && !spec.days.includes(parts(candidate, timezone).weekday)) continue;
    return candidate;
  }
  return null;
}

export function describeSpec(spec: ScheduleSpec, timezone: string) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (spec.type === "once") return `once at ${new Date(spec.at).toLocaleString("en-GB", { timeZone: timezone })}`;
  if (spec.type === "interval") return `every ${spec.minutes} minutes`;
  if (spec.type === "daily") return `daily at ${spec.time} (${timezone})`;
  return `${spec.days.map((day) => names[day]).join(", ")} at ${spec.time} (${timezone})`;
}

export function normalizeSpec(input: Record<string, unknown>): ScheduleSpec {
  const type = String(input.type || "");
  const time = String(input.time || "08:00");
  if (type !== "once" && !/^\d{1,2}:\d{2}$/.test(time) && type !== "interval") throw new Error("time must be HH:MM.");
  if (type === "once") return { type, at: String(input.at || "") };
  if (type === "interval") return { type, minutes: Math.max(15, Number(input.minutes) || 60) };
  if (type === "daily") return { type, time };
  if (type === "weekly") return { type, time, days: (Array.isArray(input.days) ? input.days : []).map(Number).filter((day) => day >= 0 && day <= 6) };
  throw new Error("schedule.type must be once, interval, daily or weekly.");
}

function row(item: Record<string, unknown>): Schedule {
  const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;
  return { id: String(item.id), name: String(item.name), prompt: String(item.prompt), spec: item.spec as ScheduleSpec, timezone: String(item.timezone), status: String(item.status), nextRunAt: iso(item.next_run_at), lastRunAt: iso(item.last_run_at), lastResult: (item.last_result as string) || null, conversationId: (item.conversation_id as string) || null, kind: (item.kind as string) || "custom" };
}

export async function createSchedule(userId: string, input: { name: string; prompt: string; schedule: Record<string, unknown>; timezone?: string; conversationId?: string }) {
  const timezone = input.timezone && validTimezone(input.timezone) ? input.timezone : "Africa/Lagos";
  const spec = normalizeSpec(input.schedule);
  const next = nextRun(spec, timezone);
  if (!next) throw new Error("That schedule has no future run time.");
  const db = await ready();
  const rows = await db`insert into public.elias_schedules (id, user_id, name, prompt, spec, timezone, conversation_id, next_run_at)
    values (${newId("sch")}, ${userId}, ${input.name.slice(0, 120)}, ${input.prompt.slice(0, 4000)}, ${db.json(spec as never)}, ${timezone}, ${input.conversationId || null}, ${next}) returning *`;
  return row(rows[0]);
}

export async function listSchedules(userId: string) {
  const db = await ready();
  const rows = await db`select * from public.elias_schedules where user_id = ${userId} and status <> 'cancelled' order by next_run_at asc nulls last`;
  return rows.map(row);
}

export async function setScheduleStatus(userId: string, id: string, status: "active" | "paused" | "cancelled") {
  const db = await ready();
  const rows = await db`update public.elias_schedules set status = ${status} where id = ${id} and user_id = ${userId} returning *`;
  if (rows[0] && status === "active") {
    const schedule = row(rows[0]);
    await db`update public.elias_schedules set next_run_at = ${nextRun(schedule.spec, schedule.timezone)} where id = ${id}`;
  }
  return rows[0] ? row(rows[0]) : null;
}

/** Edits a schedule's name, prompt, time or timezone and recomputes its next run. */
export async function updateSchedule(userId: string, id: string, input: { name?: string; prompt?: string; time?: string; days?: number[]; timezone?: string }) {
  const db = await ready();
  const current = (await db`select * from public.elias_schedules where id = ${id} and user_id = ${userId}`)[0];
  if (!current) return null;
  const schedule = row(current);
  let spec = schedule.spec;
  if (input.time !== undefined || input.days !== undefined) {
    if (spec.type !== "daily" && spec.type !== "weekly") throw new Error("Only daily and weekly tasks have a time to change.");
    const time = input.time ?? spec.time;
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("time must be HH:MM (24h).");
    spec = spec.type === "weekly" ? { type: "weekly", time, days: input.days ?? spec.days } : { type: "daily", time };
  }
  const timezone = input.timezone && validTimezone(input.timezone) ? input.timezone : schedule.timezone;
  const next = schedule.status === "active" ? nextRun(spec, timezone) : null;
  const rows = await db`update public.elias_schedules set name = ${(input.name ?? schedule.name).slice(0, 120)}, prompt = ${(input.prompt ?? schedule.prompt).slice(0, 4000)},
    spec = ${db.json(spec as never)}, timezone = ${timezone}, next_run_at = ${schedule.status === "active" ? next : current.next_run_at as Date | null} where id = ${id} and user_id = ${userId} returning *`;
  return row(rows[0]);
}

/** Claims due schedules atomically so overlapping ticks never run one twice. Optionally only one user's. */
export async function claimDueSchedules(limit = 5, userId?: string) {
  const db = await ready();
  const rows = userId
    ? await db`update public.elias_schedules set next_run_at = null
    where id in (select id from public.elias_schedules where status = 'active' and user_id = ${userId} and next_run_at <= now() order by next_run_at limit ${limit} for update skip locked)
    returning *, user_id`
    : await db`update public.elias_schedules set next_run_at = null
    where id in (select id from public.elias_schedules where status = 'active' and next_run_at <= now() order by next_run_at limit ${limit} for update skip locked)
    returning *, user_id`;
  return rows.map((item) => ({ ...row(item), userId: String(item.user_id) }));
}

export async function finishScheduleRun(schedule: Schedule, result: string, conversationId: string) {
  const db = await ready();
  const next = nextRun(schedule.spec, schedule.timezone);
  await db`update public.elias_schedules set last_run_at = now(), last_result = ${result.slice(0, 2000)}, conversation_id = coalesce(nullif(${conversationId}, ''), conversation_id),
    next_run_at = ${next}, status = ${next ? "active" : "completed"} where id = ${schedule.id}`;
}
