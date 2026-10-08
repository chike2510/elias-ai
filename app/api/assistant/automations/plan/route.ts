import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { complete } from "@/lib/assistant/llm";
import { nextRun, validTimezone } from "@/lib/assistant/schedules";
import { describePlanSchedule, parsePlan, planMessages } from "@/lib/automationPlan";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST { text, timezone? } -> { plan, when, nextRunAt } to confirm, or { question } when the ask is too vague. Creates nothing. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ text?: string; timezone?: string }>(request);
    const text = String(body.text || "").trim();
    if (text.length < 4) return jsonError("Tell me what you'd like automated.", 400, "BAD_REQUEST");
    const timezone = body.timezone && validTimezone(body.timezone) ? body.timezone : "Africa/Lagos";
    const now = new Date().toLocaleString("en-GB", { timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const result = await complete(planMessages(text, { now, timezone }), [], { temperature: 0.2, route: { tier: "fast" } });
    const parsed = parsePlan(result.content);
    if ("question" in parsed) return jsonOk({ question: parsed.question });
    const { plan } = parsed;
    const next = plan.schedule ? nextRun(plan.schedule, timezone) : new Date();
    if (!next) return jsonError("That time has already passed. Pick a time in the future.", 400, "PAST_TIME");
    return jsonOk({ plan, timezone, when: describePlanSchedule(plan.schedule, timezone), nextRunAt: next.toISOString() });
  } catch (error) { return jsonError(reportError(error, "assistant/automations/plan", auth.userId), 400, "PLAN_FAILED"); }
}
