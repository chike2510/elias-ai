import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { after } from "next/server";
import { backfillEmbeddings, listMemories, saveMemory } from "@/lib/assistant/memory";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const memories = await listMemories(auth.userId);
    if (memories.some((item) => !item.embedded)) after(() => backfillEmbeddings(32, auth.userId).catch(() => 0));
    return jsonOk({ memories });
  }
  catch (error) { return jsonError(reportError(error, "assistant/memories", auth.userId)); }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ content?: string; kind?: string; entity?: string }>(request);
    return jsonOk({ memory: await saveMemory(auth.userId, body.content || "", body.kind, "user", body.entity || null) });
  } catch (error) { return jsonError(reportError(error, "assistant/memories", auth.userId), 400); }
}
