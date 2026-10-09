import type { GoogleStatus } from "@/lib/chatClient";

export type GoogleRowView = { detail: string; state: "on" | "off" | "warn" | "na"; stateLabel: string; action?: "Connect" | "Reconnect"; href: string; canDisconnect: boolean };

const day = (iso: string, timezone?: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" });

/** What the You and Connectors screens say about Google, from /api/assistant/status. Pure, so it is unit tested. */
export function googleRowView(google: GoogleStatus, returnTo: string, timezone?: string): GoogleRowView {
  const connect = `/api/connect/google?return=${encodeURIComponent(returnTo)}`;
  if (!google.configured) return { detail: "Not configured yet: the server needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", state: "na", stateLabel: "Not set up", href: "/connectors", canDisconnect: false };
  const status = google.status || (google.connected ? "ok" : "none");
  const who = google.email ? ` · ${google.email}` : "";
  if (status === "expired" || status === "revoked") return {
    detail: status === "revoked" ? `Access was removed in your Google account${who}. Reconnect to use Gmail and Calendar.` : `Signed out${who}. Google's testing mode ends access every 7 days; reconnect to keep going.`,
    state: "warn", stateLabel: "Signed out", action: "Reconnect", href: connect, canDisconnect: true,
  };
  if (status === "ok" || google.connected) {
    const scopes = google.drive ? "Gmail, Calendar & Drive" : "Gmail & Calendar";
    if (google.expiresSoon) return { detail: `${scopes}${who} · access ends ${google.renewBy ? day(google.renewBy, timezone) : "soon"}, reconnect to renew`, state: "warn", stateLabel: "Renew", action: "Reconnect", href: connect, canDisconnect: true };
    return { detail: `${scopes}${who}${google.renewBy ? ` · renew by ${day(google.renewBy, timezone)}` : ""}`, state: "on", stateLabel: "On", href: "/connectors", canDisconnect: true };
  }
  return { detail: "Gmail & Calendar. Sending and invites always ask first.", state: "off", stateLabel: "Off", action: "Connect", href: connect, canDisconnect: false };
}

const ERRORS: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled. Nothing changed.",
  google_not_configured: "Google isn't configured on this server yet.",
  google_state_expired_try_again: "That sign-in link expired. Tap Connect again.",
  google_access_denied: "Google sign-in was cancelled. Nothing changed.",
};

/** One line after coming back from Google's consent screen: success, a permission left unticked, or why it failed. */
export function googleReturnMessage(search: string): { tone: "ok" | "warn"; text: string } | null {
  const params = new URLSearchParams(search);
  if (params.get("connected") === "google") {
    const missing = (params.get("missing") || "").split(",").filter(Boolean);
    if (!missing.length) return { tone: "ok", text: "Google connected." };
    const names = missing.map((item) => item === "gmail" ? "Gmail" : item === "calendar" ? "Calendar" : item === "drive" ? "Drive" : item);
    return { tone: "warn", text: `Connected, but without ${names.join(" and ")}. Tap Reconnect and tick ${missing.length > 1 ? "those boxes" : "that box"} on Google's screen.` };
  }
  const error = params.get("error");
  if (error && /google/i.test(error)) return { tone: "warn", text: ERRORS[error] || `Google didn't connect: ${error.replace(/^google_/, "").replace(/_/g, " ").slice(0, 120)}` };
  return null;
}
