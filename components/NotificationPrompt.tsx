"use client";

import { Bell, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { enablePush, permission, PROMPT_DISMISSED_KEY, pushInfo, pushSupport, type PushSupport } from "@/lib/pushClient";

/**
 * A friendly, dismissible card asking to turn on notifications. Never shown on load as a browser
 * prompt: the permission dialog only appears after the user taps "Turn on".
 */
export default function NotificationPrompt({ reason = "I'll ping you when your brief is ready, a reminder fires, something needs your OK, or a background job finishes." }: { reason?: string }) {
  const [visible, setVisible] = useState(false);
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const support = pushSupport();
    setSupport(support);
    if (support === "unsupported" || window.localStorage.getItem(PROMPT_DISMISSED_KEY)) return;
    if (support === "supported" && permission() !== "default") return;
    void pushInfo().then((info) => { if (active && info.configured) setVisible(true); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!visible) return null;
  const dismiss = () => { window.localStorage.setItem(PROMPT_DISMISSED_KEY, String(Date.now())); setVisible(false); };

  return <section className="el-push-card" aria-label="Notifications">
    <span className="el-push-icon"><Bell size={18} /></span>
    <div className="el-push-text">
      <strong>Want a nudge when things are ready?</strong>
      <small>{support === "ios-needs-install" ? <>On iPhone, notifications work once Elias is on your Home Screen: tap <Share size={12} aria-label="Share" /> then “Add to Home Screen”, and open it from there.</> : reason}</small>
      {message ? <small className="el-push-msg" role="status">{message}</small> : null}
    </div>
    <div className="el-push-actions">
      {support === "supported" ? <button type="button" className="el-btn el-btn-primary" disabled={busy} onClick={() => {
        setBusy(true); setMessage(null);
        void enablePush().then((result) => { if (result.ok) { setMessage("Done. You'll hear from me."); window.setTimeout(dismiss, 1400); } else setMessage(result.reason); })
          .catch((error) => setMessage((error as Error).message)).finally(() => setBusy(false));
      }}>{busy ? "Turning on…" : "Turn on"}</button> : null}
      <button type="button" className="el-btn el-btn-ghost" onClick={dismiss}>{support === "supported" ? "Not now" : "Got it"}</button>
    </div>
    <button type="button" className="el-icon-btn el-push-close" aria-label="Dismiss" onClick={dismiss}><X size={16} /></button>
  </section>;
}
