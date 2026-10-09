import { addMessage, ensureConversation, runTurn } from "@/lib/assistant/agent";
import { briefCards, briefConnect, fallbackBrief, gatherBrief, getSettings } from "@/lib/assistant/brief";
import { claimDueSchedules, finishScheduleRun, type Schedule } from "@/lib/assistant/schedules";
import { getGitHubConnection } from "@/lib/githubConnectionStore";
import { captureError } from "@/lib/observability";
import { notifyUser } from "@/lib/assistant/push";
import { runMemoryReview } from "@/lib/assistant/review";

type Due = Schedule & { userId: string };

/** The morning brief: data is gathered directly, the model only writes it up (with a plain fallback). */
async function runDailyBrief(schedule: Due) {
  const settings = await getSettings(schedule.userId).catch(() => null);
  const data = await gatherBrief(schedule.userId, schedule.timezone, settings?.city);
  const cards = briefCards(data);
  const reconnect = briefConnect(data);
  try {
    return await runTurn({
      userId: schedule.userId, conversationId: schedule.conversationId || undefined, title: "Daily brief", text: schedule.prompt, timezone: schedule.timezone, origin: "schedule", presetCards: cards, presetConnect: reconnect ? [reconnect] : undefined,
      extraContext: `MORNING BRIEF DATA (already gathered, do not call daily_brief again):\n${JSON.stringify(data).slice(0, 8000)}\n\nWrite the brief as a text message: a one-line greeting with the weather, then what matters today (first meeting time, anything urgent in email, reminders). Under 70 words. The cards below your message already list events and emails, so don't list them all.`,
    });
  } catch (error) {
    void captureError(error, { area: "daily_brief", scheduleId: schedule.id });
    const conversationId = await ensureConversation(schedule.userId, schedule.conversationId || undefined, "Daily brief", "schedule");
    const reply = fallbackBrief(data);
    await addMessage(schedule.userId, conversationId, "assistant", reply, { cards, connect: reconnect ? [reconnect] : [], kind: "daily_brief", fallback: true });
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
        : schedule.kind === "memory_review"
        ? await runMemoryReview(schedule)
        : await runTurn({ userId: schedule.userId, conversationId: schedule.conversationId || undefined, text: schedule.prompt, timezone: schedule.timezone, githubToken: await getGitHubConnection(schedule.userId).then((item) => item?.token).catch(() => undefined), origin: "schedule" });
      await finishScheduleRun(schedule, turn.reply, turn.conversationId);
      if (!("skipped" in turn && turn.skipped)) await notifyScheduleRun(schedule, turn);
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

/** Push for a finished scheduled run: the brief or a reminder, plus any approval it left waiting. */
async function notifyScheduleRun(schedule: Due, turn: { reply: string; conversationId: string; approvals?: Array<{ id: string; summary: string }> }) {
  const url = `/chat?id=${turn.conversationId}`;
  const brief = schedule.kind === "daily_brief";
  await notifyUser(schedule.userId, brief ? "brief" : "reminders", { title: brief ? "Your daily brief" : schedule.name, body: turn.reply.replace(/[*#`>_]/g, ""), url, tag: `schedule-${schedule.id}` });
  const approval = turn.approvals?.[0];
  if (approval) await notifyUser(schedule.userId, "approvals", { title: "Waiting on your OK", body: approval.summary.split("\n")[0], url, tag: `approval-${approval.id}` });
}
