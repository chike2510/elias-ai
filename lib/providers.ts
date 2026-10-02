import type { ModelCapability, ModelInfo, ProviderConfig, ProviderName, TaskType } from "@/lib/types";

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export const DEFAULT_HF_CHAT_MODEL = "Qwen/Qwen3.8-27B:fastest";

const CONFIG: Record<ProviderName, ProviderConfig> = {
  huggingface: {
    name: "huggingface",
    key: process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY,
    baseUrl: "https://router.huggingface.co/v1",
  },
  experiential: {
    name: "experiential",
    key: process.env.EXPLABS_API_KEY || process.env.EXPERIENTIAL_API_KEY,
    baseUrl: normalizeBaseUrl(process.env.EXPERIENTIAL_BASE_URL || "https://api.experientiallabs.ai"),
  },
  qwen: {
    name: "qwen",
    key: process.env.QWEN_API_KEY,
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  agentrouter: {
    name: "agentrouter",
    key: process.env.AGENTROUTER_API_KEY,
    baseUrl: "https://co.agentrouter.org/v1",
  },
  groq: {
    name: "groq",
    key: process.env.GROQ_API_KEY,
    baseUrl: "https://api.groq.com/openai/v1",
  },
  mistral: {
    name: "mistral",
    key: process.env.MISTRAL_API_KEY,
    baseUrl: "https://api.mistral.ai/v1",
  },
  github: {
    name: "github",
    key: process.env.GITHUB_TOKEN,
    baseUrl: "https://models.github.ai/inference",
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

export type ProviderDiagnostic = { provider?: ProviderName; configured: boolean; ok: boolean; status?: number; error?: string; modelCount: number; latencyMs?: number; checkedAt?: string };
const MODEL_DIAGNOSTICS = new Map<ProviderName, ProviderDiagnostic>();

function authHeaders(provider: ProviderName, key: string, variant: "bearer" | "x-api-key" = "bearer"): Record<string, string> {
  return variant === "x-api-key" ? { "x-api-key": key } : { Authorization: `Bearer ${key}` };
}

export function providerDiagnostics() {
  return Object.fromEntries((Object.keys(CONFIG) as ProviderName[]).map((provider) => [provider, MODEL_DIAGNOSTICS.get(provider) || { configured: Boolean(CONFIG[provider].key), ok: false, modelCount: 0 }]));
}

function modelEntries(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  const candidates = Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : [];
  return candidates.flatMap((item) => {
    if (typeof item === "string") return [{ id: item }];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") return [item as Record<string, unknown>];
    return [];
  });
}

function inferredCapabilities(id: string): ModelCapability[] {
  const value = id.toLowerCase();
  const capabilities: ModelCapability[] = ["text"];
  if (/reason|think|o[1-9]|r1/.test(value)) capabilities.push("reasoning");
  if (/code|coder|dev|deepseek|qwen|claude|gpt/.test(value)) capabilities.push("code");
  if (/vision|vl|gemini|gpt-4|claude-3/.test(value)) capabilities.push("vision");
  if (/image|flux|dall|stable-diffusion/.test(value)) capabilities.push("image-generation");
  capabilities.push("streaming");
  return [...new Set(capabilities)];
}

function normalizeModel(provider: ProviderName, item: Record<string, unknown>): ModelInfo {
  const id = String(item.id);
  const rawCapabilities = item.capabilities;
  const listed = Array.isArray(rawCapabilities) ? rawCapabilities.filter((value): value is ModelCapability => typeof value === "string") : [];
  const capabilities = listed.length ? listed : inferredCapabilities(id);
  const contextWindow = typeof item.context_window === "number" ? item.context_window : typeof item.contextWindow === "number" ? item.contextWindow : undefined;
  return { id, provider, name: typeof item.name === "string" ? item.name : id, capabilities, contextWindow, reasoning: capabilities.includes("reasoning"), vision: capabilities.includes("vision"), toolCalling: capabilities.includes("tool-use"), imageGeneration: capabilities.includes("image-generation"), inferred: listed.length === 0 };
}

export async function listModels(provider: ProviderName): Promise<ModelInfo[]> {
  const config = CONFIG[provider];
  if (!config.key) {
    MODEL_DIAGNOSTICS.set(provider, { configured: false, ok: false, modelCount: 0 });
    return [];
  }

  let lastError = "Model catalog request failed.";
  const started = Date.now();
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
      const ids = modelEntries(JSON.parse(raw)).map((item) => normalizeModel(provider, item));
      MODEL_DIAGNOSTICS.set(provider, { provider, configured: true, ok: true, status: response.status, modelCount: ids.length, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() });
      return ids;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  MODEL_DIAGNOSTICS.set(provider, { provider, configured: true, ok: false, error: lastError, modelCount: 0, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() });
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
  if (provider === "huggingface") {
    const configuredModel = process.env.HF_CHAT_MODEL?.trim() || DEFAULT_HF_CHAT_MODEL;
    const catalogId = configuredModel.replace(/:(fastest|cheapest|preferred)$/i, "");
    return models.some((model) => model.id === configuredModel || model.id === catalogId) ? configuredModel : null;
  }
  const ranked = models.map((model) => model.id).sort((a, b) => score(b, task) - score(a, task));
  return ranked[0] || null;
}

export function providerOrder(task: TaskType, complexity: number): ProviderName[] {
  const remaining: ProviderName[] = task === "code"
    ? complexity >= 8 ? ["qwen", "agentrouter", "mistral", "github", "groq", "experiential"] : ["qwen", "agentrouter", "groq", "mistral", "github", "experiential"]
    : task === "research"
      ? ["qwen", "mistral", "agentrouter", "groq", "github", "experiential"]
      : ["qwen", "agentrouter", "groq", "mistral", "github", "experiential"];
  return ["huggingface", ...remaining];
}

export async function chooseProvider(task: TaskType, complexity: number): Promise<ProviderName | null> {
  for (const provider of providerOrder(task, complexity)) {
    if (CONFIG[provider].key && await pickModel(provider, task)) return provider;
  }
  return null;
}

function normalizeHuggingFaceMessages(messages: Array<{ role: string; content: string }>) {
  const systemInstructions: string[] = [];
  const conversationMessages: Array<{ role: string; content: string }> = [];

  for (const message of messages) {
    if (message.role === "system") systemInstructions.push(message.content);
    else conversationMessages.push(message);
  }

  if (!systemInstructions.length) return messages;
  return [
    { role: "system", content: systemInstructions.join("\n\n") },
    ...conversationMessages,
  ];
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
  if (!config.key) throw new ProviderRequestError({ provider, model, message: `${provider} is not configured.`, durationMs: 0 });
  const started = Date.now();
  const timeoutSignal = signal ?? AbortSignal.timeout(60_000);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders(provider, config.key) };
  // Runtime enrichment can append system context after conversation turns. Hugging Face
  // chat templates require system instructions first, so coalesce them without changing turn order.
  const requestMessages = provider === "huggingface" ? normalizeHuggingFaceMessages(messages) : messages;
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, temperature: temperature ?? 0.2, messages: requestMessages, stream }),
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
    throw new ProviderRequestError({ provider, model, status: responsesResponse.status, message: `${provider}/${model} failed: chat HTTP ${response.status}: ${body.slice(0, 360)}; responses HTTP ${responsesResponse.status}: ${responsesBody.slice(0, 360)}`, durationMs: Date.now() - started });
  }
  throw new ProviderRequestError({ provider, model, status: response.status, message: `${provider}/${model} failed with HTTP ${response.status}: ${body.slice(0, 700)}`, durationMs: Date.now() - started });
}

export type ModelCatalogItem = {
  id: string;
  provider: ProviderName;
  label: string;
  detail: string;
  configured: boolean;
  capabilities?: ModelCapability[];
};

function providerDisplayName(provider: ProviderName) {
  return provider === "huggingface" ? "Hugging Face" : provider.charAt(0).toUpperCase() + provider.slice(1);
}

export class ProviderRequestError extends Error {
  constructor(public readonly details: { provider: ProviderName; model: string; status?: number; message: string; durationMs: number }) {
    super(details.message);
    this.name = "ProviderRequestError";
  }
}

export async function modelCatalog(): Promise<ModelCatalogItem[]> {
  const entries = await Promise.all((Object.keys(CONFIG) as ProviderName[]).map(async (provider) => {
    const config = CONFIG[provider];
    const configured = Boolean(config.key);
    const live = configured ? await listModels(provider) : [];
    return live.map((model) => ({ id: `${provider}:${model.id}`, provider, label: model.name, detail: `${providerDisplayName(provider)} provider · ${model.capabilities.join(" / ")}${model.inferred ? " · inferred" : ""}`, configured, capabilities: model.capabilities } satisfies ModelCatalogItem));
  }));
  return entries.flat();
}
