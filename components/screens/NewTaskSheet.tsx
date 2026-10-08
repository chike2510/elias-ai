"use client";

import { useRouter } from "next/navigation";
import { Clock3, Rocket, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, userTimezone } from "@/lib/chatClient";

type Mode = "research" | "task" | "schedule";
const MODES: Array<{ value: Mode; label: string; icon: React.ReactNode; hint: string; placeholder: string }> = [
  { value: "research", label: "Research", icon: <Search size={15} />, hint: "Elias searches and reads in the background, then sends you a report with sources.", placeholder: "e.g. The 3 best budget Android phones in Nigeria right now, with prices and where to buy" },
  { value: "task", label: "Do it", icon: <Rocket size={15} />, hint: "A multi-step job that runs in the background. Anything that sends, books or spends waits for your OK.", placeholder: "e.g. Go through my unread email from this week and draft replies to the ones that need one" },
  { value: "schedule", label: "Repeat", icon: <Clock3 size={15} />, hint: "Something Elias does on a schedule. You'll confirm the details in chat.", placeholder: "e.g. Every Monday at 9, summarise my week" },
];

/** Tasks → New task: a bottom sheet. Research and tasks start a background job; repeats go to chat to be scheduled. */
export default function NewTaskSheet({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("research");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const current = MODES.find((item) => item.value === mode)!;

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    if (mode === "schedule") { router.push(`/?prompt=${encodeURIComponent(`Set this up as a scheduled task: ${text}`)}`); return; }
    setBusy(true); setError(null);
    try {
      await api("/api/assistant/jobs", { method: "POST", body: JSON.stringify({ prompt: text, kind: mode, timezone: userTimezone() }) });
      onStarted();
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="el-overlay el-overlay-sheet" onClick={onClose}>
    <form className="el-sheet v4-task-sheet" role="dialog" aria-modal="true" aria-label="New task" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
      <span className="el-sheet-grip" aria-hidden="true" />
      <header className="el-sheet-head"><Rocket size={18} /><strong>New task</strong><button type="button" className="el-icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <div className="el-seg v4-seg-3" role="radiogroup" aria-label="Kind of task">
        {MODES.map((item) => <button key={item.value} type="button" role="radio" aria-checked={mode === item.value} className={mode === item.value ? "on" : ""} onClick={() => setMode(item.value)}>{item.icon} {item.label}</button>)}
      </div>
      <p className="v4-hint">{current.hint}</p>
      <textarea ref={field} className="el-textarea" rows={4} maxLength={6000} value={prompt} placeholder={current.placeholder} aria-label="What should Elias do?" onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event); }} />
      {error ? <p className="el-error-text" role="alert">{error}</p> : null}
      <div className="el-sheet-actions">
        <button type="button" className="el-btn el-btn-lg" onClick={onClose}>Cancel</button>
        <button type="submit" className="el-btn el-btn-lg el-btn-primary" disabled={busy || !prompt.trim()}>{busy ? "Starting…" : mode === "schedule" ? "Set up in chat" : "Start"}</button>
      </div>
    </form>
  </div>;
}
