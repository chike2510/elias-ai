import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { snapshotStoredTaskForUser } from "@/lib/taskStore";
import { extensionTokenFromRequest } from "@/lib/extensionAuth";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const token = extensionTokenFromRequest(_request);
    if (!token) return jsonError("Pair this extension with a signed-in Elias account first.", 401, "EXTENSION_AUTH_REQUIRED");
    const { taskId } = await params;
    const snapshot = await snapshotStoredTaskForUser(taskId, token.sub);
    if (!snapshot) return jsonError("Task not found.", 404, "NOT_FOUND");
    return jsonOk({ taskId, task: snapshot.task, events: snapshot.events, approvals: snapshot.approvals, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not read task events.");
  }
}
