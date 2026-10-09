import { NextResponse } from "next/server";
import { browserProviders, probeBrowser } from "@/lib/assistant/browser";
import { systemPrompt } from "@/lib/assistant/agent";
import { toolSchemasFor } from "@/lib/assistant/tools";
import { AllProvidersFailedError, agentProviders, providerCooldowns, complete, completeStream, discoveredModels, estimateTokens, type ContentPart, type LlmMessage, type ModelTier } from "@/lib/assistant/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 32x32 solid red PNG, used by ?tier=vision to check that a vision model really reads image parts.
const TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4IydHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJI2YD1ZaHIvAAAAAElFTkSuQmCC";

/**
 * Owner-only model check: which provider/model answers right now. Bearer ELIAS_HEALTH_TOKEN.
 * Optional: ?provider=gemini (try only that provider), ?model=<id> (pin a model), ?tier=fast|strong|vision,
 * ?discover=1 (list each provider's /models ids instead of calling a model),
 * ?agent=1 (a real-size chat request: the full system prompt and every chat tool schema, no user data or DB writes),
 * ?browser=1 (open example.com in the remote browser; returns the title and which provider served it).
 */
export async function GET(request: Request) {
  const token = process.env.ELIAS_HEALTH_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const providers = agentProviders();
  const params = new URL(request.url).searchParams;
  if (params.get("browser")) {
    const browsers = browserProviders();
    if (!browsers.length) return NextResponse.json({ ok: false, browsers, error: "No remote browser configured." }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, browsers, ...(await probeBrowser()) });
    } catch (error) {
      return NextResponse.json({ ok: false, browsers, error: error instanceof Error ? error.message.slice(0, 600) : String(error) }, { status: 502 });
    }
  }
  if (params.get("agent")) {
    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt({ name: "Owner", timezone: "Africa/Lagos", memories: "No saved memories yet.", googleEmail: null, googleConfigured: false, browser: false, origin: "chat" }) },
      { role: "user", content: "Health check: in one short sentence, say what you can help me with today." },
    ];
    const tools = toolSchemasFor("chat");
    const started = Date.now();
    try {
      const pinned = params.get("provider") || undefined;
      if (pinned && !providers.includes(pinned as never)) return NextResponse.json({ ok: false, providers, agent: true, error: `${pinned} is not configured on this deployment.` }, { status: 400 });
      const result = await completeStream(messages, tools, () => undefined, { route: { tier: "strong", provider: pinned }, only: Boolean(pinned) });
      return NextResponse.json({ ok: true, providers, agent: true, estimatedTokens: estimateTokens(messages, tools), tools: tools.length, ms: Date.now() - started, provider: result.provider, model: result.model, toolCalls: result.toolCalls.map((call) => call.function.name), reply: result.content.slice(0, 200), cooldowns: providerCooldowns() });
    } catch (error) {
      return NextResponse.json({ ok: false, providers, agent: true, estimatedTokens: estimateTokens(messages, tools), error: error instanceof Error ? error.message.slice(0, 1500) : String(error), ...(error instanceof AllProvidersFailedError ? { summary: error.summary, hints: error.summary.flatMap((item) => item.hint ? [item.hint] : []), raw: error.raw.slice(0, 2500) } : {}), cooldowns: providerCooldowns() }, { status: 502 });
    }
  }
  if (params.get("discover")) return NextResponse.json({ ok: true, providers, models: await discoveredModels() });
  const provider = params.get("provider") || undefined;
  const model = params.get("model") || undefined;
  const tierParam = params.get("tier");
  const tier: ModelTier = tierParam === "fast" || tierParam === "vision" ? tierParam : "strong";
  if (provider && !providers.includes(provider as never)) return NextResponse.json({ ok: false, providers, error: `${provider} is not configured on this deployment.` }, { status: 400 });
  const content: string | ContentPart[] = tier === "vision"
    ? [{ type: "text", text: "What colour is this image? Reply with one word." }, { type: "image_url", image_url: { url: TEST_IMAGE } }]
    : "Reply with the single word: pong";
  const messages: LlmMessage[] = [{ role: "user", content }];
  try {
    const result = await complete(messages, [], { route: { tier, provider, model }, only: Boolean(provider) });
    return NextResponse.json({ ok: true, providers, tier, provider: result.provider, model: result.model, reply: result.content.slice(0, 40), cooldowns: providerCooldowns() });
  } catch (error) {
    // Owner-only: the raw per-model dump rides along for diagnosis; users only ever see the friendly summary.
    return NextResponse.json({ ok: false, providers, tier, error: error instanceof Error ? error.message.slice(0, 1500) : String(error), ...(error instanceof AllProvidersFailedError ? { summary: error.summary, hints: error.summary.flatMap((item) => item.hint ? [item.hint] : []), raw: error.raw.slice(0, 2500) } : {}), cooldowns: providerCooldowns() }, { status: 502 });
  }
}
