import { addMessage, ensureConversation, runTurn } from "@/lib/assistant/agent";
import { briefCards, fallbackBrief, gatherBrief, getSettings } from "@/lib/assistant/brief";
import { claimDueSchedules, finishScheduleRun, type Schedule } from "@/lib/assistant/schedules";
import { getGitHubConnection } from "@/lib/githubConnectionStore";
import { captureError } from "@/lib/observability";

type Due = Schedule & { userId: string };

/** The morning brief: data is gathered directly, the model only writes it up (with a plain fallback). */
async function runDailyBrief(schedule: Due) {
  const settings = await getSettings(schedule.userId).catch(() => null);
  const data = await gatherBrief(schedule.userId, schedule.timezone, settings?.city);
  const cards = briefCards(data);
  try {
    return await runTurn({
      userId: schedule.userId, conversationId: schedule.conversationId || undefined, title: "Daily brief", text: schedule.prompt, timezone: schedule.timezone, origin: "schedule", presetCards: cards,
      extraContext: `MORNING BRIEF DATA (already gathered, do not call daily_brief again):\n${JSON.stringify(data).slice(0, 8000)}\n\nWrite the brief as a text message: a one-line greeting with the weather, then what matters today (first meeting time, anything urgent in email, reminders). Under 70 words. The cards below your message already list events and emails, so don't list them all.`,
    });
  } catch (error) {
    void captureError(error, { area: "daily_brief", scheduleId: schedule.id });
    const conversationId = await ensureConversation(schedule.userId, schedule.conversationId || undefined, "Daily brief", "schedule");
    const reply = fallbackBrief(data);
    await addMessage(schedule.userId, conversationId, "assistant", reply, { cards, kind: "daily_brief", fallback: true });
    return { conversationId, reply };
  }
}

/** Runs every due scheduled task once. Called by the cron tick (all users) and on app open (one user). */
export async function runDueSchedules(limit = 3, userId?: string) {
  const due = await claimDueSchedules(limit, userId);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const schedule of due) {
    try {
      const turn = schedule.kind === "daily_brief"
        ? await runDailyBrief(schedule)
        : await runTurn({ userId: schedule.userId, conversationId: schedule.conversationId || undefined, text: schedule.prompt, timezone: schedule.timezone, githubToken: await getGitHubConnection(schedule.userId).then((item) => item?.token).catch(() => undefined), origin: "schedule" });
      await finishScheduleRun(schedule, turn.reply, turn.conversationId);
      results.push({ id: schedule.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void captureError(error, { area: "schedule", scheduleId: schedule.id });
      await finishScheduleRun(schedule, `Failed: ${message}`, schedule.conversationId || "");
      results.push({ id: schedule.id, ok: false, error: message });
    }
  }
  return results;
}
