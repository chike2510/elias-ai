import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createTaskRecord, listTasks, runTaskLoop } from "@/lib/taskOrchestrator";
import type { CreateTaskInput } from "@/lib/task";

export const runtime = "nodejs";
export const maxDuration = 300;

function validWorkspace(value: unknown) {
  return Array.isArray(value) && value.length <= 500 && value.every((file) => {
    if (!file || typeof file !== "object") return false;
    const item = file as Record<string, unknown>;
    return typeof item.path === "string" && typeof item.content === "string" && item.path.length <= 240 && item.content.length <= 1_000_000;
  });
}

export async function GET(request: NextRequest) {
  try {
    return jsonOk({ tasks: await listTasks(request.nextUrl.searchParams.get("projectId") || undefined) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not list tasks.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRequest<CreateTaskInput & { autoStart?: boolean }>(request);
    if (typeof body.objective !== "string" || !body.objective.trim()) return jsonError("objective is required", 400, "INVALID_REQUEST");
    if (body.objective.length > 20_000) return jsonError("objective is too large", 413, "PAYLOAD_TOO_LARGE");
    if (body.workspace !== undefined && !validWorkspace(body.workspace)) return jsonError("workspace is invalid or too large", 413, "PAYLOAD_TOO_LARGE");
    const { autoStart, ...input } = body;
    const task = createTaskRecord({ ...input, objective: body.objective.trim() });
    if (autoStart === true) return jsonOk({ task: await runTaskLoop(task.id, 6) }, { status: 201 });
    return jsonOk({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create task.");
  }
}
