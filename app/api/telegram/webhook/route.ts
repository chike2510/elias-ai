import { after, NextResponse } from "next/server";
import { handleTelegramUpdate, telegramConfigured, validWebhookSecret, type TelegramUpdate } from "@/lib/assistant/telegram";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Telegram Bot API webhook. Gated on TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET, and every request must carry
 * X-Telegram-Bot-Api-Secret-Token (set when the webhook was registered). Answers 200 at once, replies after.
 */
export async function POST(request: Request) {
  if (!telegramConfigured()) return NextResponse.json({ error: "telegram not configured" }, { status: 404 });
  if (!validWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let update: TelegramUpdate;
  try { update = await request.json() as TelegramUpdate; } catch { return NextResponse.json({ ok: true }); }
  const appUrl = process.env.ELIAS_APP_URL || new URL(request.url).origin;
  after(async () => {
    try { await handleTelegramUpdate(update, appUrl); }
    catch (error) { void captureError(error, { area: "telegram" }); }
  });
  return NextResponse.json({ ok: true });
}
