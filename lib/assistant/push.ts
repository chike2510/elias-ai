import { createHash } from "node:crypto";
import webpush from "web-push";
import { ready } from "@/lib/assistant/db";
import { getNotifyPrefs, type NotifyType } from "@/lib/assistant/userData";
import { captureError } from "@/lib/observability";

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = { title: string; body: string; url: string; tag?: string; type?: NotifyType };
type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };
/** Sends one push. Resolves on success; rejects with an error carrying statusCode on failure. */
export type PushSender = (subscription: PushSubscriptionInput, payload: string) => Promise<unknown>;

declare global {
  var __eliasPushSender: PushSender | undefined;
}

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

const defaultSender: PushSender = (subscription, payload) => webpush.sendNotification(subscription, payload, {
  TTL: 60 * 60 * 12,
  urgency: "normal",
  vapidDetails: { subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey: process.env.VAPID_PUBLIC_KEY || "", privateKey: process.env.VAPID_PRIVATE_KEY || "" },
});

/** Test hook: replace the network sender (pass undefined to restore web-push). */
export function setPushSender(sender: PushSender | undefined) {
  globalThis.__eliasPushSender = sender;
}

function sender(): PushSender | null {
  if (globalThis.__eliasPushSender) return globalThis.__eliasPushSender;
  return pushConfigured() ? defaultSender : null;
}

function subscriptionId(endpoint: string) {
  return `push_${createHash("sha256").update(endpoint).digest("base64url").slice(0, 24)}`;
}

export function validSubscription(input: unknown): input is PushSubscriptionInput {
  const value = input as PushSubscriptionInput | null;
  return Boolean(value && typeof value.endpoint === "string" && /^https:\/\//.test(value.endpoint) && value.endpoint.length < 2000
    && value.keys && typeof value.keys.p256dh === "string" && typeof value.keys.auth === "string" && value.keys.p256dh.length < 200 && value.keys.auth.length < 100);
}

export async function saveSubscription(userId: string, subscription: PushSubscriptionInput, userAgent?: string | null) {
  const db = await ready();
  const id = subscriptionId(subscription.endpoint);
  await db`insert into public.elias_push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
    values (${id}, ${userId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${(userAgent || "").slice(0, 300)})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0`;
  return { id };
}

export async function removeSubscription(userId: string, endpoint: string) {
  const db = await ready();
  const rows = await db`delete from public.elias_push_subscriptions where user_id = ${userId} and endpoint = ${endpoint} returning id`;
  return rows.length > 0;
}

export async function countSubscriptions(userId: string) {
  const db = await ready();
  return Number((await db`select count(*)::int as n from public.elias_push_subscriptions where user_id = ${userId}`)[0]?.n || 0);
}

/**
 * Sends a notification to every device the user subscribed, if they allow this type.
 * Expired subscriptions (404/410) are deleted; other failures are counted and dropped after 5.
 * Never throws: a push failure must not break the job or schedule that triggered it.
 */
export async function notifyUser(userId: string, type: NotifyType, payload: Omit<PushPayload, "type">) {
  const send = sender();
  const outcome = { sent: 0, pruned: 0, failed: 0, skipped: "" as string };
  if (!send) { outcome.skipped = "not_configured"; return outcome; }
  try {
    const prefs = await getNotifyPrefs(userId);
    if (!prefs[type]) { outcome.skipped = "muted"; return outcome; }
    const db = await ready();
    const subscriptions = await db`select id, endpoint, p256dh, auth from public.elias_push_subscriptions where user_id = ${userId}` as unknown as StoredSubscription[];
    if (!subscriptions.length) { outcome.skipped = "no_devices"; return outcome; }
    const body = JSON.stringify({ ...payload, type, title: payload.title.slice(0, 80), body: payload.body.replace(/\s+/g, " ").trim().slice(0, 180) });
    await Promise.all(subscriptions.map(async (item) => {
      try {
        await send({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } }, body);
        outcome.sent += 1;
        await db`update public.elias_push_subscriptions set last_success_at = now(), failures = 0 where id = ${item.id}`;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) {
          outcome.pruned += 1;
          await db`delete from public.elias_push_subscriptions where id = ${item.id}`;
        } else {
          outcome.failed += 1;
          await db`update public.elias_push_subscriptions set failures = failures + 1 where id = ${item.id}`;
          await db`delete from public.elias_push_subscriptions where id = ${item.id} and failures >= 5`;
        }
      }
    }));
  } catch (error) {
    void captureError(error, { area: "push", userId, type });
  }
  return outcome;
}
