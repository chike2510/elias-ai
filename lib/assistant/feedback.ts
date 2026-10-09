import { ready } from "@/lib/assistant/db";

export type MessageFeedback = { rating: "up" | "down"; reason?: string; at: string };

/**
 * Thumbs up/down on one of the user's assistant messages, kept on the message's meta.feedback.
 * rating null clears it. Returns the stored feedback, or undefined when the message isn't theirs.
 */
export async function setMessageFeedback(userId: string, messageId: number, rating: "up" | "down" | null, reason?: string): Promise<MessageFeedback | null | undefined> {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return undefined;
  const db = await ready();
  if (rating === null) {
    const rows = await db`update public.elias_messages set meta = meta - 'feedback' where id = ${messageId} and user_id = ${userId} and role = 'assistant' returning id`;
    return rows[0] ? null : undefined;
  }
  const feedback: MessageFeedback = { rating, at: new Date().toISOString(), ...(reason && reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}) };
  const rows = await db`update public.elias_messages set meta = meta || ${db.json({ feedback } as never)} where id = ${messageId} and user_id = ${userId} and role = 'assistant' returning id`;
  return rows[0] ? feedback : undefined;
}
