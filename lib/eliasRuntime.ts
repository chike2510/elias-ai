import { runAgentStep, type AgentInput, type AgentOutput } from "@/lib/agent";
import { runChat, type ChatInputMessage } from "@/lib/chat";
import type { ProviderName, TaskType } from "@/lib/types";

export type EliasMode = "auto" | "instant" | "deep" | "code" | "research" | "agent";

type ChatInput = { messages: ChatInputMessage[]; task: TaskType; provider?: ProviderName; model?: string };
type ChatOutput = { ok: true; provider: string; model: string; content: string; finishReason?: string };

export type EliasRunInput = {
  mode?: EliasMode;
  taskType?: TaskType;
  provider?: ProviderName;
  model?: string;
  chat?: ChatInput;
  agent?: AgentInput;
  context?: {
    projectId?: string;
    documentIds?: string[];
    selectedFiles?: string[];
    enabledSkills?: string[];
    allowedTools?: string[];
  };
};

export type EliasRunOutput = {
  kind: "chat" | "agent";
  mode: EliasMode;
  result: ChatOutput | AgentOutput;
  runtime: {
    agent: "elias";
    selectedSkills: string[];
    selectedTools: string[];
    model: string;
    provider: string;
  };
};

function modeTask(mode: EliasMode | undefined, taskType: TaskType | undefined): TaskType {
  if (mode === "code") return "code";
  if (mode === "research") return "research";
  if (mode === "deep") return taskType || "general";
  return taskType || "general";
}

function runtimeMetadata(result: ChatOutput | AgentOutput, context: EliasRunInput["context"]): EliasRunOutput["runtime"] {
  return {
    agent: "elias",
    selectedSkills: context?.enabledSkills || [],
    selectedTools: context?.allowedTools || [],
    model: result.model,
    provider: result.provider,
  };
}

export async function runElias(input: EliasRunInput): Promise<EliasRunOutput> {
  const mode = input.mode || "auto";
  const taskType = modeTask(mode, input.taskType);

  if (mode === "agent" || input.agent) {
    if (!input.agent) throw new Error("Agent input is required for agent mode.");
    const result = await runAgentStep({ ...input.agent, taskType, preferredProvider: input.provider, preferredModel: input.model });
    return { kind: "agent", mode, result, runtime: runtimeMetadata(result, input.context) };
  }

  if (!input.chat) throw new Error("Chat input is required for conversational modes.");
  const result = await runChat({ ...input.chat, task: taskType, provider: input.provider, model: input.model });
  return { kind: "chat", mode, result, runtime: runtimeMetadata(result, input.context) };
}
