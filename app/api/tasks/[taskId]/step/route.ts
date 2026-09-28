import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { getTask, runTaskLoop } from "@/lib/taskOrchestrator";
import { getSession } from "@/lib/auth";

type Context = { params: Promise<{ taskId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to execute this task.", 401, "AUTH_REQUIRED");
    const { taskId } = await context.params;
    if (!(await getTask(taskId, session.userId))) return jsonError("Task not found.", 404, "NOT_FOUND");
    const body: { maxSteps?: unknown } = await readJsonRequest<{ maxSteps?: unknown }>(request).catch(() => ({}) as { maxSteps?: unknown });
    // Keep each serverless invocation bounded. The chat client schedules the next
    // queued step after this response, so one slow model/tool call cannot hold
    // a Vercel function open through an entire multi-step task.
    const maxSteps = typeof body.maxSteps === "number" ? Math.max(1, Math.min(1, Math.floor(body.maxSteps))) : 1;
    const task = await runTaskLoop(taskId, session.userId, maxSteps);
    return jsonOk({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task execution failed.";
    return jsonError(message, message === "Task not found." ? 404 : 500, message === "Task not found." ? "NOT_FOUND" : "TASK_FAILED");
  }
}
