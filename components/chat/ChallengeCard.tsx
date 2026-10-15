"use client";

import { Check, LockKeyhole, RotateCw, ShieldCheck, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/chatClient";
import type { ChallengeCard as ChallengeInfo } from "@/lib/assistant/cards";

type Phase = "idle" | "sending" | "waiting" | "done" | "expired" | "failed" | "cancelled";

/**
 * Sign-in check inside the chat: the number to tap on the phone, a "tap Yes" prompt, or a code box.
 * Buttons post to /api/browser/challenge; the code never enters the conversation.
 */
export default function ChallengeCard({ card }: { card: ChallengeInfo }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (["done", "expired", "failed", "cancelled"].includes(phase)) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await api<{ status: string }>(`/api/browser/challenge?id=${encodeURIComponent(card.id)}`);
        if (data.status === "done") setPhase("done");
        else if (data.status === "expired") setPhase("expired");
        else if (data.status === "failed") setPhase("failed");
        else if (data.status === "cancelled") setPhase("cancelled");
      } catch { /* keep polling */ }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [card.id, phase]);

  async function send(action: "approved" | "resend" | "code" | "cancel") {
    setError(""); setPhase("sending");
    try {
      await api("/api/browser/challenge", { method: "POST", body: JSON.stringify({ id: card.id, action, ...(action === "code" ? { code } : {}) }) });
      setCode("");
      setPhase(action === "cancel" ? "cancelled" : action === "resend" ? "idle" : "waiting");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't send that."); setPhase("idle"); }
  }

  if (phase === "done") return <section className="el-card el-card-compact" aria-label="Signed in"><Check size={15} /><span><strong>Signed in to {card.site}</strong><small>Session saved, so next time skips this.</small></span></section>;
  if (phase === "expired" || phase === "failed" || phase === "cancelled") return <section className="el-card el-card-compact" aria-label="Sign-in check ended"><X size={15} /><span><strong>{phase === "cancelled" ? "Cancelled" : phase === "failed" ? "That didn't work" : "This check expired"}</strong><small>Ask Elias to try the sign-in again.</small></span></section>;

  const busy = phase === "sending";
  return <section className="el-card" aria-label={`Sign-in check for ${card.site}`}>
    <header style={{ display: "flex", gap: 8, alignItems: "center" }}><ShieldCheck size={15} /><strong>{card.site}</strong></header>
    {card.mode === "number" ? <div style={{ textAlign: "center", fontSize: 64, fontWeight: 700, lineHeight: 1.1, margin: "8px 0" }} aria-label={`Number ${card.number}`}>{card.number}</div> : null}
    {card.mode === "prompt" ? <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}><Smartphone size={40} strokeWidth={1.5} /></div> : null}
    <p style={{ margin: "4px 0 10px", opacity: 0.8, fontSize: 14 }}>{phase === "waiting" ? "Waiting for the page to move on…" : card.hint || (card.mode === "code" ? "Enter the code you were sent." : "Confirm on your phone.")}</p>
    {card.mode === "code" ? <form onSubmit={(event) => { event.preventDefault(); void send("code"); }} autoComplete="off" style={{ display: "grid", gap: 8 }}>
      <input className="el-mem-entity-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code" aria-label="Verification code" maxLength={12} required />
      {error ? <small style={{ color: "var(--danger, #c0392b)" }}>{error}</small> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="el-btn" onClick={() => void send("resend")} disabled={busy}><RotateCw size={14} /> Resend</button>
        <button type="submit" className="el-btn el-btn-primary" style={{ flex: 1 }} disabled={busy || code.trim().length < 4}><LockKeyhole size={14} /> {busy ? "Sending…" : "Submit"}</button>
      </div>
    </form> : <>
      {error ? <small style={{ color: "var(--danger, #c0392b)" }}>{error}</small> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="el-btn" onClick={() => void send("resend")} disabled={busy}><RotateCw size={14} /> Resend it</button>
        <button type="button" className="el-btn el-btn-primary" style={{ flex: 1 }} onClick={() => void send("approved")} disabled={busy || phase === "waiting"}>{phase === "waiting" ? "Checking…" : "I approved it"}</button>
      </div>
    </>}
    <button type="button" className="el-btn" style={{ marginTop: 8, width: "100%", opacity: 0.7 }} onClick={() => void send("cancel")} disabled={busy}>Cancel</button>
  </section>;
}
