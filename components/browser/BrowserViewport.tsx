"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Globe2, LockKeyhole, Pause, Play, RotateCw, Send, Sparkles, X } from "lucide-react";
import type { BrowserAction, BrowserActionRequest, BrowserObservation, BrowserSession } from "@/lib/browser/types";

type Props = { initialUrl?: string; prompt?: string };
type ManualType = "navigate" | "click" | "type" | "scroll" | "screenshot" | "extract";

export default function BrowserViewport({ initialUrl = "https://", prompt = "Read this public page and summarize the important points." }: Props) {
  const [url, setUrl] = useState(initialUrl === "https://" ? "" : initialUrl);
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Start a session to let Elias read a public page.");
  const [error, setError] = useState("");
  const [manualType, setManualType] = useState<ManualType>("navigate");
  const [selector, setSelector] = useState("");
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState("");

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const apiError = typeof payload.error === "string" ? payload.error : payload.error?.message; throw new Error(apiError || payload.message || "Browser request failed."); }
    return payload;
  }
  async function load(id: string) {
    try { const result = await request(`/api/browser/sessions/${encodeURIComponent(id)}/actions`); setSession(result.session); setSessionId(id); setContent(result.session.extractedText || ""); setMessage(result.session.status === "waiting_for_user" ? "Elias is waiting for your approval." : "Connected browser session ready."); } catch (value) { setError(value instanceof Error ? value.message : "Could not load browser session."); }
  }
  async function open() {
    if (!/^https?:\/\/[^\s]+$/i.test(url.trim())) { setError("Enter a complete public HTTP(S) URL."); return; }
    setBusy(true); setError("");
    try {
      let active = session;
      if (!active) { const created = await request("/api/browser/sessions", { method: "POST", body: JSON.stringify({ url: url.trim(), prompt }) }); active = created.session as BrowserSession; setSession(active); setSessionId(active.id); }
      const result = await request(`/api/browser/sessions/${active.id}/actions`, { method: "POST", body: JSON.stringify({ type: "open", url: url.trim() }) });
      setSession(result.session); setSessionId(result.session.id); setContent(result.content || ""); setMessage(result.summary);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not open page."); }
    finally { setBusy(false); }
  }
  async function action(type: "pause" | "close" | "extract") {
    if (!session) return;
    setBusy(true); setError("");
    try { const result = await request(`/api/browser/sessions/${session.id}/actions`, { method: "POST", body: JSON.stringify({ type }) }); setSession(result.session); if (result.content) setContent(result.content); setMessage(result.summary); if (type === "close") setContent(""); } catch (value) { setError(value instanceof Error ? value.message : "Could not update browser session."); }
    finally { setBusy(false); }
  }
  async function queueManualAction() {
    if (!session) { setError("Open a public page or load a browser session first."); return; }
    if (manualType === "navigate" && !/^https?:\/\/[^\s]+$/i.test(url.trim())) { setError("Enter a complete HTTP(S) URL before navigating."); return; }
    if ((manualType === "click" || manualType === "type") && !selector.trim()) { setError("Add a CSS selector for the element Elias should target."); return; }
    setBusy(true); setError("");
    try {
      const payload: BrowserAction = manualType === "navigate" ? { type: "navigate", url: url.trim() } : manualType === "click" ? { type: "click", selector: selector.trim() } : manualType === "type" ? { type: "type", selector: selector.trim(), text } : manualType === "scroll" ? { type: "scroll", direction: "down", amount: 600 } : manualType === "screenshot" ? { type: "screenshot" } : { type: "extract", selector: selector.trim() || undefined };
      const result = await request(`/api/browser/sessions/${session.id}/actions`, { method: "POST", body: JSON.stringify(payload) });
      setSession(result.session); setMessage(result.summary); setSelector(""); setText("");
    } catch (value) { setError(value instanceof Error ? value.message : "Could not queue browser action."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("sessionId");
    if (id) { setSessionId(id); void load(id); }
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => { void load(sessionId); }, 1800);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const pending = session?.pendingActions.filter((item) => item.status === "queued" || item.status === "running") || [];
  const observations = session?.observations.slice(-5).reverse() || [];
  const screenshot = session?.observations.slice().reverse().find((item) => item.imageDataUrl)?.imageDataUrl;

  return <main className="browser-workspace" aria-label="Elias browser workspace">
    <section className="browser-hero"><div><div className="eyebrow"><Sparkles size={14} /> Computer use</div><h1>Let Elias work in your browser.</h1><p>Connect your paired browser, give Elias an outcome, and watch each action pause for approval when it could change something outside Elias.</p></div><div className="browser-capability"><LockKeyhole size={15} /><span>Approval-gated actions</span></div></section>
    <section className="browser-card">
      <div className="browser-toolbar"><button className="icon-btn" type="button" aria-label="Browser back" disabled><ArrowLeft size={17} /></button><button className="icon-btn" type="button" aria-label="Refresh page" onClick={() => void open()} disabled={!url || busy}><RotateCw size={16} /></button><div className="browser-address"><LockKeyhole size={13} /><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void open(); }} placeholder="https://example.com" aria-label="Public page URL" /><Globe2 size={15} /></div><button className="browser-open" type="button" onClick={() => void open()} disabled={busy || !url}>{busy ? "Opening…" : "Open"}</button></div>
      <div className="browser-status"><span className={`status-dot ${session?.status === "active" ? "live" : ""}`} /><span>{message}</span><span className="browser-status-spacer" />{session ? <><button className="text-btn" type="button" onClick={() => void action(session.status === "paused" ? "extract" : "pause")} disabled={busy}>{session.status === "paused" ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}</button><button className="text-btn danger" type="button" onClick={() => void action("close")} disabled={busy}><X size={14} /> Close</button></> : null}</div>
      {error ? <div className="browser-error" role="alert">{error}</div> : null}
      <section className="browser-control-card"><div className="browser-control-title"><div><span className="eyebrow">LIVE BROWSER CONTROL</span><strong>{session ? `Session ${session.id.slice(-8)}` : "No browser session connected"}</strong></div><span className={`browser-control-state ${session?.status || "idle"}`}>{session?.status || "idle"}</span></div><p>Use the extension to connect Elias to your active logged-in tab. Navigation and reading can run immediately; clicks and typing pause for your approval.</p><div className="browser-action-form"><label><span>Action</span><select value={manualType} onChange={(event) => setManualType(event.target.value as ManualType)}><option value="navigate">Navigate</option><option value="click">Click element</option><option value="type">Type text</option><option value="scroll">Scroll down</option><option value="screenshot">Capture screen</option><option value="extract">Extract page text</option></select><ChevronDown size={14} /></label><label><span>{manualType === "navigate" ? "URL" : "CSS selector"}</span><input value={manualType === "navigate" ? url : selector} onChange={(event) => manualType === "navigate" ? setUrl(event.target.value) : setSelector(event.target.value)} placeholder={manualType === "navigate" ? "https://example.com" : "#search, button.submit"} /></label>{manualType === "type" ? <label><span>Text</span><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Text Elias should enter" /></label> : null}<button type="button" className="primary" onClick={() => void queueManualAction()} disabled={busy || !session}><Send size={14} /> Queue action</button></div></section>
      <article className="browser-page"><div className="browser-page-top"><span><Globe2 size={17} /> {session?.title || "Elias browser view"}</span>{session?.currentUrl ? <a href={session.currentUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}</div>{screenshot ? <img className="browser-screenshot" src={screenshot} alt="Latest browser observation" /> : content ? <div className="browser-copy">{content}</div> : <div className="browser-empty"><Globe2 size={34} /><strong>Your browser context will appear here</strong><span>Pair the Elias extension to let the agent observe the active page and perform approval-gated browser actions.</span></div>}</article>
      {pending.length ? <section className="browser-queue"><div className="browser-control-title"><div><span className="eyebrow">ACTION QUEUE</span><strong>{pending.length} action{pending.length === 1 ? "" : "s"} in progress</strong></div></div>{pending.map((item: BrowserActionRequest) => <div className="browser-queue-item" key={item.id}><span className={`queue-dot ${item.status}`} /><span><strong>{item.type.replace("browser_", "")}</strong><small>{item.selector || item.url || item.text || "Awaiting connected browser"}</small></span><span className="queue-status">{item.requiresApproval ? "approval" : item.status}</span></div>)}</section> : null}
      {observations.length ? <section className="browser-observations"><div className="browser-control-title"><div><span className="eyebrow">OBSERVATIONS</span><strong>What Elias has seen</strong></div></div>{observations.map((item: BrowserObservation) => <div className="browser-observation" key={item.id}><span className={`observation-kind ${item.kind}`} /> <span>{item.title || item.kind}</span><small>{item.text ? item.text.slice(0, 140) : item.url || "Browser event recorded"}</small></div>)}</section> : null}
    </section>
  </main>;
}
