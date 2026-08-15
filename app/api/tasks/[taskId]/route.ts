import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { getTask, updateTaskAction } from "@/lib/taskOrchestrator";

type Context = { params: Promise<{ taskId: string }> };

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    const task = getTask(taskId);
    if (!task) return jsonError("Task not found.", 404, "NOT_FOUND");
    return jsonOk({ task });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load task.");
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
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
    const task = await updateTaskAction(taskId, "cancel");
    return jsonOk({ task });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not cancel task.");
  }
}
