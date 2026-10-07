import { DEFAULT_HF_CHAT_MODEL, providerConfig } from "@/lib/providers";
import type { ProviderName } from "@/lib/types";
import type { ModelRoute, ModelTier } from "@/lib/assistant/modelRouter";

export type { ModelRoute, ModelTier };
/** Every provider the agent can use: the shared registry plus the agent-only custom endpoint and Gemini. */
export type AgentProvider = ProviderName | "custom" | "gemini";
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSchema = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type LlmResult = { content: string; toolCalls: ToolCall[]; provider: AgentProvider; model: string };

const env = (name: string) => (process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const GEMINI_LITE_FIRST = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash"];

type CandidateTable = Partial<Record<Exclude<AgentProvider, "custom">, () => string[]>>;

/** Models tried in order per provider (the "strong" tier). The first one the account can use wins and is remembered. */
const MODEL_CANDIDATES: CandidateTable = {
  gemini: () => [...env("GEMINI_AGENT_MODEL"), ...GEMINI_MODELS],
  groq: () => [...env("GROQ_AGENT_MODEL"), "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905", "meta-llama/llama-4-maverick-17b-128e-instruct", "qwen/qwen3-32b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
  cerebras: () => [...env("CEREBRAS_AGENT_MODEL"), "gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "qwen-3-32b", "llama3.1-8b"],
  github: () => [...env("GITHUB_AGENT_MODEL"), "openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  openrouter: () => [...env("OPENROUTER_AGENT_MODEL"), "openai/gpt-oss-120b:free", "deepseek/deepseek-chat-v3.1:free", "meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-235b-a22b:free", "mistralai/mistral-small-3.2-24b-instruct:free"],
  mistral: () => [...env("MISTRAL_AGENT_MODEL"), "mistral-medium-latest", "mistral-small-latest", "open-mistral-nemo", "mistral-large-latest"],
  huggingface: () => [...env("HF_AGENT_MODEL"), ...env("HF_CHAT_MODEL"), DEFAULT_HF_CHAT_MODEL],
  qwen: () => [...env("QWEN_AGENT_MODEL"), "qwen-plus", "qwen-turbo"],
};

/** Small, quick models for plain chat. Providers missing here use their normal list. */
const FAST_CANDIDATES: CandidateTable = {
  groq: () => [...env("GROQ_FAST_MODEL"), "llama-3.1-8b-instant", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  cerebras: () => [...env("CEREBRAS_FAST_MODEL"), "llama3.1-8b", "gpt-oss-120b", "qwen-3-32b", "llama-3.3-70b"],
  gemini: () => [...env("GEMINI_FAST_MODEL"), ...GEMINI_LITE_FIRST],
  github: () => [...env("GITHUB_FAST_MODEL"), "openai/gpt-4.1-mini", "openai/gpt-4o-mini", "openai/gpt-4.1"],
  mistral: () => [...env("MISTRAL_FAST_MODEL"), "mistral-small-latest", "open-mistral-nemo", "mistral-medium-latest"],
};

/** Models that accept OpenAI image_url content parts. Only these providers are used for image turns. */
const VISION_CANDIDATES: CandidateTable = {
  groq: () => [...env("GROQ_VISION_MODEL"), "meta-llama/llama-4-maverick-17b-128e-instruct", "meta-llama/llama-4-scout-17b-16e-instruct"],
  github: () => [...env("GITHUB_VISION_MODEL"), "openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o-mini"],
  openrouter: () => [...env("OPENROUTER_VISION_MODEL"), "meta-llama/llama-4-maverick:free", "google/gemma-3-27b-it:free", "qwen/qwen2.5-vl-72b-instruct:free", "mistralai/mistral-small-3.2-24b-instruct:free"],
  gemini: () => [...env("GEMINI_VISION_MODEL"), ...GEMINI_MODELS],
};

const TIER_TABLE: Record<ModelTier, CandidateTable> = { strong: MODEL_CANDIDATES, fast: FAST_CANDIDATES, vision: VISION_CANDIDATES };
const FAST_FIRST: AgentProvider[] = ["groq", "cerebras", "gemini"];
const VISION_ORDER: AgentProvider[] = ["custom", "groq", "github", "openrouter", "gemini"];

const VISION_GUESS = /vision|-vl\b|\bvl-|llama-4|maverick|scout|gemma-3|pixtral|gpt-4o|gpt-4\.1|gpt-5|gemini|llava|qwen2\.5-vl|qwen3-vl|phi-4-multimodal/i;

const DEFAULT_ORDER = "custom,groq,gemini,cerebras,github,openrouter,mistral,huggingface,qwen";
const workingModel = new Map<string, string>();
const deadModels = new Set<string>();
const providerCooldown = new Map<string, number>();
const discovered = new Map<string, Promise<Set<string> | null>>();

class ProviderError extends Error {
  /** model: this model can't be used (skip it for good). busy: overloaded or rate-limited right now (try the next model). */
  constructor(message: string, readonly kind: "model" | "account" | "busy" | "other") { super(message); }
}

function classify(status: number, body: string): "model" | "account" | "busy" | "other" {
  const text = body.toLowerCase();
  if (status === 429 || status === 503 || status === 529 || /high demand|overloaded|temporarily unavailable|"unavailable"|rate limit/.test(text)) return "busy";
  if (status === 401 || status === 402 || /no remaining credits|insufficient|quota|billing|invalid api key|unauthorized/.test(text)) return "account";
  if (status === 404 || /model_not_found|does not exist|not available in your subscription|tier_not_allowed|decommissioned|unknown model|invalid model|not a valid model|no endpoints found/.test(text)) return "model";
  if ((status === 400 || status === 403) && /model/.test(text)) return "model";
  return "other";
}

async function availableModels(provider: AgentProvider, baseUrl: string, key: string) {
  if (!discovered.has(provider)) {
    discovered.set(provider, fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (response) => response.ok ? new Set(((await response.json()) as { data?: Array<{ id?: string }> }).data?.map((item) => (item.id || "").replace(/^models\//, "")).filter(Boolean) || []) : null)
      .catch(() => null));
  }
  return discovered.get(provider)!;
}

/** OpenAI-compatible base URL and key for a provider. */
function configFor(provider: AgentProvider): { baseUrl: string; key: string } {
  if (provider === "custom") { const custom = customConfig(); return { baseUrl: custom?.baseUrl || "", key: custom?.key || "" }; }
  if (provider === "gemini") return { baseUrl: GEMINI_BASE_URL, key: process.env.GEMINI_API_KEY || "" };
  const config = providerConfig(provider);
  return { baseUrl: config?.baseUrl || "", key: config?.key || "" };
}

function tierList(provider: AgentProvider, tier: ModelTier) {
  if (provider === "custom") {
    const custom = customConfig()!;
    return tier === "vision" ? [...env("ELIAS_AGENT_VISION_MODEL"), custom.model] : tier === "fast" ? [...env("ELIAS_AGENT_FAST_MODEL"), custom.model] : [custom.model];
  }
  return (TIER_TABLE[tier][provider] || MODEL_CANDIDATES[provider])?.() || [];
}

function candidatesFor(provider: AgentProvider, route: ModelRoute) {
  const tier = route.tier;
  const list = [...new Set(tierList(provider, tier))];
  const known = workingModel.get(`${tier}:${provider}`);
  const ordered = (known ? [known, ...list.filter((model) => model !== known)] : list).filter((model) => !deadModels.has(`${provider}/${model}`));
  return route.provider === provider && route.model ? [route.model, ...ordered.filter((model) => model !== route.model)] : ordered;
}

/** Runs one call against a provider, walking its model list past models the account can't use. */
async function withModels(provider: AgentProvider, route: ModelRoute, run: (model: string) => Promise<LlmResult>): Promise<LlmResult> {
  const cooldown = providerCooldown.get(provider);
  if (cooldown && cooldown > Date.now()) throw new ProviderError(`${provider}: skipped (account unavailable)`, "account");
  let candidates = candidatesFor(provider, route);
  const pinned = route.provider === provider && route.model ? route.model : null;
  if (provider !== "custom") {
    const config = configFor(provider);
    const available = await availableModels(provider, config.baseUrl, config.key);
    if (available?.size) {
      const usable = candidates.filter((model) => model === pinned || available.has(model));
      if (usable.length) candidates = usable;
      else if (route.tier === "vision") {
        // None of the known vision ids are offered: try what discovery lists that looks multimodal.
        const guessed = [...available].filter((id) => VISION_GUESS.test(id) && !/guard|embed|tts|whisper|audio|image-gen|imagen|veo|live/i.test(id)).slice(0, 3);
        if (!guessed.length) throw new ProviderError(`${provider}: no vision model available on this account`, "model");
        candidates = guessed;
      }
      else candidates = [...available].filter((id) => !/whisper|tts|embed|guard|vision|audio|image|ocr|moderation|rerank|veo|imagen|live/i.test(id)).slice(0, 3);
    }
  }
  let lastError: unknown = new Error(`${provider}: no usable model`);
  for (const model of candidates.slice(0, 4)) {
    try {
      const result = await run(model);
      if (model !== pinned) workingModel.set(`${route.tier}:${provider}`, model);
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError && error.kind === "model") { deadModels.add(`${provider}/${model}`); continue; }
      if (error instanceof ProviderError && error.kind === "busy") continue;
      if (error instanceof ProviderError && error.kind === "account") providerCooldown.set(provider, Date.now() + 10 * 60_000);
      throw error;
    }
  }
  throw lastError;
}

/** Providers tried in order for the tool-calling agent. Override with ELIAS_AGENT_PROVIDERS=groq,huggingface. */
export function agentProviders(): AgentProvider[] {
  const order = (process.env.ELIAS_AGENT_PROVIDERS || DEFAULT_ORDER).split(",").map((item) => item.trim());
  // Gemini sits right after Groq whenever its key is set, even with an older custom order.
  if (process.env.GEMINI_API_KEY && !order.includes("gemini")) order.splice(order.includes("groq") ? order.indexOf("groq") + 1 : 0, 0, "gemini");
  return [...new Set(order)].filter((name): name is AgentProvider => name === "custom" ? Boolean(customConfig()) : Boolean(MODEL_CANDIDATES[name as Exclude<AgentProvider, "custom">] && configFor(name as AgentProvider).key));
}

/** Provider order for one call: the tier's preferred providers first, a pinned provider before everything. */
export function providersFor(route: ModelRoute = { tier: "strong" }): AgentProvider[] {
  const base = agentProviders();
  let order: AgentProvider[];
  if (route.tier === "vision") order = VISION_ORDER.filter((name) => base.includes(name));
  else if (route.tier === "fast") order = [...FAST_FIRST.filter((name) => base.includes(name)), ...base.filter((name) => !FAST_FIRST.includes(name))];
  else order = base;
  const pinned = route.provider as AgentProvider | undefined;
  if (pinned && base.includes(pinned)) order = [pinned, ...order.filter((name) => name !== pinned)];
  return order;
}

/** Raw /models ids per configured provider (owner health check diagnostics). */
export async function discoveredModels() {
  return Object.fromEntries(await Promise.all(agentProviders().filter((name) => name !== "custom").map(async (provider) => {
    const config = configFor(provider);
    const available = await availableModels(provider, config.baseUrl, config.key).catch(() => null);
    return [provider, available ? [...available].slice(0, 120) : null] as const;
  })));
}

/** Configured providers with the models the picker can offer (discovery-filtered when /models answers). */
export async function configuredModels() {
  const providers = agentProviders();
  return Promise.all(providers.map(async (provider) => {
    const ids = [...new Set([...tierList(provider, "strong"), ...tierList(provider, "fast"), ...tierList(provider, "vision")])];
    const visionIds = new Set(tierList(provider, "vision"));
    let models = ids;
    if (provider !== "custom") {
      const config = configFor(provider);
      const available = await availableModels(provider, config.baseUrl, config.key).catch(() => null);
      if (available?.size) { const usable = ids.filter((id) => available.has(id)); if (usable.length) models = usable; }
    }
    models = models.filter((id) => !deadModels.has(`${provider}/${id}`));
    return { provider, models: models.map((id) => ({ id, vision: provider !== "custom" && visionIds.has(id) })) };
  }));
}

function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

/** Some open models print tool calls as text instead of structured tool_calls. Recover them. */
function recoverTextToolCalls(text: string, tools: ToolSchema[]): ToolCall[] {
  const names = new Set(tools.map((tool) => tool.function.name));
  const calls: ToolCall[] = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  for (const match of text.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1]) as { name?: string; arguments?: unknown };
      if (parsed.name && names.has(parsed.name)) calls.push({ id: `call_${calls.length}_${Date.now()}`, type: "function", function: { name: parsed.name, arguments: typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments || {}) } });
    } catch { /* ignore malformed */ }
  }
  return calls;
}

/** Any OpenAI-compatible endpoint (OpenAI, OpenRouter, Together, a local server) via ELIAS_AGENT_BASE_URL. */
function customConfig() {
  const baseUrl = process.env.ELIAS_AGENT_BASE_URL;
  return baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, ""), key: process.env.ELIAS_AGENT_API_KEY || "", model: process.env.ELIAS_AGENT_MODEL || "gpt-4.1-mini" } : null;
}

async function callProvider(provider: AgentProvider, messages: LlmMessage[], tools: ToolSchema[], temperature: number, model: string): Promise<LlmResult> {
  const config = configFor(provider);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model, messages, temperature, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new ProviderError(`${provider}/${model} HTTP ${response.status}: ${raw.slice(0, 300)}`, classify(response.status, raw));
  let data: { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
  try { data = JSON.parse(raw); } catch { throw new ProviderError(`${provider}/${model} returned non-JSON: ${raw.slice(0, 80)}`, "busy"); }
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(`${provider}/${model} returned no message.`);
  const content = stripThinking(message.content || "");
  let toolCalls = (message.tool_calls || []).map((call, index) => ({ ...call, id: call.id || `call_${index}_${Date.now()}`, type: "function" as const }));
  if (!toolCalls.length && content.includes("<tool_call>")) toolCalls = recoverTextToolCalls(content, tools);
  return { content: toolCalls.length ? content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim() : content, toolCalls, provider, model };
}

type StreamDelta = { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };

/** Text the user may see while a reply streams: thinking blocks, tool-call markup and partial tags are held back. */
export function visibleStreamText(full: string) {
  let text = full.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const openThink = text.search(/<think>/i);
  if (openThink >= 0) text = text.slice(0, openThink);
  const toolTag = text.indexOf("<tool_call");
  if (toolTag >= 0) text = text.slice(0, toolTag);
  text = text.replace(/<[a-z_/]*$/i, "");
  return text.replace(/^\s+/, "");
}

async function streamProvider(provider: AgentProvider, messages: LlmMessage[], tools: ToolSchema[], temperature: number, onDelta: (text: string) => void, model: string): Promise<LlmResult> {
  const config = configFor(provider);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model, messages, temperature, stream: true, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) { const body = await response.text(); throw new ProviderError(`${provider}/${model} HTTP ${response.status}: ${body.slice(0, 300)}`, classify(response.status, body)); }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("event-stream") || !response.body) {
    // Provider ignored stream:true; treat it as a normal completion.
    const text = await response.text();
    let data: { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
    try { data = JSON.parse(text); } catch { throw new ProviderError(`${provider}/${model} returned non-JSON: ${text.slice(0, 80)}`, "busy"); }
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`${provider}/${model} returned no message.`);
    return finish(provider, model, message.content || "", message.tool_calls || [], tools, onDelta, "");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let emitted = "";
  const calls: Array<{ id?: string; name: string; args: string }> = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: StreamDelta[] } }> };
      try { chunk = JSON.parse(payload); } catch { continue; }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        const visible = visibleStreamText(content);
        if (visible.length > emitted.length && visible.startsWith(emitted)) { onDelta(visible.slice(emitted.length)); emitted = visible; }
      }
      for (const part of delta.tool_calls || []) {
        const index = part.index ?? calls.length;
        calls[index] ||= { name: "", args: "" };
        if (part.id) calls[index].id = part.id;
        if (part.function?.name) calls[index].name += part.function.name;
        if (part.function?.arguments) calls[index].args += part.function.arguments;
      }
    }
  }
  const toolCalls: ToolCall[] = calls.filter(Boolean).filter((call) => call.name).map((call, index) => ({ id: call.id || `call_${index}_${Date.now()}`, type: "function", function: { name: call.name, arguments: call.args || "{}" } }));
  return finish(provider, model, content, toolCalls, tools, onDelta, emitted);
}

function finish(provider: AgentProvider, model: string, raw: string, rawCalls: ToolCall[], tools: ToolSchema[], onDelta: (text: string) => void, emitted: string): LlmResult {
  const content = stripThinking(raw);
  let toolCalls = rawCalls.map((call, index) => ({ ...call, id: call.id || `call_${index}_${Date.now()}`, type: "function" as const }));
  if (!toolCalls.length && content.includes("<tool_call>")) toolCalls = recoverTextToolCalls(content, tools);
  const text = toolCalls.length ? content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim() : content;
  if (!toolCalls.length && !emitted && text) onDelta(text);
  return { content: text, toolCalls, provider, model };
}

/**
 * Same as complete() but streams visible reply text through onDelta. Falls back to the next
 * provider only when nothing has been streamed yet, so the user never sees two half-answers.
 */
export async function completeStream(messages: LlmMessage[], tools: ToolSchema[], onDelta: (text: string) => void, options: { temperature?: number; route?: ModelRoute } = {}): Promise<LlmResult> {
  const route = options.route || { tier: "strong" };
  const providers = providersFor(route);
  if (!providers.length && route.tier === "vision") throw new Error("No vision-capable model is configured. Set GROQ_API_KEY, GITHUB_TOKEN, OPENROUTER_API_KEY or GEMINI_API_KEY.");
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or HF_TOKEN.");
  const errors: string[] = [];
  for (const provider of providers) {
    let streamed = false;
    try { return await withModels(provider, route, (model) => streamProvider(provider, messages, tools, options.temperature ?? 0.3, (text) => { streamed = true; onDelta(text); }, model)); }
    catch (error) {
      if (streamed) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
      if (error instanceof ProviderError && error.kind !== "other") continue;
    }
    // Some providers reject stream+tools; the same provider without streaming is the next best thing.
    try {
      const result = await withModels(provider, route, (model) => callProvider(provider, messages, tools, options.temperature ?? 0.3, model));
      if (!result.toolCalls.length && result.content) onDelta(result.content);
      return result;
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`All agent providers failed. ${errors.join(" | ")}`.slice(0, 2000));
}

export async function complete(messages: LlmMessage[], tools: ToolSchema[] = [], options: { temperature?: number; preferred?: AgentProvider; route?: ModelRoute; only?: boolean } = {}): Promise<LlmResult> {
  const route = options.route || { tier: "strong" };
  // only: try just the pinned provider (the owner health check uses this to test one provider directly).
  const providers = options.only && route.provider ? providersFor(route).filter((name) => name === route.provider) : providersFor(route);
  if (options.preferred && providers.includes(options.preferred)) providers.unshift(...providers.splice(providers.indexOf(options.preferred), 1));
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or HF_TOKEN.");
  const errors: string[] = [];
  for (const provider of providers) {
    try { return await withModels(provider, route, (model) => callProvider(provider, messages, tools, options.temperature ?? 0.3, model)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`All agent providers failed. ${errors.join(" | ")}`.slice(0, 2000));
}
