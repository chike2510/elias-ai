import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { addServer, listServers, MCP_PRESETS, removeServer } from "@/lib/assistant/mcp";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ servers: await listServers(auth.userId), presets: MCP_PRESETS }); }
  catch (error) { return jsonError(reportError(error, "mcp/servers", auth.userId)); }
}

/** Adds a server; keys go straight from the form to encrypted storage and never through the chat. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ preset?: string; url?: string; name?: string; key?: string }>(request);
    return jsonOk({ server: await addServer(auth.userId, body) }, { status: 201 });
  } catch (error) { return jsonError(reportError(error, "mcp/servers", auth.userId), 400); }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Pass id.", 400);
  try { return jsonOk({ deleted: await removeServer(auth.userId, id) }); }
  catch (error) { return jsonError(reportError(error, "mcp/servers", auth.userId), 400); }
}
