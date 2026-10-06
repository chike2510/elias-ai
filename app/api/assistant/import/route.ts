import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { importConversations, importMemories, type ImportConversation } from "@/lib/assistant/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One-time upload of conversations (and memories) the old chat kept in IndexedDB. Idempotent. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "import");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ conversations?: ImportConversation[]; memories?: Array<{ content?: string; kind?: string }> }>(request);
    const conversations = Array.isArray(body.conversations) ? body.conversations : [];
    if (conversations.length > 50) return jsonError("Send at most 50 conversations per request.", 413, "TOO_LARGE");
    const result = await importConversations(auth.userId, conversations);
    const memories = Array.isArray(body.memories) ? await importMemories(auth.userId, body.memories) : 0;
    return jsonOk({ ...result, memories });
  } catch (error) { return jsonError(reportError(error, "assistant/import", auth.userId), 500, "IMPORT_FAILED"); }
}
