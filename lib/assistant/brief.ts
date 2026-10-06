import { ready } from "@/lib/assistant/db";
import { calendarList, gmailSearch, googleConnection } from "@/lib/assistant/google";
import { createSchedule, validTimezone, zonedTime } from "@/lib/assistant/schedules";
import type { Card, EmailItem, EventItem, WeatherCard } from "@/lib/assistant/cards";

export const DAILY_BRIEF_PROMPT = "Send my morning brief: today's calendar, important unread email, reminders due today, and the weather.";

const WEATHER_CODES: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy showers", 95: "Thunderstorms", 96: "Thunderstorms with hail", 99: "Thunderstorms with hail",
};

/** The default weather place for a timezone: "Africa/Lagos" → "Lagos". */
export function cityFromTimezone(timezone: string) {
  const last = timezone.split("/").pop() || "Lagos";
  return last === "UTC" ? "London" : last.replace(/_/g, " ");
}

/** Current weather + today's range from open-meteo (free, no key). */
export async function weatherFor(place: string): Promise<Omit<WeatherCard, "kind">> {
  const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: place, count: "1", language: "en", format: "json" })}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((res) => res.json()) as { results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> };
  const hit = geo.results?.[0];
  if (!hit) throw new Error(`Couldn't find "${place}" for the weather.`);
  const params = new URLSearchParams({ latitude: String(hit.latitude), longitude: String(hit.longitude), current: "temperature_2m,weather_code", daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code", timezone: "auto", forecast_days: "1" });
  const data = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((res) => res.json()) as { current?: { temperature_2m?: number; weather_code?: number }; daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[]; weather_code?: number[] } };
  const code = data.daily?.weather_code?.[0] ?? data.current?.weather_code ?? -1;
  return {
    place: [hit.name, hit.country].filter(Boolean).join(", "),
    summary: WEATHER_CODES[code] || "Mixed conditions",
    now: data.current?.temperature_2m !== undefined ? Math.round(data.current.temperature_2m) : undefined,
    high: data.daily?.temperature_2m_max?.[0] !== undefined ? Math.round(data.daily.temperature_2m_max[0]) : undefined,
    low: data.daily?.temperature_2m_min?.[0] !== undefined ? Math.round(data.daily.temperature_2m_min[0]) : undefined,
    rainChance: data.daily?.precipitation_probability_max?.[0],
  };
}

export type UserSettings = { timezone: string | null; city: string | null; dailyBriefSeeded: boolean; legacyImportAt: string | null };

export async function getSettings(userId: string): Promise<UserSettings> {
  const db = await ready();
  const row = (await db`select * from public.elias_user_settings where user_id = ${userId}`)[0];
  const data = (row?.data || {}) as Record<string, unknown>;
  return { timezone: (row?.timezone as string) || null, city: typeof data.city === "string" ? data.city : null, dailyBriefSeeded: Boolean(row?.daily_brief_seeded_at), legacyImportAt: row?.legacy_import_at ? new Date(row.legacy_import_at as string).toISOString() : null };
}

export async function setCity(userId: string, city: string) {
  const db = await ready();
  await db`insert into public.elias_user_settings (user_id, data) values (${userId}, ${db.json({ city } as never)})
    on conflict (user_id) do update set data = public.elias_user_settings.data || excluded.data, updated_at = now()`;
}

/**
 * Creates the default 08:00 daily brief once per user (in their timezone). If the user later
 * removes it, it stays removed: the seed marker is kept in elias_user_settings.
 */
export async function ensureDailyBrief(userId: string, timezone?: string) {
  const tz = timezone && validTimezone(timezone) ? timezone : "Africa/Lagos";
  const db = await ready();
  await db`insert into public.elias_user_settings (user_id, timezone) values (${userId}, ${tz}) on conflict (user_id) do update set timezone = coalesce(public.elias_user_settings.timezone, excluded.timezone)`;
  const claimed = await db`update public.elias_user_settings set daily_brief_seeded_at = now(), updated_at = now() where user_id = ${userId} and daily_brief_seeded_at is null returning user_id`;
  if (!claimed[0]) return null;
  try {
    const schedule = await createSchedule(userId, { name: "Daily brief", prompt: DAILY_BRIEF_PROMPT, schedule: { type: "daily", time: "08:00" }, timezone: tz });
    await db`update public.elias_schedules set kind = 'daily_brief' where id = ${schedule.id}`;
    return { ...schedule, kind: "daily_brief" };
  } catch (error) {
    await db`update public.elias_user_settings set daily_brief_seeded_at = null where user_id = ${userId}`;
    throw error;
  }
}

export type BriefData = { date: string; timezone: string; google: boolean; events: EventItem[]; emails: EmailItem[]; reminders: Array<{ name: string; at: string }>; pendingApprovals: number; weather: Omit<WeatherCard, "kind"> | null; notes: string[] };

/** Everything the morning brief needs, gathered without the model so it works even when tools are flaky. */
export async function gatherBrief(userId: string, timezone: string, city?: string | null): Promise<BriefData> {
  const tz = validTimezone(timezone) ? timezone : "Africa/Lagos";
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  const start = zonedTime(ymd[0], ymd[1], ymd[2], 0, 0, tz);
  const end = new Date(start.getTime() + 24 * 3600_000);
  const db = await ready();
  const notes: string[] = [];
  const google = await googleConnection(userId).catch(() => null);
  const settings = await getSettings(userId).catch(() => null);
  const place = city || settings?.city || cityFromTimezone(tz);
  const [events, emails, weather, reminderRows, approvals] = await Promise.all([
    google ? calendarList(userId, start.toISOString(), end.toISOString()).then((items) => items.map((item) => ({ id: item.id, title: item.title || "(untitled)", start: item.start, end: item.end, location: item.location, link: item.link }))).catch((error) => { notes.push(`Calendar: ${error.message}`); return []; }) : Promise.resolve([] as EventItem[]),
    google ? gmailSearch(userId, "is:unread is:important newer_than:2d", 5).catch(() => gmailSearch(userId, "is:unread newer_than:1d", 5)).then((items) => items.map((item) => ({ id: item.id, from: (item.from || "").replace(/<[^>]+>/, "").trim(), subject: item.subject || "(no subject)", date: item.date, snippet: (item.snippet || "").slice(0, 140), unread: item.unread }))).catch((error) => { notes.push(`Gmail: ${error.message}`); return []; }) : Promise.resolve([] as EmailItem[]),
    weatherFor(place).catch((error) => { notes.push(`Weather: ${error.message}`); return null; }),
    db`select name, next_run_at from public.elias_schedules where user_id = ${userId} and status = 'active' and kind <> 'daily_brief' and next_run_at >= ${now} and next_run_at < ${end} order by next_run_at`,
    db`select count(*)::int as n from public.elias_approvals where user_id = ${userId} and status = 'pending'`,
  ]);
  if (!google) notes.push("Google isn't connected, so calendar and email are skipped.");
  return {
    date: now.toLocaleDateString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }), timezone: tz, google: Boolean(google),
    events, emails, weather,
    reminders: reminderRows.map((row) => ({ name: String(row.name), at: new Date(row.next_run_at as string).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) })),
    pendingApprovals: Number(approvals[0]?.n || 0), notes,
  };
}

export function briefCards(data: BriefData): Card[] {
  const cards: Card[] = [];
  if (data.weather) cards.push({ kind: "weather", ...data.weather });
  if (data.events.length) cards.push({ kind: "events", title: "Today", items: data.events });
  if (data.emails.length) cards.push({ kind: "emails", title: "Unread & important", items: data.emails });
  return cards;
}

/** Plain brief used when no model is reachable. */
export function fallbackBrief(data: BriefData) {
  const time = (iso?: string) => iso && iso.includes("T") ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit" }) : "all day";
  const lines = [`Morning! Here's ${data.date}.`];
  if (data.weather) lines.push(`${data.weather.place}: ${data.weather.summary}${data.weather.high !== undefined ? `, ${data.weather.low}–${data.weather.high}°C` : ""}${data.weather.rainChance ? `, ${data.weather.rainChance}% chance of rain` : ""}.`);
  if (data.google) lines.push(data.events.length ? `${data.events.length} on your calendar, first: ${data.events[0].title} at ${time(data.events[0].start)}.` : "Nothing on your calendar today.");
  if (data.google) lines.push(data.emails.length ? `${data.emails.length} unread worth a look, top one from ${data.emails[0].from}.` : "No important unread email.");
  if (data.reminders.length) lines.push(`Reminders: ${data.reminders.map((item) => `${item.name} at ${item.at}`).join(", ")}.`);
  if (data.pendingApprovals) lines.push(`${data.pendingApprovals} thing${data.pendingApprovals === 1 ? "" : "s"} waiting on your OK.`);
  if (!data.google) lines.push("Connect Google and I'll add your calendar and inbox here.");
  return lines.join("\n");
}
