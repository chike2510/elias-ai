import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { deleteConversation, getMessages, listApprovals } from "@/lib/assistant/agent";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { return jsonOk({ messages: await getMessages(auth.userId, id), approvals: await listApprovals(auth.userId, id) }); }
  catch (error) { return jsonError(errorMessage(error)); }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try { await deleteConversation(auth.userId, id); return jsonOk({ deleted: id }); }
  catch (error) { return jsonError(errorMessage(error)); }
}
