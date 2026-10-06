import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { runTurn } from "@/lib/assistant/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ text?: string; conversationId?: string; timezone?: string }>(request);
    const text = (body.text || "").trim();
    if (!text) return jsonError("Message is empty.", 400, "BAD_REQUEST");
    const result = await runTurn({ userId: auth.userId, userName: auth.userName, conversationId: body.conversationId, text: text.slice(0, 12_000), timezone: body.timezone, githubToken: auth.githubToken });
    return jsonOk(result);
  } catch (error) {
    return jsonError(errorMessage(error), 500, "ASSISTANT_FAILED");
  }
}
