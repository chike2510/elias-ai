import { NextRequest } from "next/server";
import { runElias } from "@/lib/eliasRuntime";
import { SKILL_REGISTRY } from "@/lib/skills";
import { detectExtendedSkills } from "@/lib/extendedSkills";
import type { AgentInput } from "@/lib/agent";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

function isFile(value: unknown): value is AgentInput["files"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.path === "string" && typeof item.content === "string" && item.path.length <= 240 && item.content.length <= 500_000;
}

function isMessage(value: unknown): value is AgentInput["messages"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.role === "string" && typeof item.content === "string" && item.content.length <= 120_000;
}

export async function POST(request: NextRequest) {
  try {
    const input = await readJsonRequest<AgentInput>(request);
    if (!input?.task || !input?.taskType || !Array.isArray(input.files) || !Array.isArray(input.messages) || !Array.isArray(input.toolResults)) {
      return jsonError("task, taskType, files, messages, and toolResults are required", 400, "INVALID_REQUEST");
    }
    if (input.task.length > 20_000) return jsonError("Task is too large.", 413, "PAYLOAD_TOO_LARGE");
    if (input.files.length > 500 || input.files.some((file) => !isFile(file))) return jsonError("Workspace file payload is invalid or too large.", 413, "WORKSPACE_TOO_LARGE");
    if (input.messages.length > 100 || input.messages.some((message) => !isMessage(message))) return jsonError("Agent message payload is invalid or too large.", 413, "PAYLOAD_TOO_LARGE");
    if (input.toolResults.length > 100) return jsonError("Too many tool results were supplied.", 413, "PAYLOAD_TOO_LARGE");
    const enabledSkills = Array.from(new Set(["autonomous-task-planner", ...SKILL_REGISTRY.filter((skill) => skill.status === "enabled" && detectExtendedSkills(input.task).includes(skill.id)).map((skill) => skill.id)]));
    const allowedTools = Array.from(new Set(["workspace.read", "workspace.write", "web.search", "artifact.create", ...SKILL_REGISTRY.filter((skill) => enabledSkills.includes(skill.id)).flatMap((skill) => skill.tools)]));
    const runtimeResult = await runElias({ mode: "agent", taskType: input.taskType, provider: input.preferredProvider, model: input.preferredModel, agent: input, context: { enabledSkills, allowedTools } });
    return jsonOk({ ...runtimeResult.result, runtime: runtimeResult.runtime });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "ELIAS agent step failed.");
  }
}
