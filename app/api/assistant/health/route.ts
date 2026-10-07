import { NextResponse } from "next/server";
import { agentProviders, complete, discoveredModels, type ContentPart, type LlmMessage, type ModelTier } from "@/lib/assistant/llm";

export const dynamic = "force-dynamic";

// 32x32 solid red PNG, used by ?tier=vision to check that a vision model really reads image parts.
const TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4IydHU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJI2YD1ZaHIvAAAAAElFTkSuQmCC";

/**
 * Owner-only model check: which provider/model answers right now. Bearer ELIAS_HEALTH_TOKEN.
 * Optional: ?provider=gemini (try only that provider), ?model=<id> (pin a model), ?tier=fast|strong|vision,
 * ?discover=1 (list each provider's /models ids instead of calling a model).
 */
export async function GET(request: Request) {
  const token = process.env.ELIAS_HEALTH_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const providers = agentProviders();
  const params = new URL(request.url).searchParams;
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
    return NextResponse.json({ ok: true, providers, tier, provider: result.provider, model: result.model, reply: result.content.slice(0, 40) });
  } catch (error) {
    return NextResponse.json({ ok: false, providers, tier, error: error instanceof Error ? error.message.slice(0, 1500) : String(error) }, { status: 502 });
  }
}
