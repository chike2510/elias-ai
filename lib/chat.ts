import { pickModel, providerConfig, providerOrder } from "@/lib/providers";
import type { TaskType } from "@/lib/types";

export type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
};

function scoreComplexity(messages: ChatInputMessage[], task: TaskType): number {
  const text = messages.map((m) => m.content).join("\n");
  let score = task === "code" ? 5 : 3;
  if (/entire|complete|production|large|repository|project/i.test(text)) score += 2;
  if (text.length > 12_000) score += 1;
  return Math.min(10, score);
}

function orderFor(task: TaskType, complexity: number) {
  if (task === "code" && complexity >= 8) {
    return ["qwen", "agentrouter", "cerebras", "openrouter", "mistral", "groq", "github"] as const;
  }
  if (task === "code") {
    return ["qwen", "cerebras", "openrouter", "agentrouter", "mistral", "groq", "github"] as const;
  }
  if (task === "research") {
    return ["openrouter", "cerebras", "qwen", "groq", "mistral", "agentrouter", "github"] as const;
  }
  return providerOrder(task, complexity);
}

function systemPrompt(task: TaskType) {
  const parts = [
    "You are ELIAS, an intelligent general-purpose assistant.",
    "Answer normally and clearly. Do not output JSON unless the application explicitly asks for a tool payload.",
    "Be honest about what you can and cannot access.",
  ];

  if (task === "code") {
    parts.push(
      "For coding tasks, be precise, preserve the user's architecture, and provide complete code when the user asks for a file.",
    );
  }
  if (task === "research") {
    parts.push(
      "For research tasks, distinguish live-source facts from background knowledge. If no live web tool was used, do not claim current web verification.",
    );
  }
  if (task === "study") {
    parts.push(
      "For study tasks, explain clearly and turn supplied content into notes, questions, flashcards, or revision plans.",
    );
  }

  return parts.join(" ");
}

function normalizeText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : "",
      )
      .join("");
  }
  return "";
}

export async function runChat({
  messages,
  task,
}: {
  messages: ChatInputMessage[];
  task: TaskType;
}) {
  const complexity = scoreComplexity(messages, task);
  const errors: string[] = [];

  for (const provider of [...new Set(orderFor(task, complexity))]) {
    const key = process.env[
      provider === "qwen"
        ? "QWEN_API_KEY"
        : provider === "agentrouter"
          ? "AGENTROUTER_API_KEY"
          : provider === "groq"
            ? "GROQ_API_KEY"
            : provider === "openrouter"
              ? "OPENROUTER_API_KEY"
              : provider === "cerebras"
                ? "CEREBRAS_API_KEY"
                : provider === "mistral"
                  ? "MISTRAL_API_KEY"
                  : "GITHUB_TOKEN"
    ];

    if (!key) continue;

    try {
      const model = await pickModel(provider, task);
      const config = providerConfig(provider);
      if (!model) continue;

      const response = await fetch(
        `${config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.25,
            messages: [
              { role: "system", content: systemPrompt(task) },
              ...messages,
            ],
          }),
          cache: "no-store",
        },
      );

      if (!response.ok) {
        errors.push(
          `${provider} ${response.status}: ${(await response.text()).slice(0, 240)}`,
        );
        continue;
      }

      const data = await response.json();
      const text = normalizeText(data?.choices?.[0]?.message?.content);

      if (!text) {
        errors.push(`${provider}: empty response`);
        continue;
      }

      return { provider, model, content: text };
    } catch (error) {
      errors.push(
        `${provider}: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  }

  throw new Error(
    `No AI provider completed the request. ${errors.slice(0, 3).join(" | ")}`,
  );
}
