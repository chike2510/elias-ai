import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { runTaskLoop } from "@/lib/taskOrchestrator";
import { restoreStoredTask } from "@/lib/taskStore";
import type { TaskRecord } from "@/lib/task";

type Context = { params: Promise<{ taskId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    const body: { maxSteps?: unknown; task?: unknown } = await readJsonRequest<{ maxSteps?: unknown; task?: unknown }>(request).catch(() => ({}) as { maxSteps?: unknown; task?: unknown });
    if (body.task && typeof body.task === "object" && (body.task as { id?: unknown }).id === taskId) {
      const candidate = body.task as TaskRecord;
      if (typeof candidate.objective === "string" && Array.isArray(candidate.plan) && Array.isArray(candidate.workspace) && Array.isArray(candidate.events) && Array.isArray(candidate.toolResults)) await restoreStoredTask(candidate);
    }
    // Keep each serverless invocation bounded. The chat client schedules the next
    // queued step after this response, so one slow model/tool call cannot hold
    // a Vercel function open through an entire multi-step task.
    const maxSteps = typeof body.maxSteps === "number" ? Math.max(1, Math.min(1, Math.floor(body.maxSteps))) : 1;
    const task = await runTaskLoop(taskId, maxSteps);
    return jsonOk({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task execution failed.";
    return jsonError(message, message === "Task not found." ? 404 : 500, message === "Task not found." ? "NOT_FOUND" : "TASK_FAILED");
  }
}
