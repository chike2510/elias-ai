"use client";

/** Browser side of Web Push: support checks, subscribe/unsubscribe, and the iOS install hint. */
import { api } from "@/lib/chatClient";

export type NotifyPrefs = { brief: boolean; reminders: boolean; approvals: boolean; jobs: boolean };
export type PushInfo = { configured: boolean; publicKey: string | null; prefs: NotifyPrefs; devices: number };
export type PushSupport = "supported" | "unsupported" | "ios-needs-install";

export const PROMPT_DISMISSED_KEY = "elias.push.prompt-dismissed";

export function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-needs-install"; // iOS only allows Web Push for Home Screen apps (16.4+)
  return capable ? "supported" : "unsupported";
}

export function permission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

function keyBytes(base64url: string) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function pushInfo() {
  return api<PushInfo & { ok: true }>("/api/assistant/push");
}

export async function currentSubscription() {
  if (pushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Must run from a tap (browsers require a user gesture for the permission prompt). */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const support = pushSupport();
  if (support === "ios-needs-install") return { ok: false, reason: "On iPhone and iPad, add Elias to your Home Screen first (Share, then Add to Home Screen), then turn notifications on from there." };
  if (support === "unsupported") return { ok: false, reason: "This browser doesn't support notifications." };
  const info = await pushInfo();
  if (!info.configured || !info.publicKey) return { ok: false, reason: "Notifications aren't set up on the server yet." };
  const result = await Notification.requestPermission();
  if (result !== "granted") return { ok: false, reason: result === "denied" ? "Notifications are blocked for Elias. Allow them in your browser's site settings, then try again." : "No problem, you can turn them on any time." };
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) });
  await api("/api/assistant/push", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) });
  return { ok: true };
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api("/api/assistant/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export async function savePrefs(prefs: Partial<NotifyPrefs>) {
  return api<{ prefs: NotifyPrefs }>("/api/assistant/push", { method: "PATCH", body: JSON.stringify({ prefs }) });
}

export async function sendTest() {
  return api<{ outcome: { sent: number; skipped: string } }>("/api/assistant/push", { method: "POST", body: JSON.stringify({ test: true }) });
}
