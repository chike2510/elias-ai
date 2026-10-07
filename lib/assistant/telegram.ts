import { randomInt, timingSafeEqual } from "node:crypto";
import { ready } from "@/lib/assistant/db";
import { runTurn } from "@/lib/assistant/agent";
import { getGitHubConnection } from "@/lib/githubConnectionStore";

/**
 * Telegram: a second way to talk to Elias.
 * The owner creates a bot with @BotFather (free), sets TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET, and registers
 * the webhook (POST /api/telegram/setup). A user links their chat by sending the one-time code shown on the You page.
 */
export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
}

export function validWebhookSecret(header: string | null) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A fresh 8-character code valid for 15 minutes; older codes for this user are removed. */
export async function createLinkCode(userId: string) {
  const db = await ready();
  const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  await db`delete from public.elias_telegram_codes where user_id = ${userId} or expires_at < now()`;
  const expires = new Date(Date.now() + 15 * 60_000);
  await db`insert into public.elias_telegram_codes (code, user_id, expires_at) values (${code}, ${userId}, ${expires})`;
  return { code, expiresAt: expires.toISOString() };
}

export async function telegramLinkFor(userId: string) {
  const db = await ready();
  const rows = await db`select chat_id, username, linked_at from public.elias_telegram_links where user_id = ${userId} order by linked_at desc limit 1`;
  return rows[0] ? { chatId: String(rows[0].chat_id), username: (rows[0].username as string) || null, linkedAt: new Date(rows[0].linked_at as string).toISOString() } : null;
}

export async function unlinkTelegram(userId: string) {
  const db = await ready();
  const rows = await db`delete from public.elias_telegram_links where user_id = ${userId} returning chat_id`;
  return rows.length;
}

/** Consumes a code (single use) and ties the chat to its user. */
export async function linkChat(code: string, chatId: string, username: string | null) {
  const db = await ready();
  const rows = await db`delete from public.elias_telegram_codes where code = ${code.toUpperCase()} and expires_at > now() returning user_id`;
  if (!rows[0]) return null;
  const userId = String(rows[0].user_id);
  await db`insert into public.elias_telegram_links (chat_id, user_id, username) values (${chatId}, ${userId}, ${username})
    on conflict (chat_id) do update set user_id = excluded.user_id, username = excluded.username, conversation_id = null, linked_at = now()`;
  return userId;
}

export async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  for (let i = 0; i < text.length || i === 0; i += 4000) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 4000) || "…", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

async function typing(chatId: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, action: "typing" }), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

export type TelegramUpdate = { update_id: number; message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: { username?: string; first_name?: string; is_bot?: boolean } } };

declare global { var __eliasTelegramSeen: Set<number> | undefined; }

/** Handles one update. Returns what was done (for tests); replies go out through the Bot API. */
export async function handleTelegramUpdate(update: TelegramUpdate, appUrl: string, send = sendTelegram) {
  const message = update.message;
  if (!message?.text || message.from?.is_bot) return { action: "ignored" } as const;
  globalThis.__eliasTelegramSeen ||= new Set();
  if (globalThis.__eliasTelegramSeen.has(update.update_id)) return { action: "duplicate" } as const;
  globalThis.__eliasTelegramSeen.add(update.update_id);
  if (globalThis.__eliasTelegramSeen.size > 500) globalThis.__eliasTelegramSeen = new Set([...globalThis.__eliasTelegramSeen].slice(-200));

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  if (message.chat.type !== "private") { await send(chatId, "I only work in a private chat with you."); return { action: "not_private" } as const; }
  const db = await ready();

  const link = (await db`select user_id, conversation_id from public.elias_telegram_links where chat_id = ${chatId}`)[0];
  const code = text.match(/^\/(?:start|link)\s+([A-Za-z0-9]{8})\s*$/)?.[1] || (!link ? text.match(/^([A-HJ-NP-Z2-9]{8})$/)?.[1] : undefined);
  if (code) {
    const userId = await linkChat(code, chatId, message.from?.username || null);
    await send(chatId, userId ? "Linked. You can talk to me here now, same memory and tools as the app." : "That code didn't work or has expired. Get a fresh one on the You page in Elias.");
    return { action: userId ? "linked" : "bad_code", userId } as const;
  }
  if (!link) {
    await send(chatId, `Hi! To use Elias here, open ${appUrl}/you, tap "Link Telegram" and send me the code it shows.`);
    return { action: "unlinked" } as const;
  }
  const userId = String(link.user_id);
  if (text === "/unlink") { await unlinkTelegram(userId); await send(chatId, "Unlinked. Link again any time from the You page."); return { action: "unlinked_now" } as const; }
  if (text === "/new") { await db`update public.elias_telegram_links set conversation_id = null where chat_id = ${chatId}`; await send(chatId, "Fresh conversation started."); return { action: "new" } as const; }

  await typing(chatId);
  const settings = (await db`select timezone from public.elias_user_settings where user_id = ${userId}`)[0];
  const githubToken = await getGitHubConnection(userId).then((item) => item?.token).catch(() => undefined);
  const turn = await runTurn({
    userId, conversationId: (link.conversation_id as string) || undefined, title: "Telegram", text: text.replace(/^\/start\s*$/, "Hi"),
    timezone: (settings?.timezone as string) || "Africa/Lagos", githubToken, origin: "chat", channel: "telegram",
    extraContext: "CHANNEL: Telegram. Plain text only (no markdown tables, no cards are shown). Keep it short. Approvals can't be tapped here: tell the user to approve in the app.",
  });
  if (turn.conversationId !== link.conversation_id) await db`update public.elias_telegram_links set conversation_id = ${turn.conversationId} where chat_id = ${chatId}`;
  const approvals = turn.approvals.length ? `\n\nWaiting for your OK in the app: ${appUrl}/` : "";
  const connect = turn.connect.length ? `\n\nConnect it in the app: ${appUrl}/connectors` : "";
  await send(chatId, `${turn.reply}${approvals}${connect}`);
  return { action: "replied", userId, conversationId: turn.conversationId, reply: turn.reply } as const;
}

/** Registers the webhook with Telegram (owner-only route calls this). */
export async function registerWebhook(appUrl: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramConfigured() || !token) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first.");
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `${appUrl}/api/telegram/webhook`, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: true }),
  });
  const data = await response.json() as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description || "setWebhook failed");
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((res) => res.json() as Promise<{ result?: { username?: string } }>).catch(() => ({ result: undefined }));
  return { ok: true, bot: me.result?.username || null, url: `${appUrl}/api/telegram/webhook` };
}
