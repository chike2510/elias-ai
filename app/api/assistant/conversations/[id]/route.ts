import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { deleteConversation, getMessages, listApprovals, renameConversation } from "@/lib/assistant/agent";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { return jsonOk({ messages: await getMessages(auth.userId, id), approvals: await listApprovals(auth.userId, id) }); }
  catch (error) { return jsonError(reportError(error, "assistant/conversations/id", auth.userId)); }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { const body = await readJsonRequest<{ title?: string }>(request); await renameConversation(auth.userId, id, body.title || ""); return jsonOk({ renamed: id }); }
  catch (error) { return jsonError(reportError(error, "assistant/conversations/id", auth.userId), 400); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { await deleteConversation(auth.userId, id); return jsonOk({ deleted: id }); }
  catch (error) { return jsonError(reportError(error, "assistant/conversations/id", auth.userId)); }
}
