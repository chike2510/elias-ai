import { after, NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { advanceJobs, kickJobs } from "@/lib/assistant/jobs";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST { jobId? } with Authorization: Bearer CRON_SECRET. Answers 202 at once, then runs one job
 * slice after the response (in this function's own 300s budget). If the job wants another slice,
 * it calls itself again, so a job moves slice after slice without waiting for the 5-minute tick.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  const body = await request.json().catch(() => ({})) as { jobId?: unknown };
  const jobId = typeof body.jobId === "string" && body.jobId ? body.jobId : undefined;
  after(async () => {
    try {
      const results = await advanceJobs(1, jobId ? { jobId } : {});
      const next = results.find((item) => item.more);
      if (next) await kickJobs(next.id);
    } catch (error) { void captureError(error, { area: "cron/jobs", jobId }); }
  });
  return jsonOk({ accepted: true, jobId: jobId || null }, { status: 202 });
}
