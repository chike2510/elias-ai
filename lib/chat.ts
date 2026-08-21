import type { TaskType } from "@/lib/types";
import { completeWithProvider, pickModel, providerOrder } from "@/lib/providers";

export type ChatInputMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function scoreComplexity(messages: ChatInputMessage[], task: TaskType): number {
  const text = messages.map((message) => message.content).join("\n");
  let score = task === "code" ? 5 : 3;
  if (/entire|complete|production|large|repository|project/i.test(text)) score += 2;
  if (text.length > 12_000) score += 1;
  return Math.min(10, score);
}

function systemPrompt(task: TaskType) {
  const parts = [
    "You are ELIAS, an intelligent general-purpose assistant.",
    "Answer normally in clear markdown. Do not output JSON unless the application explicitly asks for a tool payload.",
    "Be honest about what you can and cannot access. Never claim to have edited files or run commands unless a tool result confirms it.",
  ];
  if (task === "code") parts.push("For coding tasks, be precise, preserve the user's architecture, and provide complete code when the user asks for a file.");
  if (task === "research") parts.push("For research tasks, distinguish live-source facts from background knowledge and include source links when live web results are provided.");
  if (task === "study") parts.push("For study tasks, explain clearly and turn supplied content into notes, questions, flashcards, or revision plans.");
  return parts.join(" ");
}

export async function runChat({ messages, task, provider: requestedProvider, model: requestedModel, systemContext }: { messages: ChatInputMessage[]; task: TaskType; provider?: import("@/lib/types").ProviderName; model?: string; systemContext?: string }) {
  const complexity = scoreComplexity(messages, task);
  const errors: string[] = [];
  const providers = requestedProvider ? [requestedProvider] : [...new Set(providerOrder(task, complexity))];

  for (const provider of providers) {
    try {
      const model = requestedModel && provider === requestedProvider ? requestedModel : await pickModel(provider, task);
      if (!model) continue;
      const response = await completeWithProvider({
        provider,
        model,
        temperature: 0.25,
        messages: [
          { role: "system", content: systemPrompt(task) },
          ...(systemContext ? [{ role: "system" as const, content: systemContext }] : []),
          ...messages,
        ],
      });
      if (!response.text) {
        errors.push(`${provider}: empty response`);
        continue;
      }
      return {
        ok: true as const,
        provider,
        model,
        content: response.text,
        finishReason: response.finishReason,
      };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  throw new Error(`No AI provider completed the request. ${errors.slice(0, 4).join(" | ") || "No provider keys are configured."}`);
}
