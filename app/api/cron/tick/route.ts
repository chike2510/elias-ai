import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { runDueSchedules } from "@/lib/assistant/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Runs due scheduled tasks. Hit every few minutes by Supabase pg_cron (or Vercel Cron) with Authorization: Bearer CRON_SECRET. */
async function tick(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  try { return jsonOk({ ran: await runDueSchedules(3), at: new Date().toISOString() }); }
  catch (error) { return jsonError(error instanceof Error ? error.message : String(error)); }
}

export const GET = tick;
export const POST = tick;
