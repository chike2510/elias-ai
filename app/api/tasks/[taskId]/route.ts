import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { getTaskForUser, updateTaskAction } from "@/lib/taskOrchestrator";
import { getSession } from "@/lib/auth";
import { pollVideoGeneration } from "@/lib/videoGeneration";

type Context = { params: Promise<{ taskId: string }> };

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    const session = await getSession();
    const task = await getTaskForUser(taskId, session?.userId);
    if (!task) return jsonError("Task not found.", 404, "NOT_FOUND");
    const current = task.videoGeneration ? await pollVideoGeneration(taskId, session?.userId || "") : task;
    return jsonOk({ task: current || task }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load task.");
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    const session = await getSession();
    const current = await getTaskForUser(taskId, session?.userId);
    if (!current) return jsonError("Task not found.", 404, "NOT_FOUND");
    if (current.videoGeneration) return jsonError("Video jobs are managed through Studio.", 409, "VIDEO_JOB_MANAGED_SEPARATELY");
    const body = await readJsonRequest<{ action?: unknown; value?: unknown }>(request);
    const action = String(body.action || "");
    if (!["start", "pause", "cancel", "approve", "reject", "restore_checkpoint"].includes(action)) return jsonError("Unsupported task action.", 400, "INVALID_REQUEST");
    const task = await updateTaskAction(taskId, action as "start" | "pause" | "cancel" | "approve" | "reject" | "restore_checkpoint", typeof body.value === "string" ? body.value : undefined);
    return jsonOk({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update task.";
    return jsonError(message, message === "Task not found." ? 404 : 400, message === "Task not found." ? "NOT_FOUND" : "INVALID_REQUEST");
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    const session = await getSession();
    const current = await getTaskForUser(taskId, session?.userId);
    if (!current) return jsonError("Task not found.", 404, "NOT_FOUND");
    if (current.videoGeneration) return jsonError("Video jobs are managed through Studio.", 409, "VIDEO_JOB_MANAGED_SEPARATELY");
    const task = await updateTaskAction(taskId, "cancel");
    return jsonOk({ task });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not cancel task.");
  }
}
