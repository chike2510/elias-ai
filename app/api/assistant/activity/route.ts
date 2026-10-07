import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { listAudit } from "@/lib/assistant/audit";

export const runtime = "nodejs";

/** The audit log: every tool action with side effects, newest first (arguments are redacted). */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ entries: await listAudit(auth.userId, 150) }); }
  catch (error) { return jsonError(reportError(error, "assistant/activity", auth.userId)); }
}
