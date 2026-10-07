"use client";

import { Bell, BellOff, Send, Share } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { currentSubscription, disablePush, enablePush, permission, pushInfo, pushSupport, savePrefs, sendTest, type NotifyPrefs, type PushSupport } from "@/lib/pushClient";

const TYPES: Array<{ key: keyof NotifyPrefs; label: string; detail: string }> = [
  { key: "brief", label: "Daily brief", detail: "When your morning brief is posted" },
  { key: "reminders", label: "Reminders", detail: "When a scheduled task runs" },
  { key: "approvals", label: "Approvals", detail: "When something is waiting on your OK" },
  { key: "jobs", label: "Background jobs", detail: "When a job you handed off finishes" },
];

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`el-switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}

/** "Notifications" on the You page: this device on/off, a test send, and per-type toggles. */
export default function NotificationSettings() {
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSupport(pushSupport());
    try {
      const info = await pushInfo();
      setConfigured(info.configured); setPrefs(info.prefs);
      setEnabled(Boolean(await currentSubscription().catch(() => null)) && permission() === "granted");
    } catch { setConfigured(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function toggleDevice() {
    setBusy(true); setMessage(null);
    try {
      if (enabled) { await disablePush(); setEnabled(false); setMessage("Notifications are off on this device."); }
      else { const result = await enablePush(); if (result.ok) { setEnabled(true); setMessage("Notifications are on for this device."); } else setMessage(result.reason); }
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function setType(key: keyof NotifyPrefs, value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    try { setPrefs((await savePrefs({ [key]: value })).prefs); } catch (error) { setPrefs(previous); setMessage((error as Error).message); }
  }

  return <section className="el-section" id="notifications">
    <h2>Notifications</h2>
    {configured === false ? <p className="el-empty-line"><BellOff size={16} /> Notifications aren't set up on this server yet.</p> : null}
    {support === "ios-needs-install" ? <p className="el-hint"><Share size={15} /> On iPhone and iPad, add Elias to your Home Screen (Share, then “Add to Home Screen”) and open it from there to turn notifications on.</p> : null}
    {support === "unsupported" ? <p className="el-empty-line"><BellOff size={16} /> This browser doesn't support notifications.</p> : null}
    {configured ? <ul className="el-list">
      {support === "supported" ? <li><div className="el-list-row static">
        <span className={`el-list-icon ${enabled ? "accent" : ""}`}>{enabled ? <Bell size={17} /> : <BellOff size={17} />}</span>
        <span className="el-list-text"><strong>This device</strong><small>{enabled ? "On" : permission() === "denied" ? "Blocked in browser settings" : "Off"}</small></span>
        <span className="el-list-actions">
          {enabled ? <button type="button" className="el-icon-btn" aria-label="Send a test notification" onClick={() => void sendTest().then((data) => setMessage(data.outcome.sent ? "Sent. It should arrive in a moment." : `Nothing sent (${data.outcome.skipped || "no devices"}).`)).catch((error) => setMessage(error.message))}><Send size={16} /></button> : null}
          <Toggle checked={enabled} disabled={busy} label="Notifications on this device" onChange={() => void toggleDevice()} />
        </span>
      </div></li> : null}
      {prefs ? TYPES.map((type) => <li key={type.key}><div className="el-list-row static">
        <span className="el-list-text"><strong>{type.label}</strong><small>{type.detail}</small></span>
        <Toggle checked={prefs[type.key]} label={type.label} onChange={(next) => void setType(type.key, next)} />
      </div></li>) : null}
    </ul> : null}
    {message ? <p className="el-fineprint" role="status">{message}</p> : null}
  </section>;
}
