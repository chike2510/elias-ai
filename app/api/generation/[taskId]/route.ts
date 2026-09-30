import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { pollVideoGeneration, publicVideoState } from "@/lib/videoGeneration";

export const runtime = "nodejs";
export const maxDuration = 45;

type Context = { params: Promise<{ taskId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to check this video job.", 401, "AUTH_REQUIRED");
    const { taskId } = await context.params;
    const task = await pollVideoGeneration(taskId, session.userId);
    if (!task) return jsonError("Video job not found.", 404, "NOT_FOUND");
    return jsonOk({ task, video: publicVideoState(task) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not check video job status.");
  }
}
