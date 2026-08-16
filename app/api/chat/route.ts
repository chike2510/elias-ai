import { NextRequest } from "next/server";
import { runChat } from "@/lib/chat";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import type { ProviderName, TaskType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const tasks = new Set<TaskType>(["general", "code", "research", "study"]);
const providers = new Set<ProviderName>(["qwen", "agentrouter", "groq", "openrouter", "cerebras", "mistral", "github"]);

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRequest<{ messages?: unknown; task?: unknown; provider?: unknown; model?: unknown }>(request);
    const messages = Array.isArray(body.messages)
      ? body.messages.filter((message): message is { role: "user" | "assistant" | "system"; content: string } => {
          if (!message || typeof message !== "object") return false;
          const value = message as Record<string, unknown>;
          return ["user", "assistant", "system"].includes(String(value.role)) && typeof value.content === "string";
        })
      : [];
    const task = tasks.has(body.task as TaskType) ? body.task as TaskType : "general";
    const provider = providers.has(body.provider as ProviderName) ? body.provider as ProviderName : undefined;
    const model = typeof body.model === "string" && body.model.trim().length > 0 && body.model.length < 180 ? body.model : undefined;

    if (!messages.length) return jsonError("messages are required", 400, "INVALID_REQUEST");
    if (messages.some((message) => message.content.length > 120_000)) return jsonError("A message is too large.", 413, "PAYLOAD_TOO_LARGE");

    const result = await runChat({ messages, task, provider, model });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "ELIAS could not respond.");
  }
}
