import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { runTaskLoop } from "@/lib/taskOrchestrator";

type Context = { params: Promise<{ taskId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    const body: { maxSteps?: unknown } = await readJsonRequest<{ maxSteps?: unknown }>(request).catch(() => ({}) as { maxSteps?: unknown });
    const maxSteps = typeof body.maxSteps === "number" ? Math.max(1, Math.min(12, Math.floor(body.maxSteps))) : 1;
    const task = await runTaskLoop(taskId, maxSteps);
    return jsonOk({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task execution failed.";
    return jsonError(message, message === "Task not found." ? 404 : 500, message === "Task not found." ? "NOT_FOUND" : "TASK_FAILED");
  }
}
