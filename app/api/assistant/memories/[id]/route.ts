import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { confirmMemory, deleteMemory, updateMemory } from "@/lib/assistant/memory";
import { recordAudit } from "@/lib/assistant/audit";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ content?: string; confirmed?: boolean; kind?: string; entity?: string | null }>(request);
    if (body.confirmed && body.content === undefined) return jsonOk({ memory: await confirmMemory(auth.userId, id) });
    const memory = await updateMemory(auth.userId, id, body.content || "", { kind: body.kind, entity: body.entity });
    await recordAudit({ userId: auth.userId, tool: "memory_update", args: { id, content: body.content || "" }, status: memory ? "ok" : "error", origin: "app" });
    return jsonOk({ memory });
  }
  catch (error) { return jsonError(reportError(error, "assistant/memories/id", auth.userId), 400); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const deleted = await deleteMemory(auth.userId, id);
    await recordAudit({ userId: auth.userId, tool: "memory_forget", args: { id }, status: deleted ? "ok" : "error", origin: "app" });
    return jsonOk({ deleted });
  }
  catch (error) { return jsonError(reportError(error, "assistant/memories/id", auth.userId)); }
}
