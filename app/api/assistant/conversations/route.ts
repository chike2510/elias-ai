import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { listConversations } from "@/lib/assistant/agent";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ conversations: await listConversations(auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "assistant/conversations", auth.userId)); }
}
