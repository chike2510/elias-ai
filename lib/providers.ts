import type { ProviderConfig, ProviderName, TaskType } from "@/lib/types";

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

const CONFIG: Record<ProviderName, ProviderConfig> = {
  experiential: {
    name: "experiential",
    key: process.env.EXPLABS_API_KEY || process.env.EXPERIENTIAL_API_KEY,
    baseUrl: normalizeBaseUrl(process.env.EXPERIENTIAL_BASE_URL || "https://api.experientiallabs.ai"),
    fallbackModels: [process.env.EXPERIENTIAL_MODEL].filter((model): model is string => Boolean(model)),
  },
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

function readResponsesOutput(data: unknown): NormalizedProviderResponse | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  const output = Array.isArray(value.output) ? value.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") chunks.push((part as Record<string, string>).text);
      }
    } else if (typeof content === "string") chunks.push(content);
  }
  const text = cleanText(chunks.join(""));
  return text ? { text, usage: value.usage, raw: data, contentType: "application/json" } : null;
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
    const responsesOutput = readResponsesOutput(parsed);
    if (responsesOutput) return { ...responsesOutput, contentType: contentType || "application/json" };

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

type ProviderDiagnostic = { configured: boolean; ok: boolean; status?: number; error?: string; modelCount: number };
const MODEL_DIAGNOSTICS = new Map<ProviderName, ProviderDiagnostic>();

function authHeaders(provider: ProviderName, key: string, variant: "bearer" | "x-api-key" = "bearer"): Record<string, string> {
  return variant === "x-api-key" ? { "x-api-key": key } : { Authorization: `Bearer ${key}` };
}

export function providerDiagnostics() {
  return Object.fromEntries((Object.keys(CONFIG) as ProviderName[]).map((provider) => [provider, MODEL_DIAGNOSTICS.get(provider) || { configured: Boolean(CONFIG[provider].key), ok: false, modelCount: 0 }]));
}

function modelIds(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  const candidates = Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : [];
  return candidates.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") return [(item as Record<string, string>).id];
    return [];
  }).map((id) => ({ id }));
}

export async function listModels(provider: ProviderName): Promise<Array<{ id: string }>> {
  const config = CONFIG[provider];
  if (!config.key) {
    MODEL_DIAGNOSTICS.set(provider, { configured: false, ok: false, modelCount: 0 });
    return [];
  }

  let lastError = "Model catalog request failed.";
  for (const authVariant of ["bearer", "x-api-key"] as const) {
    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { ...authHeaders(provider, config.key, authVariant), Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      const raw = await response.text();
      if (!response.ok) {
        lastError = `${response.status}: ${raw.slice(0, 240)}`;
        continue;
      }
      const ids = modelIds(JSON.parse(raw));
      MODEL_DIAGNOSTICS.set(provider, { configured: true, ok: true, status: response.status, modelCount: ids.length });
      return ids;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  MODEL_DIAGNOSTICS.set(provider, { configured: true, ok: false, error: lastError, modelCount: 0 });
  return [];
}

function score(id: string, task: TaskType): number {
  const value = id.toLowerCase();
  let score = 0;
  if (task === "code" && /code|coder|devstral|qwen|kimi|glm|gpt-oss|deepseek|claude|gpt/.test(value)) score += 10;
  if ((task === "research" || task === "general") && /qwen|kimi|glm|mistral|llama|gpt-oss|deepseek|claude|gpt|gemini/.test(value)) score += 7;
  if (task === "study" && /qwen|mistral|kimi|glm|gpt-oss|deepseek|claude|gpt|gemini/.test(value)) score += 6;
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
  if (task === "code" && complexity >= 8) return ["experiential", "qwen", "agentrouter", "cerebras", "openrouter", "mistral", "github", "groq"];
  if (task === "code") return ["experiential", "qwen", "cerebras", "agentrouter", "openrouter", "mistral", "github", "groq"];
  if (task === "research") return ["experiential", "openrouter", "cerebras", "qwen", "mistral", "agentrouter", "groq", "github"];
  return ["experiential", "cerebras", "qwen", "openrouter", "mistral", "agentrouter", "groq", "github"];
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
  const timeoutSignal = signal ?? AbortSignal.timeout(60_000);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders(provider, config.key) };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://elias-ai.vercel.app";
    headers["X-Title"] = "ELIAS";
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, temperature: temperature ?? 0.2, messages, stream }),
    cache: "no-store",
    signal: timeoutSignal,
  });

  if (response.ok) return readProviderResponse(response);
  const body = await response.text();
  if (provider === "experiential" && !stream) {
    const responsesResponse = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, temperature: temperature ?? 0.2, input: messages }),
      cache: "no-store",
      signal: timeoutSignal,
    });
    if (responsesResponse.ok) return readProviderResponse(responsesResponse);
    const responsesBody = await responsesResponse.text();
    throw new Error(`${provider} chat ${response.status}: ${body.slice(0, 360)}; responses ${responsesResponse.status}: ${responsesBody.slice(0, 360)}`);
  }
  throw new Error(`${provider} ${response.status}: ${body.slice(0, 700)}`);
}

export type ModelCatalogItem = {
  id: string;
  provider: ProviderName;
  label: string;
  detail: string;
  configured: boolean;
};

const MODEL_LABELS: Record<string, { label: string; detail: string }> = {
  "qwen3.8-27b": { label: "Qwen3.8 27B", detail: "Experiential · fast general / code" },
  "deepseek-v4-flash": { label: "DeepSeek V4 Flash", detail: "Experiential · fast reasoning" },
  "gpt-5.6-luna": { label: "GPT-5.6 Luna", detail: "Experiential · general / tool-ready" },
  "qwen3.7-plus": { label: "Qwen 3.7 Plus", detail: "Qwen · general / code" },
  "qwen3.7-flash": { label: "Qwen 3.7 Flash", detail: "Qwen · fast reasoning" },
  "kimi-k2.6": { label: "Kimi K2.6", detail: "AgentRouter · reasoning" },
  "glm-5.1": { label: "GLM 5.1", detail: "AgentRouter · general" },
  "step3p5-code-alpha": { label: "Step 3.5 Code", detail: "AgentRouter · coding" },
  "openai/gpt-oss-120b": { label: "GPT OSS 120B", detail: "Groq · fast responses" },
  "openrouter/free": { label: "OpenRouter Free", detail: "OpenRouter · automatic free route" },
  "zai-glm-4.7": { label: "GLM 4.7", detail: "Cerebras · fast reasoning" },
  "mistral-large-latest": { label: "Mistral Large", detail: "Mistral · writing / study" },
};

function modelLabel(provider: ProviderName, id: string) {
  return MODEL_LABELS[id] || { label: id, detail: `${provider} · provider model` };
}

export async function modelCatalog(): Promise<ModelCatalogItem[]> {
  const entries = await Promise.all((Object.keys(CONFIG) as ProviderName[]).map(async (provider) => {
    const config = CONFIG[provider];
    const configured = Boolean(config.key);
    const live = configured ? await listModels(provider) : [];
    const ids = [...new Set([...live.map((model) => model.id), ...config.fallbackModels])];
    return ids.map((id) => {
      const metadata = modelLabel(provider, id);
      return { id: `${provider}:${id}`, provider, label: metadata.label, detail: metadata.detail, configured } satisfies ModelCatalogItem;
    });
  }));
  return entries.flat();
}
