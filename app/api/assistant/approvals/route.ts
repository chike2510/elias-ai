import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { listApprovals } from "@/lib/assistant/agent";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ approvals: await listApprovals(auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "assistant/approvals", auth.userId)); }
}
