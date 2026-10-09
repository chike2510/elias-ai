import { DEFAULT_HF_CHAT_MODEL, providerConfig } from "@/lib/providers";
import type { ProviderName } from "@/lib/types";
import type { ModelRoute, ModelTier } from "@/lib/assistant/modelRouter";

export type { ModelRoute, ModelTier };
/** Every provider the agent can use: the shared registry plus the agent-only custom endpoint and Gemini. */
export type AgentProvider = ProviderName | "custom" | "gemini" | "cloudflare";
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
/**
 * Used only when Gemini's model list can't be read. Google closed gemini-2.x to new keys ("no longer
 * available to new users, use models/gemini-3.8-flash"), so the newest flash models lead and 2.x is gone.
 */
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
const GEMINI_LITE_FIRST = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"];

/**
 * Cloudflare Workers AI through its OpenAI-compatible endpoint. Reuses CLOUDFLARE_ACCOUNT_ID (set for Browser Run)
 * and takes CLOUDFLARE_AI_TOKEN when set, else CLOUDFLARE_API_TOKEN, else the Browser Run token. The token needs
 * "Workers AI: Read" on the account. Free plan: 10,000 neurons a day, reset at 00:00 UTC.
 */
export function cloudflareConfig() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const key = (process.env.CLOUDFLARE_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BROWSER_TOKEN || "").trim();
  return accountId && key ? { accountId, key, baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1` } : null;
}
/** Tool-calling chat models on Workers AI (checked against developers.cloudflare.com/workers-ai/models, Oct 2026). */
const CF_STRONG = "@cf/openai/gpt-oss-120b";
const CF_FAST = "@cf/openai/gpt-oss-20b";
const CF_FALLBACK = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const CLOUDFLARE_HINT = "Cloudflare Workers AI: the token was rejected. Create a Cloudflare API token with \"Workers AI: Read\" for this account and save it as CLOUDFLARE_AI_TOKEN.";
export const CLOUDFLARE_QUOTA_HINT = "Cloudflare Workers AI: today's free 10,000 neurons are used up; it comes back at 00:00 UTC (01:00 WAT).";

type CandidateTable = Partial<Record<Exclude<AgentProvider, "custom">, () => string[]>>;

/** Models tried in order per provider (the "strong" tier). The first one the account can use wins and is remembered. */
const MODEL_CANDIDATES: CandidateTable = {
  cloudflare: () => [...env("CLOUDFLARE_AGENT_MODEL"), CF_STRONG, CF_FALLBACK, CF_FAST],
  gemini: () => [...env("GEMINI_AGENT_MODEL"), ...GEMINI_MODELS],
  // Each Groq model has its own free-tier rate limit, so the smaller ones are real fallbacks for a rate-limited 120b.
  groq: () => [...env("GROQ_AGENT_MODEL"), "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905", "moonshotai/kimi-k2-instruct", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "qwen/qwen3-32b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  cerebras: () => [...env("CEREBRAS_AGENT_MODEL"), "gpt-oss-120b", "qwen-3.8-27b", "qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "qwen-3-32b", "llama3.1-8b"],
  github: () => [...env("GITHUB_AGENT_MODEL"), "openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  openrouter: () => [...env("OPENROUTER_AGENT_MODEL"), "openai/gpt-oss-120b:free", "deepseek/deepseek-chat-v3.1:free", "meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-235b-a22b:free", "mistralai/mistral-small-3.2-24b-instruct:free"],
  mistral: () => [...env("MISTRAL_AGENT_MODEL"), "mistral-medium-latest", "mistral-small-latest", "open-mistral-nemo", "mistral-large-latest"],
  huggingface: () => [...env("HF_AGENT_MODEL"), ...env("HF_CHAT_MODEL"), DEFAULT_HF_CHAT_MODEL],
  qwen: () => [...env("QWEN_AGENT_MODEL"), "qwen-plus", "qwen-turbo"],
};

/** Small, quick models for plain chat. Providers missing here use their normal list. */
const FAST_CANDIDATES: CandidateTable = {
  cloudflare: () => [...env("CLOUDFLARE_FAST_MODEL"), CF_FAST, CF_FALLBACK, CF_STRONG],
  groq: () => [...env("GROQ_FAST_MODEL"), "openai/gpt-oss-20b", "llama-3.1-8b-instant", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"],
  cerebras: () => [...env("CEREBRAS_FAST_MODEL"), "llama3.1-8b", "gpt-oss-120b", "qwen-3.8-27b", "llama-3.3-70b"],
  gemini: () => [...env("GEMINI_FAST_MODEL"), ...GEMINI_LITE_FIRST],
  github: () => [...env("GITHUB_FAST_MODEL"), "openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  mistral: () => [...env("MISTRAL_FAST_MODEL"), "mistral-small-latest", "open-mistral-nemo", "mistral-medium-latest"],
};

/** Models that accept OpenAI image_url content parts. Only these providers are used for image turns. */
const VISION_CANDIDATES: CandidateTable = {
  groq: () => [...env("GROQ_VISION_MODEL"), "meta-llama/llama-4-maverick-17b-128e-instruct", "meta-llama/llama-4-scout-17b-16e-instruct"],
  github: () => [...env("GITHUB_VISION_MODEL"), "openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  openrouter: () => [...env("OPENROUTER_VISION_MODEL"), "meta-llama/llama-4-maverick:free", "google/gemma-3-27b-it:free", "qwen/qwen2.5-vl-72b-instruct:free", "mistralai/mistral-small-3.2-24b-instruct:free"],
  gemini: () => [...env("GEMINI_VISION_MODEL"), ...GEMINI_MODELS],
};

const TIER_TABLE: Record<ModelTier, CandidateTable> = { strong: MODEL_CANDIDATES, fast: FAST_CANDIDATES, vision: VISION_CANDIDATES };
const FAST_FIRST: AgentProvider[] = ["cloudflare", "groq", "cerebras", "gemini"];
const VISION_ORDER: AgentProvider[] = ["custom", "groq", "openrouter", "gemini", "github"];

const VISION_GUESS = /vision|-vl\b|\bvl-|llama-4|maverick|scout|gemma-3|pixtral|gpt-4o|gpt-4\.1|gpt-5|gemini|llava|qwen2\.5-vl|qwen3-vl|phi-4-multimodal/i;
/** Discovered ids that are not chat models (speech, guards, embeddings, images, realtime...). */
const NOT_CHAT = /whisper|tts|embed|guard|safeguard|orpheus|allam|audio|image|banana|imagen|veo|lyria|ocr|moderation|rerank|live|realtime|livetranslate|asr|omni|deep-research|codestral|voxtral|leanstral|vibe-cli|fim|:batch|preview/i;

/**
 * GitHub Models was retired on 2026-07-30: models.github.ai now answers every request with a
 * 200 text/plain "OK". It stays out of the default order; ELIAS_GITHUB_MODELS=1 opts back in.
 */
const RETIRED: AgentProvider[] = ["github"];
const DEFAULT_ORDER = "custom,cloudflare,groq,gemini,cerebras,openrouter,mistral,huggingface,qwen";

/** Output cap for one reply. Free tiers count prompt + max_tokens against small per-minute budgets. */
const MAX_TOKENS = () => Math.max(256, Number(process.env.ELIAS_MAX_TOKENS) || 2048);
const MIN_OUTPUT_TOKENS = 512;
/** A rate-limit wait this short is worth sitting through once instead of skipping the model. */
const MAX_RETRY_WAIT_MS = 10_000;
const ACCOUNT_COOLDOWN_MS = 60 * 60_000;
const BUSY_COOLDOWN_MS = 5 * 60_000;

/**
 * Free-tier tokens-per-minute for one request (prompt + max_tokens), per Groq model.
 * Override all of them with GROQ_TPM_BUDGET. Providers not listed have room to spare.
 */
const GROQ_TPM: Record<string, number> = {
  "openai/gpt-oss-120b": 8_000,
  "openai/gpt-oss-20b": 8_000,
  "moonshotai/kimi-k2-instruct": 10_000,
  "moonshotai/kimi-k2-instruct-0905": 10_000,
  "qwen/qwen3-32b": 6_000,
  "qwen/qwen3.8-27b": 6_000,
  "llama-3.1-8b-instant": 6_000,
  "llama-3.3-70b-versatile": 12_000,
  "meta-llama/llama-4-maverick-17b-128e-instruct": 6_000,
  "meta-llama/llama-4-scout-17b-16e-instruct": 30_000,
};

export function tokenBudget(provider: AgentProvider, model: string): number | null {
  if (provider === "groq") return Number(process.env.GROQ_TPM_BUDGET) || GROQ_TPM[model] || 6_000;
  if (provider === "cerebras") return Number(process.env.CEREBRAS_TPM_BUDGET) || 60_000;
  // Workers AI bills neurons per token from a 10k/day free pool, so keep each request lean.
  if (provider === "cloudflare") return Number(process.env.CLOUDFLARE_TOKEN_BUDGET) || 32_000;
  if (provider === "openrouter" || provider === "mistral" || provider === "huggingface") return 32_000;
  return null;
}

const workingModel = new Map<string, string>();
const deadModels = new Set<string>();
const providerCooldown = new Map<string, { until: number; reason: string }>();
const modelCooldown = new Map<string, number>();
const discovered = new Map<string, Promise<Set<string> | null>>();

type ErrorKind = "model" | "account" | "busy" | "other";

export class ProviderError extends Error {
  /**
   * model: this model can't be used (skip it for good). account: the key is out of quota/credits/invalid (cool the provider down).
   * busy: overloaded, rate-limited or too large right now (try the next model). reason: a few words for the user-facing summary.
   */
  constructor(message: string, readonly kind: ErrorKind, readonly reason = "error", readonly retryAfterMs?: number, readonly suggested?: string, readonly cooldownMs?: number) { super(message); }
}

/** Every provider failed. message is the friendly sentence plus a short per-provider summary; raw keeps the full dump for logs. */
export class AllProvidersFailedError extends Error {
  constructor(readonly summary: Array<{ provider: string; reason: string; hint?: string }>, readonly raw: string) {
    super(friendlyFailure(summary));
  }
}

export const FRIENDLY_FAILURE = "All my AI providers are busy or out of free quota, try again in a minute.";

export function friendlyFailure(summary: Array<{ provider: string; reason: string }>) {
  const details = summary.map((item) => `${item.provider}: ${item.reason}`).join("; ");
  return details ? `${FRIENDLY_FAILURE} Details: ${details}` : FRIENDLY_FAILURE;
}

export function classify(status: number, body: string): ErrorKind {
  const text = body.toLowerCase();
  // OpenRouter's "requires more credits, or fewer max_tokens": this request is too big for the free balance; skip, don't kill.
  if (status === 402 && /fewer max_tokens|can only afford/.test(text)) return "busy";
  // OpenRouter answers 402 for one paid/image-output model while its free models still work: skip just that model.
  if (status === 402 && /requires at least|image or video output|paid model/.test(text)) return "model";
  if (status === 401 || status === 402 || /no remaining credits|insufficient|quota|billing|invalid api key|unauthorized|payment required|freetieronly/.test(text)) return "account";
  if (status === 429 || status === 503 || status === 529 || /high demand|overloaded|temporarily unavailable|"unavailable"|rate limit/.test(text)) return "busy";
  if (status === 404 || status === 410 || /model_not_found|does not exist|no longer available|not available in your subscription|tier_not_allowed|decommissioned|unknown model|invalid model|not a valid model|no endpoints found/.test(text)) return "model";
  if ((status === 400 || status === 403) && /model/.test(text)) return "model";
  return "other";
}

function reasonFor(status: number, body: string, kind: ErrorKind) {
  const text = body.toLowerCase();
  if (kind === "account") return status === 401 || /invalid api key|unauthorized/.test(text) ? "key rejected" : "out of free quota";
  if (kind === "busy") return status === 402 ? "request too large for free credits" : /tokens per minute|tpm|request too large/.test(text) ? "rate limited (tokens per minute)" : status === 429 ? "rate limited" : "busy";
  if (kind === "model") return "model unavailable";
  return `HTTP ${status}`;
}

/** Seconds to wait from a retry-after header or a body like "Please try again in 7.5s" / "in 1m2s". */
export function retryAfterMs(headers: Headers | undefined, body: string): number | undefined {
  const header = headers?.get("retry-after");
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.round(Number(header) * 1000);
  const match = body.match(/try again in\s+(?:(\d+)m(?!s))?\s*(\d+(?:\.\d+)?)?\s*(ms|s)?/i);
  if (match && (match[1] || match[2])) {
    const minutes = Number(match[1] || 0);
    const value = Number(match[2] || 0);
    return Math.round(minutes * 60_000 + (match[3] === "ms" ? value : value * 1000));
  }
  return undefined;
}

/** "use models/gemini-3.8-flash" in a 404 body: the model the provider wants us on instead. */
function suggestedModel(body: string) {
  return body.match(/use (?:models\/)?([a-z0-9][\w.\-:/]*[a-z0-9])/i)?.[1];
}

/** Milliseconds until the next 00:00 UTC, when Workers AI's daily free neurons reset. */
export function msUntilUtcMidnight(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}

/** Workers AI errors (developers.cloudflare.com/workers-ai/platform/errors), or null to use the generic rules. */
export function cloudflareError(model: string, status: number, body: string, headers?: Headers): ProviderError | null {
  const text = body.toLowerCase();
  const message = `cloudflare/${model} HTTP ${status}: ${body.slice(0, 300)}`;
  // 3036: the daily free allocation of 10,000 neurons is used up. Rest until it resets at 00:00 UTC.
  if (/neurons|daily free allocation|"code":\s*3036/.test(text)) return new ProviderError(message, "account", "daily free neurons used up", undefined, undefined, msUntilUtcMidnight());
  // 3040: out of capacity for this model right now. Try the next model.
  if (status === 429 && /capacity|"code":\s*3040/.test(text)) return new ProviderError(message, "busy", "out of capacity", retryAfterMs(headers, body));
  // Any other 429: rest the provider for what it asks, or an hour.
  if (status === 429) return new ProviderError(message, "account", "rate limited", undefined, undefined, retryAfterMs(headers, body) || ACCOUNT_COOLDOWN_MS);
  // Paid-only, private, or terms-gated models: skip just that model.
  if (status === 403 && /paid plan|not allowed to access this model|model terms|"code":\s*(5035|5018|3041|5016)/.test(text)) return new ProviderError(message, "model", "model needs a paid plan or access");
  // 401/403 otherwise (code 10000 "Authentication error"): the token lacks Workers AI permission.
  if (status === 401 || status === 403) return new ProviderError(message, "account", /blocked|3023/.test(text) ? "account blocked" : "token lacks Workers AI permission");
  if (status === 413) return new ProviderError(message, "busy", "request too large");
  if ((status === 400 || status === 404) && /no such model|invalid model|model name is invalid|"code":\s*(5007|3042)/.test(text)) return new ProviderError(message, "model", "model unavailable");
  return null;
}

/** A sentence telling the owner what fixes a provider's failure, when there is one. */
export function providerHint(provider: string, reason: string): string | undefined {
  if (provider !== "cloudflare") return undefined;
  if (/permission|blocked|key rejected/.test(reason)) return CLOUDFLARE_HINT;
  if (/neurons/.test(reason)) return CLOUDFLARE_QUOTA_HINT;
  return undefined;
}

function httpError(provider: AgentProvider, model: string, status: number, body: string, headers?: Headers) {
  if (provider === "cloudflare") { const error = cloudflareError(model, status, body, headers); if (error) return error; }
  const kind = classify(status, body);
  return new ProviderError(`${provider}/${model} HTTP ${status}: ${body.slice(0, 300)}`, kind, reasonFor(status, body, kind), kind === "busy" ? retryAfterMs(headers, body) : undefined, kind === "model" ? suggestedModel(body) : undefined);
}

/** A 200 that isn't JSON (GitHub Models' retired endpoint answers "OK"): the endpoint is gone, not busy. */
function nonJson(provider: AgentProvider, model: string, text: string) {
  return new ProviderError(`${provider}/${model} returned non-JSON: ${text.slice(0, 80)}`, "account", "endpoint returned no JSON (retired?)");
}

async function availableModels(provider: AgentProvider, baseUrl: string, key: string) {
  if (!discovered.has(provider)) {
    // Workers AI has no /v1/models; its model search lists names under result[].
    const url = provider === "cloudflare" ? `${baseUrl.replace(/\/v1$/, "")}/models/search?task=Text%20Generation&per_page=200` : `${baseUrl}/models`;
    discovered.set(provider, fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }>; result?: Array<{ name?: string }> };
        const ids = [...(data.data || []).map((item) => item.id || ""), ...(data.models || []).map((item) => item.name || ""), ...(Array.isArray(data.result) ? data.result : []).map((item) => item.name || "")].map((id) => id.replace(/^models\//, "")).filter(Boolean);
        return new Set(ids);
      })
      .catch(() => null));
  }
  return discovered.get(provider)!;
}

/** Gemini flash models from discovery, newest first. Strong/vision prefer full flash; fast prefers flash-lite. 2.x goes last (closed to new keys). */
export function rankGemini(available: Iterable<string>, tier: ModelTier) {
  const version = (id: string) => Number(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
  const ids = [...available].filter((id) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(id));
  const flash = ids.filter((id) => !id.endsWith("-lite")).sort((a, b) => version(b) - version(a));
  const lite = ids.filter((id) => id.endsWith("-lite")).sort((a, b) => version(b) - version(a));
  const aliases = [...available].filter((id) => id === "gemini-flash-latest" || id === "gemini-flash-lite-latest");
  const ordered = tier === "fast" ? [...lite, ...flash] : [...flash, ...lite];
  const modern = ordered.filter((id) => version(id) >= 3);
  const legacy = ordered.filter((id) => version(id) < 3);
  return [...new Set([...modern, ...aliases, ...legacy])];
}

/** OpenAI-compatible base URL and key for a provider. */
function configFor(provider: AgentProvider): { baseUrl: string; key: string } {
  if (provider === "custom") { const custom = customConfig(); return { baseUrl: custom?.baseUrl || "", key: custom?.key || "" }; }
  if (provider === "gemini") return { baseUrl: GEMINI_BASE_URL, key: process.env.GEMINI_API_KEY || "" };
  if (provider === "cloudflare") { const cf = cloudflareConfig(); return { baseUrl: cf?.baseUrl || "", key: cf?.key || "" }; }
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

/** Narrows the candidate list to what the account's /models offers, filling in newer discovered chat models. */
function withDiscovery(provider: AgentProvider, route: ModelRoute, candidates: string[], available: Set<string>, pinned: string | null) {
  const free = (id: string) => provider !== "openrouter" || id.endsWith(":free");
  if (provider === "gemini") {
    const envFirst = candidates.filter((model) => model === pinned || (available.has(model) && env(route.tier === "fast" ? "GEMINI_FAST_MODEL" : route.tier === "vision" ? "GEMINI_VISION_MODEL" : "GEMINI_AGENT_MODEL").includes(model)));
    const known = workingModel.get(`${route.tier}:${provider}`);
    const ranked = rankGemini(available, route.tier);
    return [...new Set([...envFirst, ...(known && ranked.includes(known) ? [known] : []), ...ranked])].filter((model) => model === pinned || !deadModels.has(`${provider}/${model}`));
  }
  const usable = candidates.filter((model) => model === pinned || (available.has(model) && free(model)));
  // Workers AI's catalogue is mostly models without tool calling: keep to our list (listed ones first), never add extras.
  if (provider === "cloudflare") return [...usable, ...candidates.filter((model) => !usable.includes(model))];
  if (route.tier === "vision") {
    if (usable.length) return usable;
    // None of the known vision ids are offered: try what discovery lists that looks multimodal.
    const looks = [...available].filter((id) => VISION_GUESS.test(id) && !NOT_CHAT.test(id) && free(id));
    if (!looks.length) throw new ProviderError(`${provider}: no vision model available on this account`, "model", "no vision model");
    return looks.slice(0, 3);
  }
  // Discovered chat models we don't list yet (e.g. a new Groq model, OpenRouter's current :free set) as fallbacks.
  const extras = [...available].filter((id) => !usable.includes(id) && !NOT_CHAT.test(id) && free(id) && !deadModels.has(`${provider}/${id}`)).slice(0, usable.length ? 2 : 3);
  return [...usable, ...extras];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one call against a provider, walking its model list past models the account can't use or that are rate-limited. */
async function withModels(provider: AgentProvider, route: ModelRoute, run: (model: string) => Promise<LlmResult>): Promise<LlmResult> {
  const cooldown = providerCooldown.get(provider);
  if (cooldown && cooldown.until > Date.now()) throw new ProviderError(`${provider}: skipped (${cooldown.reason}, cooling down)`, "account", `${cooldown.reason} (cooling down)`);
  let candidates = candidatesFor(provider, route);
  const pinned = route.provider === provider && route.model ? route.model : null;
  if (provider !== "custom") {
    const config = configFor(provider);
    const available = await availableModels(provider, config.baseUrl, config.key);
    if (available?.size) candidates = withDiscovery(provider, route, candidates, available, pinned);
  }
  candidates = candidates.filter((model) => model === pinned || (modelCooldown.get(`${provider}/${model}`) || 0) <= Date.now());
  if (!candidates.length) throw new ProviderError(`${provider}: every model is rate-limited right now`, "busy", "rate limited");
  const tried = new Set<string>();
  const errors: ProviderError[] = [];
  let lastError: unknown = new Error(`${provider}: no usable model`);
  let attempts = 0;
  while (candidates.length && attempts < 5) {
    const model = candidates.shift()!;
    if (tried.has(model)) continue;
    tried.add(model);
    attempts += 1;
    for (let retry = 0; ; retry += 1) {
      try {
        const result = await run(model);
        if (model !== pinned) workingModel.set(`${route.tier}:${provider}`, model);
        return result;
      } catch (error) {
        lastError = error;
        if (!(error instanceof ProviderError)) throw error;
        if (error.kind === "busy" && retry === 0 && error.retryAfterMs !== undefined && error.retryAfterMs <= MAX_RETRY_WAIT_MS) { await sleep(error.retryAfterMs); continue; }
        errors.push(error);
        if (error.kind === "model") {
          deadModels.add(`${provider}/${model}`);
          if (error.suggested && !tried.has(error.suggested)) candidates.unshift(error.suggested);
        } else if (error.kind === "busy") {
          if (error.retryAfterMs) modelCooldown.set(`${provider}/${model}`, Date.now() + Math.min(error.retryAfterMs, ACCOUNT_COOLDOWN_MS));
        } else if (error.kind === "account") {
          providerCooldown.set(provider, { until: Date.now() + (error.cooldownMs || ACCOUNT_COOLDOWN_MS), reason: error.reason });
          throw error;
        } else throw error;
        break;
      }
    }
  }
  const reasons = [...new Set(errors.map((error) => error.reason))];
  if (errors.length && errors.every((error) => error.kind === "busy" && error.reason.startsWith("rate limited"))) {
    // Every model is rate-limited: rest the provider for the longest wait it named (or a few minutes) instead of retrying each turn.
    const wait = Math.max(...errors.map((error) => error.retryAfterMs || 0));
    providerCooldown.set(provider, { until: Date.now() + Math.min(wait || BUSY_COOLDOWN_MS, ACCOUNT_COOLDOWN_MS), reason: "rate limited" });
  }
  if (errors.length) throw new ProviderError(errors.map((error) => error.message).join(" | "), errors.every((error) => error.kind === "model") ? "model" : "busy", reasons.join(", "));
  throw lastError;
}

/** Providers tried in order for the tool-calling agent. Override with ELIAS_AGENT_PROVIDERS=groq,huggingface. */
export function agentProviders(): AgentProvider[] {
  const order = (process.env.ELIAS_AGENT_PROVIDERS || DEFAULT_ORDER).split(",").map((item) => item.trim());
  // Gemini sits right after Groq whenever its key is set, even with an older custom order.
  if (process.env.GEMINI_API_KEY && !order.includes("gemini")) order.splice(order.includes("groq") ? order.indexOf("groq") + 1 : 0, 0, "gemini");
  // Cloudflare Workers AI goes first (after an explicit custom endpoint) whenever it is configured, even with an older custom order.
  if (cloudflareConfig() && !order.includes("cloudflare")) order.splice(order.includes("custom") ? order.indexOf("custom") + 1 : 0, 0, "cloudflare");
  const optIn = process.env.ELIAS_GITHUB_MODELS === "1";
  if (optIn && !order.includes("github")) order.push("github");
  const retired = optIn ? [] : RETIRED;
  return [...new Set(order)].filter((name): name is AgentProvider => !retired.includes(name as AgentProvider) && (name === "custom" ? Boolean(customConfig()) : Boolean(MODEL_CANDIDATES[name as Exclude<AgentProvider, "custom">] && configFor(name as AgentProvider).key)));
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

/** Providers resting right now and why, with a fix hint where there is one (owner health check). */
export function providerCooldowns() {
  const now = Date.now();
  return [...providerCooldown].filter(([, value]) => value.until > now).map(([provider, value]) => ({ provider, reason: value.reason, until: new Date(value.until).toISOString(), ...(providerHint(provider, value.reason) ? { hint: providerHint(provider, value.reason) } : {}) }));
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
      if (available?.size) {
        const usable = provider === "gemini" ? rankGemini(available, "strong") : ids.filter((id) => available.has(id) && (provider !== "openrouter" || id.endsWith(":free")));
        if (usable.length) models = usable;
      }
    }
    models = models.filter((id) => !deadModels.has(`${provider}/${id}`));
    return { provider, models: models.map((id) => ({ id, vision: provider !== "custom" && (visionIds.has(id) || (provider === "gemini" && /^gemini-/.test(id))) })) };
  }));
}

/** Rough token count: ~3.5 characters per token for English and JSON, plus per-message overhead; images count flat. */
export function estimateTokens(messages: LlmMessage[], tools: ToolSchema[] = []) {
  let chars = tools.length ? JSON.stringify(tools).length : 0;
  let images = 0;
  for (const message of messages) {
    chars += 16;
    if (typeof message.content === "string") chars += message.content.length;
    else if (Array.isArray(message.content)) for (const part of message.content) { if (part.type === "text") chars += part.text.length; else images += 1; }
    if (message.role === "assistant" && message.tool_calls) chars += JSON.stringify(message.tool_calls).length;
  }
  return Math.ceil(chars / 3.5) + images * 1_100;
}

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 40))}\n…[trimmed to fit the model's limit]`;
}

/** Tool schemas with descriptions cut to one short sentence and parameter descriptions dropped. */
export function compactTools(tools: ToolSchema[]): ToolSchema[] {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "description" && key !== "examples").map(([key, item]) => [key, strip(item)]));
    return value;
  };
  return tools.map((tool) => ({ type: "function", function: { name: tool.function.name, description: (tool.function.description.split(/(?<=\.)\s/)[0] || "").slice(0, 140), parameters: strip(tool.function.parameters) as Record<string, unknown> } }));
}

/**
 * Shapes one request to fit a per-request token budget (prompt + max_tokens): trims long old messages,
 * drops the oldest history, compacts tool schemas, then clips the system prompt. Returns null when even
 * the trimmed request can't fit, so the caller moves to a model with more room.
 */
export function fitRequest(messages: LlmMessage[], tools: ToolSchema[], budget: number | null, maxTokens = MAX_TOKENS()): { messages: LlmMessage[]; tools: ToolSchema[]; maxTokens: number } | null {
  if (!budget) return { messages, tools, maxTokens };
  const target = Math.floor(budget * 0.9);
  let list = messages.slice();
  let schemas = tools;
  const fits = () => estimateTokens(list, schemas) + Math.min(maxTokens, 1_024) <= target;
  const done = () => ({ messages: list, tools: schemas, maxTokens: Math.max(MIN_OUTPUT_TOKENS, Math.min(maxTokens, target - estimateTokens(list, schemas))) });
  if (fits()) return done();
  // The current turn starts at the last real user message; everything after it is this turn's tool loop.
  const lastUser = list.map((message, index) => message.role === "user" && !(typeof message.content === "string" && message.content.startsWith("[system]")) ? index : -1).filter((index) => index >= 0).pop() ?? list.length - 1;
  const firstHistory = list[0]?.role === "system" ? 1 : 0;
  // 1. Long old history and tool outputs get clipped.
  list = list.map((message, index) => {
    if (message.role === "tool") return { ...message, content: clip(message.content, 3_000) };
    if (index >= firstHistory && index < lastUser && typeof message.content === "string" && (message.role === "user" || message.role === "assistant")) return { ...message, content: clip(message.content, 1_200) } as LlmMessage;
    return message;
  });
  if (fits()) return done();
  // 2. Oldest history goes first, one message at a time.
  let cut = lastUser;
  while (!fits() && cut > firstHistory) { list.splice(firstHistory, 1); cut -= 1; }
  if (fits()) return done();
  // 3. Shorter tool schemas.
  if (schemas.length) { schemas = compactTools(schemas); if (fits()) return done(); }
  // 4. This turn's tool outputs, harder.
  list = list.map((message) => message.role === "tool" ? { ...message, content: clip(message.content, 800) } : message);
  if (fits()) return done();
  // 5. The system prompt (memories and context sit at its end), keeping at least its opening.
  if (list[0]?.role === "system") {
    const system = list[0].content;
    const spare = (target - Math.min(maxTokens, 1_024) - estimateTokens(list.slice(1), schemas)) * 3.5;
    const keep = Math.max(1_500, Math.floor(spare) - 64);
    if (keep < system.length) list[0] = { role: "system", content: clip(system, keep) };
  }
  if (estimateTokens(list, schemas) + MIN_OUTPUT_TOKENS <= target) return done();
  return null;
}

function prepare(provider: AgentProvider, model: string, messages: LlmMessage[], tools: ToolSchema[]) {
  const fitted = fitRequest(messages, tools, tokenBudget(provider, model));
  if (!fitted) throw new ProviderError(`${provider}/${model}: request too large for its free-tier limit (~${estimateTokens(messages, tools)} tokens)`, "busy", "request too large");
  return fitted;
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
  const fitted = prepare(provider, model, messages, tools);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model, messages: fitted.messages, temperature, max_tokens: fitted.maxTokens, ...(fitted.tools.length ? { tools: fitted.tools, tool_choice: "auto" } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok) throw httpError(provider, model, response.status, raw, response.headers);
  let data: { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
  try { data = JSON.parse(raw); } catch { throw nonJson(provider, model, raw); }
  const message = data.choices?.[0]?.message;
  if (!message) throw new ProviderError(`${provider}/${model} returned no message.`, "busy", "empty reply");
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
  const fitted = prepare(provider, model, messages, tools);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ model, messages: fitted.messages, temperature, stream: true, max_tokens: fitted.maxTokens, ...(fitted.tools.length ? { tools: fitted.tools, tool_choice: "auto" } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) { const body = await response.text(); throw httpError(provider, model, response.status, body, response.headers); }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("event-stream") || !response.body) {
    // Provider ignored stream:true; treat it as a normal completion.
    const text = await response.text();
    let data: { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> };
    try { data = JSON.parse(text); } catch { throw nonJson(provider, model, text); }
    const message = data.choices?.[0]?.message;
    if (!message) throw new ProviderError(`${provider}/${model} returned no message.`, "busy", "empty reply");
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

function summarize(failures: Array<{ provider: AgentProvider; error: unknown }>) {
  const byProvider = new Map<string, string[]>();
  for (const { provider, error } of failures) {
    const reason = error instanceof ProviderError ? error.reason : "error";
    const list = byProvider.get(provider) || [];
    for (const part of reason.split(", ")) if (!list.includes(part)) list.push(part);
    byProvider.set(provider, list);
  }
  return [...byProvider].map(([provider, reasons]) => { const reason = reasons.join(", "); const hint = providerHint(provider, reason); return hint ? { provider, reason, hint } : { provider, reason }; });
}

function allFailed(failures: Array<{ provider: AgentProvider; error: unknown }>) {
  const raw = failures.map(({ error }) => error instanceof Error ? error.message : String(error)).join(" | ").slice(0, 4000);
  console.warn(`[llm] all providers failed: ${raw}`);
  return new AllProvidersFailedError(summarize(failures), raw);
}

/**
 * Same as complete() but streams visible reply text through onDelta. Falls back to the next
 * provider only when nothing has been streamed yet, so the user never sees two half-answers.
 */
export async function completeStream(messages: LlmMessage[], tools: ToolSchema[], onDelta: (text: string) => void, options: { temperature?: number; route?: ModelRoute; only?: boolean } = {}): Promise<LlmResult> {
  const route = options.route || { tier: "strong" };
  // only: just the pinned provider (the owner health check's ?agent=1&provider=X).
  const providers = options.only && route.provider ? providersFor(route).filter((name) => name === route.provider) : providersFor(route);
  if (!providers.length && route.tier === "vision") throw new Error("No vision-capable model is configured. Set GROQ_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY.");
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or HF_TOKEN.");
  const failures: Array<{ provider: AgentProvider; error: unknown }> = [];
  for (const provider of providers) {
    let streamed = false;
    try { return await withModels(provider, route, (model) => streamProvider(provider, messages, tools, options.temperature ?? 0.3, (text) => { streamed = true; onDelta(text); }, model)); }
    catch (error) {
      if (streamed) throw error;
      if (error instanceof ProviderError && error.kind !== "other") { failures.push({ provider, error }); continue; }
      if (!(error instanceof ProviderError)) failures.push({ provider, error });
    }
    // Some providers reject stream+tools; the same provider without streaming is the next best thing.
    try {
      const result = await withModels(provider, route, (model) => callProvider(provider, messages, tools, options.temperature ?? 0.3, model));
      if (!result.toolCalls.length && result.content) onDelta(result.content);
      return result;
    } catch (error) { failures.push({ provider, error }); }
  }
  throw allFailed(failures);
}

export async function complete(messages: LlmMessage[], tools: ToolSchema[] = [], options: { temperature?: number; preferred?: AgentProvider; route?: ModelRoute; only?: boolean } = {}): Promise<LlmResult> {
  const route = options.route || { tier: "strong" };
  // only: try just the pinned provider (the owner health check uses this to test one provider directly).
  const providers = options.only && route.provider ? providersFor(route).filter((name) => name === route.provider) : providersFor(route);
  if (options.preferred && providers.includes(options.preferred)) providers.unshift(...providers.splice(providers.indexOf(options.preferred), 1));
  if (!providers.length) throw new Error("No tool-capable model provider is configured. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or HF_TOKEN.");
  const failures: Array<{ provider: AgentProvider; error: unknown }> = [];
  for (const provider of providers) {
    try { return await withModels(provider, route, (model) => callProvider(provider, messages, tools, options.temperature ?? 0.3, model)); }
    catch (error) { failures.push({ provider, error }); }
  }
  throw allFailed(failures);
}
