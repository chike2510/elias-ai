import { ready } from "@/lib/assistant/db";
import { DAILY_BRIEF_PROMPT, cityFromTimezone, ensureDailyBrief, getSettings, setCity, weatherFor } from "@/lib/assistant/brief";
import { createSchedule, listSchedules, updateSchedule, validTimezone } from "@/lib/assistant/schedules";
import { saveMemory } from "@/lib/assistant/memory";
import { getUserData, mergeUserData } from "@/lib/assistant/userData";

export type OnboardingState = {
  needed: boolean; completedAt: string | null; skippedAt: string | null;
  preferredName: string | null; timezone: string | null; city: string | null; briefTime: string | null;
};

export async function onboardingState(userId: string): Promise<OnboardingState> {
  const [data, settings, schedules] = await Promise.all([getUserData(userId), getSettings(userId), listSchedules(userId)]);
  const brief = schedules.find((item) => item.kind === "daily_brief");
  const completedAt = typeof data.onboardedAt === "string" ? data.onboardedAt : null;
  const skippedAt = typeof data.onboardingSkippedAt === "string" ? data.onboardingSkippedAt : null;
  return {
    needed: !completedAt && !skippedAt, completedAt, skippedAt,
    preferredName: typeof data.preferredName === "string" ? data.preferredName : null,
    timezone: settings.timezone, city: settings.city,
    briefTime: brief && (brief.spec.type === "daily" || brief.spec.type === "weekly") ? brief.spec.time : null,
  };
}

export async function saveProfile(userId: string, preferredName: string) {
  const name = preferredName.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw new Error("Tell me what to call you.");
  await mergeUserData(userId, { preferredName: name });
  await saveMemory(userId, `Prefers to be called ${name}.`, "profile", "onboarding");
  return name;
}

/** Saves timezone, the brief's time (creating the brief if it's missing) and the weather city. */
export async function saveRoutine(userId: string, input: { timezone?: string; briefTime?: string; city?: string }) {
  const timezone = input.timezone && validTimezone(input.timezone) ? input.timezone : null;
  if (!timezone) throw new Error("Pick a valid timezone.");
  const time = (input.briefTime || "08:00").trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Brief time must be HH:MM.");
  const city = (input.city || "").trim().slice(0, 80) || cityFromTimezone(timezone);
  const weather = await weatherFor(city); // validates the place
  const db = await ready();
  await db`insert into public.elias_user_settings (user_id, timezone) values (${userId}, ${timezone}) on conflict (user_id) do update set timezone = excluded.timezone, updated_at = now()`;
  await setCity(userId, city);
  await ensureDailyBrief(userId, timezone);
  const brief = (await listSchedules(userId)).find((item) => item.kind === "daily_brief");
  if (brief) await updateSchedule(userId, brief.id, { time, timezone });
  else {
    const created = await createSchedule(userId, { name: "Daily brief", prompt: DAILY_BRIEF_PROMPT, schedule: { type: "daily", time }, timezone });
    await db`update public.elias_schedules set kind = 'daily_brief' where id = ${created.id}`;
  }
  return { timezone, briefTime: time, city, weather };
}

/** Each answer becomes one preference memory. */
export async function savePreferences(userId: string, answers: Array<{ statement?: unknown }>) {
  const saved: string[] = [];
  for (const answer of answers.slice(0, 8)) {
    const statement = typeof answer?.statement === "string" ? answer.statement.trim().slice(0, 300) : "";
    if (!statement) continue;
    await saveMemory(userId, statement, "preference", "onboarding");
    saved.push(statement);
  }
  return saved;
}

export async function finishOnboarding(userId: string, how: "complete" | "skip") {
  const at = new Date().toISOString();
  await mergeUserData(userId, how === "complete" ? { onboardedAt: at } : { onboardingSkippedAt: at });
  return onboardingState(userId);
}

/** "Redo" from You: clears the markers so the flow shows again. */
export async function resetOnboarding(userId: string) {
  await mergeUserData(userId, { onboardedAt: null, onboardingSkippedAt: null });
  return onboardingState(userId);
}
