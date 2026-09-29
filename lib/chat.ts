import type { TaskType } from "@/lib/types";
import { completeWithProvider, pickModel, providerDiagnostics, ProviderRequestError, DEFAULT_HF_CHAT_MODEL } from "@/lib/providers";

export type ChatInputMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

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
  const errors: string[] = [];
  const explicitSelection = Boolean(requestedProvider);
  const providers = requestedProvider ? [requestedProvider] : ["huggingface" as const];

  for (const provider of providers) {
    try {
      const model = requestedModel && provider === requestedProvider ? requestedModel : await pickModel(provider, task);
      if (!model) {
        if (explicitSelection) throw new ProviderRequestError({ provider, model: requestedModel || "unknown", message: `${provider} has no live model available in its catalog.`, durationMs: 0 });
        const diagnostics = providerDiagnostics().huggingface;
        const preferredModel = process.env.HF_CHAT_MODEL?.trim() || DEFAULT_HF_CHAT_MODEL;
        const message = diagnostics.configured && diagnostics.ok
          ? `Hugging Face chat model ${preferredModel} is not in the live chat catalog. Choose a current catalog model or set HF_CHAT_MODEL.`
          : !diagnostics.configured
            ? "Hugging Face Auto chat is not configured. Add HF_TOKEN with Hugging Face Inference Providers permission, or choose an explicit configured model."
            : "Hugging Face Auto chat could not load a live chat model. Verify HF_TOKEN has Inference Providers permission and retry.";
        throw new ProviderRequestError({ provider: "huggingface", model: "auto", message, durationMs: 0 });
      }
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
        fallbackProviders: errors.map((item) => item.split(":")[0]).filter(Boolean),
      };
    } catch (error) {
      if (explicitSelection || provider === "huggingface") throw error;
      errors.push(`${provider}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  throw new Error(`No AI provider completed the request. ${errors.slice(0, 4).join(" | ") || "No provider keys are configured."}`);
}
