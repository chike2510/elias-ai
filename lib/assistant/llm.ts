import { DEFAULT_HF_CHAT_MODEL, providerConfig } from "@/lib/providers";
import type { ProviderName } from "@/lib/types";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSchema = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type LlmResult = { content: string; toolCalls: ToolCall[]; provider: ProviderName | "custom"; model: string };

const DEFAULT_MODELS: Partial<Record<ProviderName, () => string>> = {
  huggingface: () => process.env.HF_AGENT_MODEL || process.env.HF_CHAT_MODEL || DEFAULT_HF_CHAT_MODEL,
  groq: () => process.env.GROQ_AGENT_MODEL || "llama-3.3-70b-versatile",
  mistral: () => process.env.MISTRAL_AGENT_MODEL || "mistral-large-latest",
  qwen: () => process.env.QWEN_AGENT_MODEL || "qwen-plus",
  github: () => process.env.GITHUB_AGENT_MODEL || "openai/gpt-4.1",
};

/** Providers tried in order for the tool-calling agent. Override with ELIAS_AGENT_PROVIDERS=groq,huggingface. */
export function agentProviders(): Array<ProviderName | "custom"> {
  const order = (process.env.ELIAS_AGENT_PROVIDERS || "custom,huggingface,groq,mistral").split(",").map((item) => item.trim());
  return order.filter((name): name is ProviderName | "custom" => name === "custom" ? Boolean(customConfig()) : Boolean(DEFAULT_MODELS[name as ProviderName] && providerConfig(name as ProviderName)?.key));
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

async function callProvider(provider: ProviderName | "custom", messages: LlmMessage[], tools: ToolSchema[], temperature: number): Promise<LlmResult> {
  const custom = provider === "custom" ? customConfig() : null;
  const config = custom || providerConfig(provider as ProviderName);
  const model = custom ? custom.model : DEFAULT_MODELS[provider as ProviderName]!();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model, messages, temperature, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${provider}/${model} HTTP ${response.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(`${provider}/${model} returned no message.`);
  const content = stripThinking(message.content || "");
  let toolCalls = (message.tool_calls || []).map((call, index) => ({ ...call, id: call.id || `call_${index}_${Date.now()}`, type: "function" as const }));
  if (!toolCalls.length && content.includes("<tool_call>")) toolCalls = recoverTextToolCalls(content, tools);
  return { content: toolCalls.length ? content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim() : content, toolCalls, provider, model };
}

export async function complete(messages: LlmMessage[], tools: ToolSchema[] = [], options: { temperature?: number; preferred?: ProviderName | "custom" } = {}): Promise<LlmResult> {
  const providers = agentProviders();
  if (options.preferred && providers.includes(options.preferred)) providers.unshift(...providers.splice(providers.indexOf(options.preferred), 1));
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set HF_TOKEN, GROQ_API_KEY or MISTRAL_API_KEY.");
  const errors: string[] = [];
  for (const provider of providers) {
    try { return await callProvider(provider, messages, tools, options.temperature ?? 0.3); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`All agent providers failed. ${errors.join(" | ")}`);
}
