"use client";

import { CalendarDays, Check, Globe2, Mail, Pencil, ShieldCheck, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Approval } from "@/lib/chatClient";
import { haptic } from "@/lib/chatClient";

const UNDO_SECONDS = 5;

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="el-approval-row"><span>{label}</span><div>{children}</div></div>;
}

/** Shows exactly what will happen; Approve starts a short undo window before anything runs. */
export default function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (decision: "approve" | "decline", edits?: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [countdown, setCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const details = approval.details;

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const fired = useRef(false);
  useEffect(() => {
    if (countdown !== 0 || fired.current) return;
    fired.current = true;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setCountdown(null);
    setBusy(true);
    const changed = Object.fromEntries(Object.entries(edits).filter(([, item]) => item !== undefined));
    void onDecide("approve", Object.keys(changed).length ? changed : undefined).finally(() => setBusy(false));
  }, [countdown, edits, onDecide]);

  function startApprove() {
    haptic(10);
    setEditing(false);
    fired.current = false;
    setCountdown(UNDO_SECONDS);
    timer.current = window.setInterval(() => setCountdown((value) => (value === null ? null : Math.max(0, value - 1))), 1000);
  }

  function undo() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setCountdown(null);
    haptic(6);
  }

  async function deny() {
    haptic(10);
    setBusy(true);
    await onDecide("decline").finally(() => setBusy(false));
  }

  const value = (key: string, fallback: string) => edits[key] ?? fallback;
  const field = (key: string, label: string, fallback: string, multiline = false) => <label className="el-field" key={key}><span>{label}</span>{multiline
    ? <textarea rows={6} value={value(key, fallback)} onChange={(event) => setEdits((current) => ({ ...current, [key]: event.target.value }))} />
    : <input value={value(key, fallback)} onChange={(event) => setEdits((current) => ({ ...current, [key]: event.target.value }))} />}</label>;

  const done = approval.status !== "pending";
  const icon = details.kind === "email" ? <Mail size={16} /> : details.kind === "event" ? <CalendarDays size={16} /> : details.kind === "delete_event" ? <Trash2 size={16} /> : details.kind === "browser" ? <Globe2 size={16} /> : <ShieldCheck size={16} />;
  const heading = details.kind === "email" ? "Send this email?" : details.kind === "event" ? "Create this event and invite guests?" : details.kind === "delete_event" ? "Delete this event?" : details.kind === "browser" ? "Do this in the browser?" : "Go ahead?";

  return <section className={`el-approval ${done ? "is-done" : ""}`} aria-label="Approval needed">
    <header className="el-approval-head">{icon}<strong>{done ? statusText(approval.status) : heading}</strong></header>
    {!editing ? <div className="el-approval-body">
      {details.kind === "email" ? <>
        <Row label="To">{value("to", details.to)}</Row>
        {details.cc || edits.cc ? <Row label="Cc">{value("cc", details.cc || "")}</Row> : null}
        <Row label="Subject">{value("subject", details.subject)}</Row>
        <p className="el-approval-preview">{value("body", details.body)}</p>
      </> : details.kind === "event" ? <>
        <Row label="Title">{value("summary", details.title)}</Row>
        <Row label="When">{formatTime(value("start", details.start))} – {formatTime(value("end", details.end)).split(", ").pop()}</Row>
        {details.location ? <Row label="Where">{value("location", details.location)}</Row> : null}
        <Row label="Guests">{value("attendees", details.guests.join(", ")) || "None"}</Row>
      </> : details.kind === "delete_event" ? <Row label="Event">{details.title}</Row>
      : details.kind === "browser" ? <>
        <Row label="Site"><span className="el-break">{details.url || "Current page"}</span></Row>
        <Row label="Action">{details.action}</Row>
        {details.amount ? <Row label="Amount"><strong className="el-amount">{details.amount}</strong></Row> : null}
      </> : <p className="el-approval-preview">{details.text}</p>}
    </div> : <div className="el-approval-body el-approval-edit">
      {details.kind === "email" ? <>{field("to", "To", details.to)}{field("cc", "Cc", details.cc || "")}{field("subject", "Subject", details.subject)}{field("body", "Message", details.body, true)}</> : null}
      {details.kind === "event" ? <>{field("summary", "Title", details.title)}{field("start", "Start (ISO)", details.start)}{field("end", "End (ISO)", details.end)}{field("location", "Where", details.location || "")}{field("attendees", "Guests (comma separated)", details.guests.join(", "))}</> : null}
    </div>}
    {done ? (approval.result && approval.status === "failed" ? <p className="el-approval-note">{approval.result.slice(0, 200)}</p> : null)
      : countdown !== null ? <div className="el-approval-actions"><div className="el-undo" role="status"><span className="el-undo-bar" style={{ animationDuration: `${UNDO_SECONDS}s` }} />Doing it in {countdown}s</div><button type="button" className="el-btn el-btn-lg" onClick={undo}><Undo2 size={18} /> Undo</button></div>
      : <div className="el-approval-actions">
        <button type="button" className="el-btn el-btn-lg el-btn-primary" disabled={busy} onClick={startApprove}><Check size={18} /> {busy ? "Working…" : "Approve"}</button>
        {approval.editable.length ? <button type="button" className="el-btn el-btn-lg" disabled={busy} onClick={() => setEditing((open) => !open)}><Pencil size={17} /> {editing ? "Preview" : "Edit"}</button> : null}
        <button type="button" className="el-btn el-btn-lg el-btn-ghost" disabled={busy} onClick={() => void deny()}><X size={18} /> Deny</button>
      </div>}
  </section>;
}

function statusText(status: string) {
  return ({ done: "Done", declined: "Denied", failed: "Couldn't finish", running: "Working on it…" } as Record<string, string>)[status] || status;
}
