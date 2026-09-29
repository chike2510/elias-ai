import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubRepositoryTask, updateGitHubRepositoryTask } from "@/lib/githubRepositoryTaskStore";
import { resolveGitHubRepositoryTaskApproval, restoreGitHubRepositoryTaskCheckpoint } from "@/lib/githubRepositoryTaskRunner";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ taskId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session) return jsonError("Sign in to view this repository task.", 401, "AUTH_REQUIRED");
  const { taskId } = await context.params;
  const record = await getGitHubRepositoryTask(taskId, session.userId);
  if (!record) return jsonError("Repository task not found.", 404, "NOT_FOUND");
  return jsonOk({ task: record.task }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session) return jsonError("Sign in to update this repository task.", 401, "AUTH_REQUIRED");
  const { taskId } = await context.params;
  const body = await readJsonRequest<{ action?: unknown; value?: unknown }>(request).catch(() => ({ action: undefined, value: undefined }));
  try {
    let task;
    if (body.action === "pause" || body.action === "cancel") {
      const record = await updateGitHubRepositoryTask(taskId, session.userId, (current) => {
        current.task.status = body.action === "pause" ? "paused" : "cancelled";
        if (body.action === "cancel") current.task.completedAt = Date.now();
        current.task.events.push({ id: `evt_${crypto.randomUUID()}`, taskId, kind: "action", label: body.action === "pause" ? "Repository task paused" : "Repository task cancelled", status: "completed", createdAt: Date.now(), detail: "The task owner updated this repository task." });
      });
      task = record.task;
    } else if ((body.action === "approve" || body.action === "reject") && typeof body.value === "string") {
      const record = await resolveGitHubRepositoryTaskApproval(taskId, session.userId, body.value, body.action === "approve");
      task = record.task;
    } else if (body.action === "restore_checkpoint" && typeof body.value === "string") {
      const record = await restoreGitHubRepositoryTaskCheckpoint(taskId, session.userId, body.value);
      task = record.task;
    } else return jsonError("A valid approval, rejection, or checkpoint restore action is required.", 400, "INVALID_ACTION");
    return jsonOk({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update this repository task.";
    const status = message.includes("not found") ? 404 : 400;
    return jsonError(message, status, status === 404 ? "NOT_FOUND" : "TASK_ACTION_FAILED");
  }
}
