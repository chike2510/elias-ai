"use client";

import { Check, Expand, Globe, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/chatClient";
import type { BrowserRunCard as RunInfo } from "@/lib/assistant/cards";

type Live = {
  status: string; statusText: string; step: number; maxSteps: number; url: string; title: string;
  click: { x: number; y: number } | null; frame?: string;
  pending: null | { type: "approval"; summary: string } | { type: "input"; kind: string; question: string };
  answered: boolean; summary: string | null; error: string | null;
};

const VIEW = { width: 1024, height: 640 };
const ENDED = ["done", "failed", "stopped"];

/**
 * Live view of a background browser run: newest frame (pushed over SSE after each action), a status pill, a zoom circle
 * where it clicked, fullscreen, Stop, and the approve / answer controls when the run pauses for the user.
 */
export default function BrowserRunCard({ card }: { card: RunInfo }) {
  const [live, setLive] = useState<Live | null>(null);
  const [frame, setFrame] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/browser/runs/${encodeURIComponent(card.id)}/events`);
    source.addEventListener("run", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Live;
      if (data.frame) setFrame(data.frame);
      setLive(data);
      if (ENDED.includes(data.status)) source.close();
    });
    return () => source.close();
  }, [card.id]);

  async function control(action: "approve" | "deny" | "answer" | "stop") {
    setBusy(true); setError("");
    try {
      await api(`/api/browser/runs/${encodeURIComponent(card.id)}/control`, { method: "POST", body: JSON.stringify({ action, ...(action === "answer" ? { text: answer } : {}) }) });
      if (action === "answer") setAnswer("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't send that."); }
    setBusy(false);
  }

  const status = live?.status || "queued";
  const ended = ENDED.includes(status);
  const pending = live && !live.answered ? live.pending : null;
  const host = (() => { try { return new URL(live?.url || card.startUrl).hostname.replace(/^www\./, ""); } catch { return card.startUrl; } })();
  const pill = status === "done" ? "Done" : status === "failed" ? "Stopped" : status === "stopped" ? "Stopped by you" : live?.statusText || "Starting the browser…";

  return <section className="el-card el-brun" aria-label={`Browser job: ${card.goal}`}>
    <header className="el-brun-head">
      <Globe size={14} /><span className="el-brun-host">{host}</span>
      <span className={`el-brun-pill el-brun-${status}`} role="status">{status === "done" ? <Check size={12} /> : ended ? <X size={12} /> : <i className="el-brun-dot" />}{pill}</span>
      {live ? <small className="el-brun-steps">{live.step}/{live.maxSteps}</small> : null}
    </header>
    <div className="el-brun-shot" ref={shot}>
      {frame ? <img src={frame} alt={live?.title || "Browser view"} /> : <div className="el-brun-empty">Opening {host}…</div>}
      {frame && live?.click && !ended ? <span className="el-brun-zoom" style={{ left: `${(live.click.x / VIEW.width) * 100}%`, top: `${(live.click.y / VIEW.height) * 100}%`, backgroundImage: `url(${frame})`, backgroundSize: `${VIEW.width * 2 * 0.1}% auto`, backgroundPosition: `${(live.click.x / VIEW.width) * 100}% ${(live.click.y / VIEW.height) * 100}%` }} aria-hidden /> : null}
      {frame ? <button type="button" className="el-brun-full" aria-label="Fullscreen" onClick={() => void shot.current?.requestFullscreen?.()}><Expand size={14} /></button> : null}
    </div>
    {pending?.type === "approval" ? <div className="el-brun-ask">
      <p><strong>OK to continue?</strong> {pending.summary}</p>
      <div className="el-brun-row"><button type="button" className="el-btn el-btn-primary" disabled={busy} onClick={() => void control("approve")}>Approve</button><button type="button" className="el-btn" disabled={busy} onClick={() => void control("deny")}>Don&apos;t press it</button></div>
    </div> : null}
    {pending?.type === "input" ? <form className="el-brun-ask" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) void control("answer"); }}>
      <p>{pending.question}</p>
      <div className="el-brun-row"><input className="el-mem-entity-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={pending.kind === "code" ? "Code" : "Your answer"} inputMode={pending.kind === "code" ? "numeric" : undefined} autoComplete={pending.kind === "code" ? "one-time-code" : "off"} aria-label="Answer" required /><button type="submit" className="el-btn el-btn-primary" disabled={busy}>Send</button></div>
    </form> : null}
    {ended && (live?.summary || live?.error) ? <p className="el-brun-result">{live.summary || live.error}</p> : null}
    {error ? <small className="el-brun-error">{error}</small> : null}
    {!ended ? <footer className="el-brun-foot"><small>{card.goal}</small><button type="button" className="el-btn el-brun-stop" disabled={busy} onClick={() => void control("stop")}><Square size={12} />Stop</button></footer> : null}
  </section>;
}
