import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { countSubscriptions, notifyUser, pushConfigured, removeSubscription, saveSubscription, validSubscription, vapidPublicKey } from "@/lib/assistant/push";
import { getNotifyPrefs, setNotifyPrefs } from "@/lib/assistant/userData";

export const runtime = "nodejs";

/** GET: whether push is set up, the VAPID public key, this user's per-type preferences and device count. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const [prefs, devices] = await Promise.all([getNotifyPrefs(auth.userId), countSubscriptions(auth.userId)]);
    return jsonOk({ configured: pushConfigured(), publicKey: vapidPublicKey(), prefs, devices });
  } catch (error) { return jsonError(reportError(error, "assistant/push", auth.userId)); }
}

/** POST { subscription } saves this device; POST { test: true } sends a test notification to every device. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ subscription?: unknown; test?: boolean }>(request);
    if (body.test) {
      const outcome = await notifyUser(auth.userId, "jobs", { title: "Elias notifications are on", body: "This is how I'll reach you when something's ready.", url: "/you", tag: "test" });
      return jsonOk({ outcome });
    }
    if (!pushConfigured()) return jsonError("Notifications aren't set up on this server yet.", 503, "PUSH_NOT_CONFIGURED");
    if (!validSubscription(body.subscription)) return jsonError("That push subscription isn't valid.", 400, "BAD_REQUEST");
    await saveSubscription(auth.userId, body.subscription, request.headers.get("user-agent"));
    return jsonOk({ subscribed: true, devices: await countSubscriptions(auth.userId) });
  } catch (error) { return jsonError(reportError(error, "assistant/push:subscribe", auth.userId), 400); }
}

/** DELETE { endpoint } removes this device. */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ endpoint?: string }>(request);
    if (!body.endpoint) return jsonError("endpoint is required.", 400, "BAD_REQUEST");
    return jsonOk({ removed: await removeSubscription(auth.userId, body.endpoint), devices: await countSubscriptions(auth.userId) });
  } catch (error) { return jsonError(reportError(error, "assistant/push:unsubscribe", auth.userId), 400); }
}

/** PATCH { prefs: { brief?, reminders?, approvals?, jobs? } } */
export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ prefs?: Record<string, unknown> }>(request);
    return jsonOk({ prefs: await setNotifyPrefs(auth.userId, body.prefs || {}) });
  } catch (error) { return jsonError(reportError(error, "assistant/push:prefs", auth.userId), 400); }
}
