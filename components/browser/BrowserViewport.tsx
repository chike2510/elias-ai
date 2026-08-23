"use client";

import { useState } from "react";
import { ArrowLeft, Globe2, LockKeyhole, Pause, Play, RotateCw, Sparkles, X } from "lucide-react";
import type { BrowserActionResult, BrowserSession } from "@/lib/browser/types";

type Props = { initialUrl?: string; prompt?: string };

export default function BrowserViewport({ initialUrl = "https://", prompt = "Read this public page and summarize the important points." }: Props) {
  const [url, setUrl] = useState(initialUrl === "https://" ? "" : initialUrl);
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Start a session to let Elias read a public page.");
  const [error, setError] = useState("");

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || "Browser request failed.");
    return payload;
  }
  async function open() {
    if (!/^https?:\/\/[^\s]+$/i.test(url.trim())) { setError("Enter a complete public HTTP(S) URL."); return; }
    setBusy(true); setError("");
    try {
      let active = session;
      if (!active) {
        const created = await request("/api/browser/sessions", { method: "POST", body: JSON.stringify({ url: url.trim(), prompt }) });
        active = created.session as BrowserSession;
        setSession(active);
      }
      const result = await request(`/api/browser/sessions/${active.id}/actions`, { method: "POST", body: JSON.stringify({ type: "open", url: url.trim() }) }) as BrowserActionResult;
      setSession(result.session); setContent(result.content || ""); setMessage(result.summary);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not open page."); }
    finally { setBusy(false); }
  }
  async function action(type: "pause" | "close" | "extract") {
    if (!session) return;
    setBusy(true); setError("");
    try {
      const result = await request(`/api/browser/sessions/${session.id}/actions`, { method: "POST", body: JSON.stringify({ type }) }) as BrowserActionResult;
      setSession(result.session); if (result.content) setContent(result.content); setMessage(result.summary);
      if (type === "close") setContent("");
    } catch (value) { setError(value instanceof Error ? value.message : "Could not update browser session."); }
    finally { setBusy(false); }
  }

  return <main className="browser-workspace" aria-label="Elias browser workspace">
    <section className="browser-hero">
      <div><div className="eyebrow"><Sparkles size={14} /> Browser workspace</div><h1>Let Elias browse with you.</h1><p>Open a public page, keep the page context in the active task, and ask Elias to reason over what it finds.</p></div>
      <div className="browser-capability"><LockKeyhole size={15} /><span>Public pages only</span></div>
    </section>
    <section className="browser-card">
      <div className="browser-toolbar"><button className="icon-btn" type="button" aria-label="Browser back" disabled><ArrowLeft size={17} /></button><button className="icon-btn" type="button" aria-label="Refresh page" onClick={() => void open()} disabled={!url || busy}><RotateCw size={16} /></button><div className="browser-address"><LockKeyhole size={13} /><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void open(); }} placeholder="https://example.com" aria-label="Public page URL" /><Globe2 size={15} /></div><button className="browser-open" type="button" onClick={() => void open()} disabled={busy || !url}>{busy ? "Opening…" : "Open"}</button></div>
      <div className="browser-status"><span className={`status-dot ${session?.status === "active" ? "live" : ""}`} /> <span>{message}</span><span className="browser-status-spacer" />{session ? <><button className="text-btn" type="button" onClick={() => void action(session.status === "paused" ? "extract" : "pause")} disabled={busy}>{session.status === "paused" ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}</button><button className="text-btn danger" type="button" onClick={() => void action("close")} disabled={busy}><X size={14} /> Close</button></> : null}</div>
      {error ? <div className="browser-error" role="alert">{error}</div> : null}
      <article className="browser-page"><div className="browser-page-top"><span><Globe2 size={17} /> {session?.title || "Elias public-page reader"}</span>{session?.currentUrl ? <a href={session.currentUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}</div>{content ? <div className="browser-copy">{content}</div> : <div className="browser-empty"><Globe2 size={34} /><strong>Your page context will appear here</strong><span>Elias currently reads bounded public text server-side. Interactive screenshots, logins, clicks, form submission, and external writes stay approval-gated for the persistent browser worker phase.</span></div>}</article>
    </section>
  </main>;
}
