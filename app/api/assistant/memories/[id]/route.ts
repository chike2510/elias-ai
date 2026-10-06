import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { deleteMemory, updateMemory } from "@/lib/assistant/memory";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { const body = await readJsonRequest<{ content?: string }>(request); return jsonOk({ memory: await updateMemory(auth.userId, id, body.content || "") }); }
  catch (error) { return jsonError(reportError(error, "assistant/memories/id", auth.userId), 400); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { return jsonOk({ deleted: await deleteMemory(auth.userId, id) }); }
  catch (error) { return jsonError(reportError(error, "assistant/memories/id", auth.userId)); }
}
