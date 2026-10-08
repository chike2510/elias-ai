import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { deleteFile, getFile, renameFile } from "@/lib/assistant/files";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** GET one file with its extracted text and cached study aids. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const file = await getFile(auth.userId, id);
    return file ? jsonOk({ file }) : jsonError("File not found.", 404, "NOT_FOUND");
  } catch (error) { return jsonError(reportError(error, "assistant/files/id", auth.userId)); }
}

/** PATCH { name } renames. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, "read");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ name?: string }>(request);
    const name = String(body.name || "").replace(/[\u0000-\u001f<>]/g, "").trim();
    if (!name) return jsonError("Give it a name.", 400, "BAD_REQUEST");
    return (await renameFile(auth.userId, id, name)) ? jsonOk({ id, name }) : jsonError("File not found.", 404, "NOT_FOUND");
  } catch (error) { return jsonError(reportError(error, "assistant/files/id:patch", auth.userId)); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, "read");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    return (await deleteFile(auth.userId, id)) ? jsonOk({ deleted: id }) : jsonError("File not found.", 404, "NOT_FOUND");
  } catch (error) { return jsonError(reportError(error, "assistant/files/id:delete", auth.userId)); }
}
