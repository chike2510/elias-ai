import type { ProviderConfig, ProviderName, TaskType } from "@/lib/types";

const CONFIG: Record<ProviderName, ProviderConfig> = {
  qwen: {
    name: "qwen",
    key: process.env.QWEN_API_KEY,
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    fallbackModels: ["qwen3.7-plus", "qwen3.7-flash"],
  },
  agentrouter: {
    name: "agentrouter",
    key: process.env.AGENTROUTER_API_KEY,
    baseUrl: "https://co.agentrouter.org/v1",
    fallbackModels: ["kimi-k2.6", "glm-5.1", "step3p5-code-alpha"],
  },
  groq: {
    name: "groq",
    key: process.env.GROQ_API_KEY,
    baseUrl: "https://api.groq.com/openai/v1",
    fallbackModels: ["openai/gpt-oss-120b"],
  },
  openrouter: {
    name: "openrouter",
    key: process.env.OPENROUTER_API_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
    fallbackModels: ["openrouter/free"],
  },
  cerebras: {
    name: "cerebras",
    key: process.env.CEREBRAS_API_KEY,
    baseUrl: "https://api.cerebras.ai/v1",
    fallbackModels: ["zai-glm-4.7"],
  },
  mistral: {
    name: "mistral",
    key: process.env.MISTRAL_API_KEY,
    baseUrl: "https://api.mistral.ai/v1",
    fallbackModels: ["mistral-large-latest"],
  },
  github: {
    name: "github",
    key: process.env.GITHUB_TOKEN,
    baseUrl: "https://models.github.ai/inference",
    fallbackModels: [],
  },
};

export type NormalizedProviderResponse = {
  text: string;
  finishReason?: string;
  usage?: unknown;
  raw: unknown;
  contentType: string;
};

function normalizeText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function cleanText(value: string) {
  return value.replace(/^\s+/, "").replace(/\s+$/, "");
}

function readChoice(data: unknown): NormalizedProviderResponse | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const choice = choices[0];
  if (!choice || typeof choice !== "object") return null;
  const item = choice as Record<string, unknown>;
  const message = item.message;
  const messageValue = message && typeof message === "object" ? message as Record<string, unknown> : undefined;
  const text = cleanText(normalizeText(messageValue?.content ?? item.text ?? item.delta));
  if (!text) return null;
  return {
    text,
    finishReason: typeof item.finish_reason === "string" ? item.finish_reason : undefined,
    usage: value.usage,
    raw: data,
    contentType: "application/json",
  };
}

function parseSse(raw: string): NormalizedProviderResponse | null {
  const chunks: string[] = [];
  let last: NormalizedProviderResponse | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const value = line.trim();
    if (!value.startsWith("data:")) continue;
    const payload = value.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = readChoice(JSON.parse(payload));
      if (parsed) {
        chunks.push(parsed.text);
        last = parsed;
      }
    } catch {
      // Ignore malformed individual SSE events; the caller will receive a useful error if no content survives.
    }
  }
  if (!chunks.length) return null;
  return { ...last!, text: chunks.join(""), contentType: "text/event-stream" };
}

export async function readProviderResponse(response: Response): Promise<NormalizedProviderResponse> {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const trimmed = raw.trim();

  if (contentType.includes("text/event-stream") || trimmed.startsWith("data:")) {
    const sse = parseSse(raw);
    if (sse) return sse;
  }

  if (!trimmed) throw new Error("Provider returned an empty response.");

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const choice = readChoice(parsed);
    if (choice) return { ...choice, contentType: contentType || "application/json" };

    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error?: unknown }).error;
      const message = typeof error === "string" ? error : JSON.stringify(error);
      throw new Error(message.slice(0, 700));
    }

    throw new Error("Provider JSON did not contain a usable assistant message.");
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Provider returned non-JSON content (${trimmed.slice(0, 240)}).`);
    }
    throw error;
  }
}

export function providerConfig(provider: ProviderName): ProviderConfig {
  return CONFIG[provider];
}

export function configuredProviders(): ProviderName[] {
  return (Object.keys(CONFIG) as ProviderName[]).filter((provider) => Boolean(CONFIG[provider].key));
}

export async function listModels(provider: ProviderName): Promise<Array<{ id: string }>> {
  const config = CONFIG[provider];
  if (!config.key) return [];

  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const raw = await response.text();
    if (!response.ok) return [];
    const data = JSON.parse(raw) as { data?: Array<{ id?: unknown }> };
    return Array.isArray(data.data)
      ? data.data.filter((model): model is { id: string } => typeof model?.id === "string")
      : [];
  } catch {
    return [];
  }
}

function score(id: string, task: TaskType): number {
  const value = id.toLowerCase();
  let score = 0;
  if (task === "code" && /code|coder|devstral|qwen|kimi|glm|gpt-oss/.test(value)) score += 10;
  if ((task === "research" || task === "general") && /qwen|kimi|glm|mistral|llama|gpt-oss|deepseek/.test(value)) score += 7;
  if (task === "study" && /qwen|mistral|kimi|glm|gpt-oss/.test(value)) score += 6;
  if (/reason|thinking/.test(value)) score += 2;
  if (/free/.test(value)) score += 2;
  return score;
}

export async function pickModel(provider: ProviderName, task: TaskType): Promise<string | null> {
  const config = CONFIG[provider];
  if (!config.key) return null;
  const models = await listModels(provider);
  const ranked = models.map((model) => model.id).sort((a, b) => score(b, task) - score(a, task));
  return ranked[0] || config.fallbackModels[0] || null;
}

export function providerOrder(task: TaskType, complexity: number): ProviderName[] {
  if (task === "code" && complexity >= 8) return ["qwen", "agentrouter", "cerebras", "openrouter", "mistral", "github", "groq"];
  if (task === "code") return ["qwen", "cerebras", "agentrouter", "openrouter", "mistral", "github", "groq"];
  if (task === "research") return ["openrouter", "cerebras", "qwen", "mistral", "agentrouter", "groq", "github"];
  return ["cerebras", "qwen", "openrouter", "mistral", "agentrouter", "groq", "github"];
}

export async function chooseProvider(task: TaskType, complexity: number): Promise<ProviderName | null> {
  for (const provider of providerOrder(task, complexity)) {
    if (CONFIG[provider].key && await pickModel(provider, task)) return provider;
  }
  return null;
}

export async function completeWithProvider({
  provider,
  model,
  messages,
  temperature,
  signal,
  stream = false,
}: {
  provider: ProviderName;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  signal?: AbortSignal;
  stream?: boolean;
}): Promise<NormalizedProviderResponse> {
  const config = CONFIG[provider];
  if (!config.key) throw new Error(`${provider} is not configured.`);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`,
      ...(provider === "openrouter" ? { "HTTP-Referer": "https://elias-ai.vercel.app", "X-Title": "ELIAS" } : {}),
    },
    body: JSON.stringify({ model, temperature: temperature ?? 0.2, messages, stream }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${provider} ${response.status}: ${body.slice(0, 700)}`);
  }

  return readProviderResponse(response);
}
