import { NextResponse } from "next/server";
import { agentProviders, complete } from "@/lib/assistant/llm";

export const dynamic = "force-dynamic";

/** Owner-only model check: which provider/model answers right now. Bearer ELIAS_HEALTH_TOKEN. */
export async function GET(request: Request) {
  const token = process.env.ELIAS_HEALTH_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const providers = agentProviders();
  try {
    const result = await complete([{ role: "user", content: "Reply with the single word: pong" }]);
    return NextResponse.json({ ok: true, providers, provider: result.provider, model: result.model, reply: result.content.slice(0, 40) });
  } catch (error) {
    return NextResponse.json({ ok: false, providers, error: error instanceof Error ? error.message.slice(0, 1500) : String(error) }, { status: 502 });
  }
}
