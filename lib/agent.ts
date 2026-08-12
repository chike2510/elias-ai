import { ChatMessage, ProviderName, TaskType } from "@/lib/types";
import { hasUsableConfig, orderedProviders, providerConfig } from "@/lib/providers";

function buildSystemPrompt(task: TaskType) {
  const base = [
    "You are ELIAS, a general-purpose AI workspace assistant.",
    "Be direct, accurate, and transparent about tool access.",
    "Do not claim to have changed files, searched the web, or run commands unless the application actually provided that tool.",
    "Prefer structured, actionable answers.",
  ];

  if (task === "code") {
    base.push(
      "You are acting as a senior software engineer.",
      "When generating code, favor complete, production-ready files over snippets.",
      "When useful, return code in fenced blocks with explicit file paths."
    );
  }
  if (task === "research") {
    base.push(
      "You are acting as a research assistant.",
      "Separate verified claims from assumptions and preserve source URLs when they are supplied."
    );
  }
  if (task === "study") {
    base.push(
      "You are acting as a study assistant.",
      "Explain concepts clearly and generate revision material from supplied content."
    );
  }
  return base.join(" ");
}

export async function runAgent(params: {
  task: TaskType;
  messages: ChatMessage[];
  preferredProvider?: ProviderName;
}) {
  const providers = params.preferredProvider
    ? [params.preferredProvider, ...orderedProviders(params.task)]
    : orderedProviders(params.task);

  const uniqueProviders = [...new Set(providers)];

  let lastError = "No provider is configured.";

  for (const name of uniqueProviders) {
    if (!hasUsableConfig(name)) continue;
    const cfg = providerConfig(name);
    const endpoint = `${cfg.baseUrl!.replace(/\/$/, "")}/chat/completions`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.key}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: buildSystemPrompt(params.task) },
            ...params.messages
          ]
        }),
        cache: "no-store"
      });

      if (!response.ok) {
        const detail = await response.text();
        lastError = `${name}: ${response.status} ${detail.slice(0, 400)}`;
        continue;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = `${name}: provider returned no content.`;
        continue;
      }

      return { provider: name, content };
    } catch (error) {
      lastError = `${name}: ${error instanceof Error ? error.message : "request failed"}`;
    }
  }

  throw new Error(lastError);
}