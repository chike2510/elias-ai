import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { listMemories, saveMemory } from "@/lib/assistant/memory";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try { return jsonOk({ memories: await listMemories(auth.userId) }); }
  catch (error) { return jsonError(errorMessage(error)); }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ content?: string; kind?: string }>(request);
    return jsonOk({ memory: await saveMemory(auth.userId, body.content || "", body.kind, "user") });
  } catch (error) { return jsonError(errorMessage(error), 400); }
}
