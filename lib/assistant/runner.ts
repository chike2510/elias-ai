import { runTurn } from "@/lib/assistant/agent";
import { claimDueSchedules, finishScheduleRun } from "@/lib/assistant/schedules";
import { getGitHubConnection } from "@/lib/githubConnectionStore";

/** Runs every due scheduled task once. Called by the cron tick. */
export async function runDueSchedules(limit = 3) {
  const due = await claimDueSchedules(limit);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const schedule of due) {
    try {
      const githubToken = await getGitHubConnection(schedule.userId).then((item) => item?.token).catch(() => undefined);
      const turn = await runTurn({ userId: schedule.userId, conversationId: schedule.conversationId || undefined, text: schedule.prompt, timezone: schedule.timezone, githubToken, origin: "schedule" });
      await finishScheduleRun(schedule, turn.reply, turn.conversationId);
      results.push({ id: schedule.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishScheduleRun(schedule, `Failed: ${message}`, schedule.conversationId || "");
      results.push({ id: schedule.id, ok: false, error: message });
    }
  }
  return results;
}
