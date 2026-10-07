import { DEFAULT_HF_CHAT_MODEL, providerConfig } from "@/lib/providers";
import type { ProviderName } from "@/lib/types";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSchema = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type LlmResult = { content: string; toolCalls: ToolCall[]; provider: ProviderName | "custom"; model: string };

const env = (name: string) => (process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);

/** Models tried in order per provider. The first one the account can use wins and is remembered. */
const MODEL_CANDIDATES: Partial<Record<ProviderName, () => string[]>> = {
  groq: () => [...env("GROQ_AGENT_MODEL"), "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905", "meta-llama/llama-4-maverick-17b-128e-instruct", "qwen/qwen3-32b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
  cerebras: () => [...env("CEREBRAS_AGENT_MODEL"), "gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "qwen-3-32b", "llama3.1-8b"],
  github: () => [...env("GITHUB_AGENT_MODEL"), "openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  openrouter: () => [...env("OPENROUTER_AGENT_MODEL"), "openai/gpt-oss-120b:free", "deepseek/deepseek-chat-v3.1:free", "meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-235b-a22b:free", "mistralai/mistral-small-3.2-24b-instruct:free"],
  mistral: () => [...env("MISTRAL_AGENT_MODEL"), "mistral-medium-latest", "mistral-small-latest", "open-mistral-nemo", "mistral-large-latest"],
  huggingface: () => [...env("HF_AGENT_MODEL"), ...env("HF_CHAT_MODEL"), DEFAULT_HF_CHAT_MODEL],
  qwen: () => [...env("QWEN_AGENT_MODEL"), "qwen-plus", "qwen-turbo"],
};

const DEFAULT_ORDER = "custom,groq,cerebras,github,openrouter,mistral,huggingface,qwen";
const workingModel = new Map<string, string>();
const deadModels = new Set<string>();
const providerCooldown = new Map<string, number>();
const discovered = new Map<string, Promise<Set<string> | null>>();

class ProviderError extends Error {
  constructor(message: string, readonly kind: "model" | "account" | "other") { super(message); }
}

function classify(status: number, body: string): "model" | "account" | "other" {
  const text = body.toLowerCase();
  if (status === 401 || status === 402 || /no remaining credits|insufficient|quota|billing|invalid api key|unauthorized/.test(text)) return "account";
  if (status === 404 || /model_not_found|does not exist|not available in your subscription|tier_not_allowed|decommissioned|unknown model|invalid model|not a valid model|no endpoints found/.test(text)) return "model";
  if ((status === 400 || status === 403) && /model/.test(text)) return "model";
  return "other";
}

async function availableModels(provider: ProviderName, baseUrl: string, key: string) {
  if (!discovered.has(provider)) {
    discovered.set(provider, fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (response) => response.ok ? new Set(((await response.json()) as { data?: Array<{ id?: string }> }).data?.map((item) => item.id || "").filter(Boolean) || []) : null)
      .catch(() => null));
  }
  return discovered.get(provider)!;
}

function candidatesFor(provider: ProviderName | "custom") {
  if (provider === "custom") return [customConfig()!.model];
  const list = [...new Set(MODEL_CANDIDATES[provider]?.() || [])];
  const known = workingModel.get(provider);
  return (known ? [known, ...list.filter((model) => model !== known)] : list).filter((model) => !deadModels.has(`${provider}/${model}`));
}

/** Runs one call against a provider, walking its model list past models the account can't use. */
async function withModels(provider: ProviderName | "custom", run: (model: string) => Promise<LlmResult>): Promise<LlmResult> {
  const cooldown = providerCooldown.get(provider);
  if (cooldown && cooldown > Date.now()) throw new ProviderError(`${provider}: skipped (account unavailable)`, "account");
  let candidates = candidatesFor(provider);
  if (provider !== "custom") {
    const config = providerConfig(provider);
    const available = await availableModels(provider, config.baseUrl, config.key || "");
    if (available?.size) {
      const usable = candidates.filter((model) => available.has(model));
      candidates = usable.length ? usable : [...available].filter((id) => !/whisper|tts|embed|guard|vision|audio|image|ocr|moderation|rerank/i.test(id)).slice(0, 3);
    }
  }
  let lastError: unknown = new Error(`${provider}: no usable model`);
  for (const model of candidates.slice(0, 4)) {
    try {
      const result = await run(model);
      workingModel.set(provider, model);
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError && error.kind === "model") { deadModels.add(`${provider}/${model}`); continue; }
      if (error instanceof ProviderError && error.kind === "account") providerCooldown.set(provider, Date.now() + 10 * 60_000);
      throw error;
    }
  }
  throw lastError;
}

/** Providers tried in order for the tool-calling agent. Override with ELIAS_AGENT_PROVIDERS=groq,huggingface. */
export function agentProviders(): Array<ProviderName | "custom"> {
  const order = (process.env.ELIAS_AGENT_PROVIDERS || DEFAULT_ORDER).split(",").map((item) => item.trim());
  return order.filter((name): name is ProviderName | "custom" => name === "custom" ? Boolean(customConfig()) : Boolean(MODEL_CANDIDATES[name as ProviderName] && providerConfig(name as ProviderName)?.key));
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

async function callProvider(provider: ProviderName | "custom", messages: LlmMessage[], tools: ToolSchema[], temperature: number, model: string): Promise<LlmResult> {
  const custom = provider === "custom" ? customConfig() : null;
  const config = custom || providerConfig(provider as ProviderName);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model, messages, temperature, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new ProviderError(`${provider}/${model} HTTP ${response.status}: ${raw.slice(0, 300)}`, classify(response.status, raw));
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
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

async function streamProvider(provider: ProviderName | "custom", messages: LlmMessage[], tools: ToolSchema[], temperature: number, onDelta: (text: string) => void, model: string): Promise<LlmResult> {
  const custom = provider === "custom" ? customConfig() : null;
  const config = custom || providerConfig(provider as ProviderName);
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
    const data = JSON.parse(await response.text()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
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

function finish(provider: ProviderName | "custom", model: string, raw: string, rawCalls: ToolCall[], tools: ToolSchema[], onDelta: (text: string) => void, emitted: string): LlmResult {
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
export async function completeStream(messages: LlmMessage[], tools: ToolSchema[], onDelta: (text: string) => void, options: { temperature?: number } = {}): Promise<LlmResult> {
  const providers = agentProviders();
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or HF_TOKEN.");
  const errors: string[] = [];
  for (const provider of providers) {
    let streamed = false;
    try { return await withModels(provider, (model) => streamProvider(provider, messages, tools, options.temperature ?? 0.3, (text) => { streamed = true; onDelta(text); }, model)); }
    catch (error) {
      if (streamed) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
      if (error instanceof ProviderError && error.kind !== "other") continue;
    }
    // Some providers reject stream+tools; the same provider without streaming is the next best thing.
    try {
      const result = await withModels(provider, (model) => callProvider(provider, messages, tools, options.temperature ?? 0.3, model));
      if (!result.toolCalls.length && result.content) onDelta(result.content);
      return result;
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`All agent providers failed. ${errors.join(" | ")}`.slice(0, 2000));
}

export async function complete(messages: LlmMessage[], tools: ToolSchema[] = [], options: { temperature?: number; preferred?: ProviderName | "custom" } = {}): Promise<LlmResult> {
  const providers = agentProviders();
  if (options.preferred && providers.includes(options.preferred)) providers.unshift(...providers.splice(providers.indexOf(options.preferred), 1));
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or HF_TOKEN.");
  const errors: string[] = [];
  for (const provider of providers) {
    try { return await withModels(provider, (model) => callProvider(provider, messages, tools, options.temperature ?? 0.3, model)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`All agent providers failed. ${errors.join(" | ")}`.slice(0, 2000));
}
