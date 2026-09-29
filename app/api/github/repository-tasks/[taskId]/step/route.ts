import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { runGitHubRepositoryTaskStep } from "@/lib/githubRepositoryTaskRunner";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ taskId: string }> };

export async function POST(_request: NextRequest, context: Context) {
  const session = await getSession();
  if (!session) return jsonError("Sign in to continue this repository task.", 401, "AUTH_REQUIRED");
  const { taskId } = await context.params;
  try {
    const task = await runGitHubRepositoryTaskStep(taskId, session.userId);
    return jsonOk({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository task execution failed.";
    const status = message.includes("not found") ? 404 : message.includes("already running") ? 409 : 500;
    return jsonError(message, status, status === 404 ? "NOT_FOUND" : status === 409 ? "TASK_BUSY" : "REPOSITORY_TASK_FAILED");
  }
}
