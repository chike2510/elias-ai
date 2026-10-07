import { NextResponse } from "next/server";
import { registerWebhook } from "@/lib/assistant/telegram";

export const runtime = "nodejs";

/** Owner-only (Bearer ELIAS_HEALTH_TOKEN): registers this deployment's Telegram webhook with the secret token. */
export async function POST(request: Request) {
  const token = process.env.ELIAS_HEALTH_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await registerWebhook(process.env.ELIAS_APP_URL || new URL(request.url).origin)); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
