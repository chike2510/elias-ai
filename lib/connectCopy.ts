import type { ConnectCard as ConnectInfo } from "@/lib/assistant/cards";

/** Title, line and button for the Google connect card: first connect, reconnect (expired/revoked) or a missing permission. */
export function googleConnectCopy(connect: ConnectInfo, returnTo: string) {
  const scopeName = connect.scope === "drive" ? "Google Drive" : connect.scope === "calendar" ? "Google Calendar" : connect.scope === "gmail" ? "Gmail" : "Google";
  const href = `/api/connect/google?return=${encodeURIComponent(returnTo)}${connect.scope === "drive" ? "&scopes=drive" : ""}`;
  if (!connect.configured) return { title: "Google isn't set up yet", line: "Gmail and Calendar are not configured yet on this server. The owner needs to add Google OAuth keys.", button: null, href };
  if (!connect.reconnect) return { title: "Connect Google", line: connect.scope === "drive" ? "Lets Elias read your Google Drive files (read-only), plus Gmail and Calendar. Sending and inviting always ask you first." : "Lets Elias read your Gmail and Calendar. Sending and inviting always ask you first.", button: "Connect", href };
  const line = connect.reason === "missing_scope"
    ? connect.scope === "drive" ? "Elias needs read-only access to your Google Drive for this. Reconnect and allow Drive."
      : `Elias doesn't have permission for ${scopeName} yet. Reconnect and allow it.`
    : connect.reason === "revoked" ? "Access to Google was removed. Reconnect to use Gmail and Calendar again."
    : "Your Google sign-in expired. Reconnect to keep using Gmail and Calendar.";
  return { title: "Reconnect Google", line, button: "Reconnect", href };
}
