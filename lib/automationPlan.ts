/**
 * Plain-words automations: the user says what they want ("every weekday at 7 send me my agenda"),
 * a model turns it into a plan, the user confirms, and it becomes a schedule (repeating or once) or a
 * background job (run now). Pure: prompt + tolerant parser + validation, shared by server and tests.
 */

export type PlanSchedule =
  | { type: "once"; at: string }
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; days: number[]; time: string };

export type AutomationPlan = { name: string; prompt: string; mode: "schedule" | "now"; schedule: PlanSchedule | null; summary: string; needs: string[] };
export type PlanResult = { plan: AutomationPlan } | { question: string };

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NEEDS = new Set(["google", "github", "browser"]);

export function planMessages(text: string, context: { now: string; timezone: string }) {
  return [
    { role: "system" as const, content: `You turn a user's plain-words automation request into a plan for Elias, a personal AI assistant.
Elias can at each run: search the web, read web pages, read/summarise Gmail and Google Calendar (needs Google), work with GitHub (needs GitHub), use a remote browser (needs browser), and post the result to the user's chat with a push notification. It cannot send SMS or make calls.
Current time: ${context.now} (${context.timezone}).

Reply with JSON only, one of:
{"name":"short name (max 6 words)","prompt":"self-contained instruction Elias runs each time, written to Elias, including what to post","mode":"schedule","schedule":{"type":"daily","time":"HH:MM"},"summary":"one plain sentence to the user: when it runs and what they get","needs":["google"]}
schedule types: {"type":"daily","time":"07:00"} | {"type":"weekly","days":[1,2,3,4,5],"time":"07:00"} (0=Sunday..6=Saturday) | {"type":"interval","minutes":60} (min 15) | {"type":"once","at":"ISO 8601 with offset"}.
Use "mode":"now" with "schedule":null when the user wants it done once right away (a background job).
If the request is too vague to schedule (no clear task), reply {"question":"one short clarifying question"}.
Times are 24h local to ${context.timezone}. "Morning" means 07:00, "evening" 18:00, "weekdays" [1,2,3,4,5], "weekends" [0,6].` },
    { role: "user" as const, content: text.slice(0, 1500) },
  ];
}

function jsonBlock(reply: string): Record<string, unknown> | null {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, reply, reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)]) {
    if (!candidate?.trim()) continue;
    try { const value = JSON.parse(candidate.trim()); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* next */ }
  }
  return null;
}

function hhmm(value: unknown) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizePlanSchedule(raw: unknown): PlanSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const type = String(input.type || "").toLowerCase();
  if (type === "once") {
    const at = new Date(String(input.at || ""));
    return Number.isNaN(at.getTime()) ? null : { type: "once", at: at.toISOString() };
  }
  if (type === "interval") {
    const minutes = Math.round(Number(input.minutes));
    return Number.isFinite(minutes) && minutes > 0 ? { type: "interval", minutes: Math.max(15, minutes) } : null;
  }
  const time = hhmm(input.time);
  if (!time) return null;
  if (type === "daily") return { type: "daily", time };
  if (type === "weekly") {
    const days = [...new Set((Array.isArray(input.days) ? input.days : []).map((day) => typeof day === "string" && Number.isNaN(Number(day)) ? DAY_NAMES.indexOf(day.slice(0, 3).toLowerCase()) : Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    return days.length ? (days.length === 7 ? { type: "daily", time } : { type: "weekly", days, time }) : null;
  }
  return null;
}

/** Validates the model's reply into a plan or a clarifying question. Throws when it is unusable. */
export function parsePlan(reply: string): PlanResult {
  const data = jsonBlock(reply);
  if (!data) throw new Error("I couldn't turn that into an automation. Try saying when it should run and what it should do.");
  if (typeof data.question === "string" && data.question.trim() && !data.prompt) return { question: data.question.trim().slice(0, 300) };
  const prompt = String(data.prompt || "").trim();
  if (prompt.length < 8) throw new Error("I couldn't tell what the automation should do. Say what you want done, and when.");
  const mode = data.mode === "now" ? "now" : "schedule";
  const schedule = mode === "schedule" ? normalizePlanSchedule(data.schedule) : null;
  if (mode === "schedule" && !schedule) throw new Error("I couldn't tell when it should run. Add a time, like 'every weekday at 7am'.");
  const name = String(data.name || prompt).replace(/\s+/g, " ").trim().slice(0, 60);
  const summary = String(data.summary || "").replace(/\s+/g, " ").trim().slice(0, 300) || name;
  const needs = (Array.isArray(data.needs) ? data.needs : []).map((item) => String(item).toLowerCase()).filter((item) => NEEDS.has(item));
  return { plan: { name, prompt: prompt.slice(0, 4000), mode, schedule, summary, needs: [...new Set(needs)] } };
}

/** "Every weekday at 07:00", "Daily at 18:30", "Every 2 hours", "Once on Fri 10 Oct, 09:00". */
export function describePlanSchedule(schedule: PlanSchedule | null, timezone: string) {
  if (!schedule) return "Once, right now";
  if (schedule.type === "interval") return schedule.minutes % 60 === 0 ? `Every ${schedule.minutes === 60 ? "hour" : `${schedule.minutes / 60} hours`}` : `Every ${schedule.minutes} minutes`;
  if (schedule.type === "once") return `Once on ${new Date(schedule.at).toLocaleString("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  if (schedule.type === "daily") return `Daily at ${schedule.time}`;
  const days = schedule.days.join(",");
  const label = days === "1,2,3,4,5" ? "Every weekday" : days === "0,6" ? "Every weekend day" : `Every ${schedule.days.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")}`;
  return `${label} at ${schedule.time}`;
}
