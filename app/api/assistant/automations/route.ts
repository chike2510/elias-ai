import { after, NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { createSchedule, describeSpec, listSchedules, validTimezone } from "@/lib/assistant/schedules";
import { createJob, kickJobs } from "@/lib/assistant/jobs";
import { describePlanSchedule, parsePlan, type AutomationPlan } from "@/lib/automationPlan";

export const runtime = "nodejs";

/** GET: the user's automations (their scheduled tasks), with a plain-words "when". */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const schedules = (await listSchedules(auth.userId)).filter((item) => item.status !== "cancelled");
    return jsonOk({ automations: schedules.map((item) => ({ ...item, when: item.spec ? describePlanSchedule(item.spec, item.timezone) : describeSpec(item.spec, item.timezone) })) });
  } catch (error) { return jsonError(reportError(error, "assistant/automations", auth.userId)); }
}

/** POST { plan, timezone? }: the confirmed plan from /plan. Re-validated here, then saved as a schedule or started as a background job. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ plan?: AutomationPlan; timezone?: string }>(request);
    const parsed = parsePlan(JSON.stringify(body.plan || {}));
    if ("question" in parsed) return jsonError(parsed.question, 400, "BAD_REQUEST");
    const { plan } = parsed;
    const timezone = body.timezone && validTimezone(body.timezone) ? body.timezone : "Africa/Lagos";
    if (plan.mode === "now" || !plan.schedule) {
      const job = await createJob(auth.userId, { title: plan.name, prompt: plan.prompt, kind: "task", timezone, announce: true });
      after(() => kickJobs(job.id).then(() => undefined));
      return jsonOk({ kind: "job", job }, { status: 201 });
    }
    const schedule = await createSchedule(auth.userId, { name: plan.name, prompt: plan.prompt, schedule: plan.schedule as unknown as Record<string, unknown>, timezone });
    return jsonOk({ kind: "schedule", schedule: { ...schedule, when: describePlanSchedule(schedule.spec, schedule.timezone) } }, { status: 201 });
  } catch (error) { return jsonError(reportError(error, "assistant/automations:create", auth.userId), 400, "AUTOMATION_FAILED"); }
}
