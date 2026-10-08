/** Cheap follow-up suggestions after a chat reply: one small fast-tier call, capped in time, never fatal. */
import { complete } from "@/lib/assistant/llm";
import { MAX_FOLLOW_UPS, parseFollowUps } from "@/lib/richReply";

const TIMEOUT_MS = 6_000;

export function followUpsEnabled() {
  return process.env.ELIAS_FOLLOWUPS !== "0";
}

export function followUpPrompt(userText: string, reply: string) {
  return `Suggest up to ${MAX_FOLLOW_UPS} short follow-up messages the USER might send next in this chat with their personal assistant Elias.
Rules: write each as the user would type it (first person, under 45 characters), make each one a useful next step that is specific to this exchange, no greetings, no thanks, nothing the reply already answered. If no follow-up is genuinely useful, return [].
Reply with a JSON array of strings only.

User: ${userText.slice(0, 600)}
Elias: ${reply.slice(0, 1200)}`;
}

/** Returns [] on any failure or after the time cap, so the reply is never held up for long. */
export async function suggestFollowUps(userText: string, reply: string): Promise<string[]> {
  if (!followUpsEnabled() || !userText.trim() || !reply.trim()) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string[]>((resolve) => { timer = setTimeout(() => resolve([]), TIMEOUT_MS); });
  const work = complete([{ role: "user", content: followUpPrompt(userText, reply) }], [], { temperature: 0.4, route: { tier: "fast" } })
    .then((result) => parseFollowUps(result.content, [userText]))
    .catch(() => [] as string[]);
  try { return await Promise.race([work, timeout]); } finally { if (timer) clearTimeout(timer); }
}
