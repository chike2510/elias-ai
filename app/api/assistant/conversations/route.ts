import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { listConversations } from "@/lib/assistant/agent";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try { return jsonOk({ conversations: await listConversations(auth.userId) }); }
  catch (error) { return jsonError(errorMessage(error)); }
}
