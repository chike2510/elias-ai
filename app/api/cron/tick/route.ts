import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { runDueSchedules } from "@/lib/assistant/runner";
import { advanceJobs, hasRunnableJobs, kickJobs } from "@/lib/assistant/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Runs due scheduled tasks, then makes sure background jobs keep moving. Hit every few minutes by
 * Supabase pg_cron (or Vercel Cron) with Authorization: Bearer CRON_SECRET.
 * Jobs are handed to /api/cron/jobs (its own time budget); if that self-call can't be made, one slice runs inline.
 */
async function tick(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  try {
    const ran = await runDueSchedules(3);
    let jobs: unknown = "idle";
    if (await hasRunnableJobs().catch(() => false)) jobs = (await kickJobs()) ? "kicked" : await advanceJobs(1);
    return jsonOk({ ran, jobs, at: new Date().toISOString() });
  }
  catch (error) { return jsonError(error instanceof Error ? error.message : String(error)); }
}

export const GET = tick;
export const POST = tick;
