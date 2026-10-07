import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { runDueSchedules } from "@/lib/assistant/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Catch-up for the signed-in user: runs their overdue scheduled tasks (e.g. a brief the daily cron missed). */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try { return jsonOk({ ran: await runDueSchedules(2, auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "assistant/tick", auth.userId)); }
}
