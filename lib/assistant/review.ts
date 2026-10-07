import { addMessage, ensureConversation } from "@/lib/assistant/agent";
import { ready } from "@/lib/assistant/db";
import { recentlyLearned } from "@/lib/assistant/memory";
import { createSchedule, validTimezone, type Schedule } from "@/lib/assistant/schedules";
import type { MemoryReviewCard } from "@/lib/assistant/cards";

export const MEMORY_REVIEW_PROMPT = "Weekly memory review: show what I learned about the user this week so they can confirm, edit or forget each item.";

/**
 * Seeds the weekly "Here's what I learned about you" review once per user: Sundays 18:00 in their timezone.
 * Like the daily brief, removing it keeps it removed (the seed marker lives in elias_user_settings.data).
 */
export async function ensureMemoryReview(userId: string, timezone?: string) {
  const tz = timezone && validTimezone(timezone) ? timezone : "Africa/Lagos";
  const db = await ready();
  await db`insert into public.elias_user_settings (user_id, timezone) values (${userId}, ${tz}) on conflict (user_id) do nothing`;
  const claimed = await db`update public.elias_user_settings set data = data || ${db.json({ memoryReviewSeededAt: new Date().toISOString() } as never)}, updated_at = now()
    where user_id = ${userId} and not (data ? 'memoryReviewSeededAt') returning timezone`;
  if (!claimed[0]) return null;
  const zone = (claimed[0].timezone as string) && validTimezone(claimed[0].timezone as string) ? claimed[0].timezone as string : tz;
  try {
    const schedule = await createSchedule(userId, { name: "What I learned this week", prompt: MEMORY_REVIEW_PROMPT, schedule: { type: "weekly", days: [0], time: "18:00" }, timezone: zone });
    await db`update public.elias_schedules set kind = 'memory_review' where id = ${schedule.id}`;
    return { ...schedule, kind: "memory_review" };
  } catch (error) {
    await db`update public.elias_user_settings set data = data - 'memoryReviewSeededAt' where user_id = ${userId}`;
    throw error;
  }
}

/** Builds the review message. No model call: it's the user's own memories, listed for confirm / edit / forget. */
export async function runMemoryReview(schedule: Schedule & { userId: string }) {
  const items = await recentlyLearned(schedule.userId, 7, 12);
  if (!items.length) return { conversationId: schedule.conversationId || "", reply: "Nothing new learned this week.", skipped: true };
  const conversationId = await ensureConversation(schedule.userId, schedule.conversationId || undefined, "What I learned this week", "schedule");
  const card: MemoryReviewCard = { kind: "memory_review", title: "Learned this week", items: items.map((item) => ({ id: item.id, content: item.content, kind: item.kind, entity: item.entity })) };
  const reply = `Here's what I learned about you this week (${items.length} thing${items.length === 1 ? "" : "s"}). Confirm what's right, fix or forget the rest.`;
  await addMessage(schedule.userId, conversationId, "assistant", reply, { cards: [card], kind: "memory_review" });
  return { conversationId, reply };
}
