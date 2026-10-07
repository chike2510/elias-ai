import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { createLinkCode, telegramConfigured, telegramLinkFor, unlinkTelegram } from "@/lib/assistant/telegram";

export const runtime = "nodejs";

/** GET: link status. POST: a fresh one-time code to send to the bot. DELETE: unlink. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ configured: telegramConfigured(), bot: process.env.TELEGRAM_BOT_USERNAME || null, link: await telegramLinkFor(auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "telegram/link", auth.userId)); }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  if (!telegramConfigured()) return jsonError("Telegram isn't set up on this server yet.", 400, "NOT_CONFIGURED");
  try { return jsonOk({ ...(await createLinkCode(auth.userId)), bot: process.env.TELEGRAM_BOT_USERNAME || null }); }
  catch (error) { return jsonError(reportError(error, "telegram/link", auth.userId)); }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try { return jsonOk({ removed: await unlinkTelegram(auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "telegram/link", auth.userId)); }
}
