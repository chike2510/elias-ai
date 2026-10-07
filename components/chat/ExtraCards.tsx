"use client";

import "@/components/brain.css";
import { Brain, Check, CreditCard, Database, ExternalLink, Github, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { ListCard, MemoryReviewCard, ReviewItem } from "@/lib/assistant/cards";
import { api } from "@/lib/chatClient";

const ICONS = { github: <Github size={15} />, vercel: <span aria-hidden="true">▲</span>, supabase: <Database size={15} />, payments: <CreditCard size={15} /> };

/** GitHub / Vercel / Supabase / payments results as one compact card. */
export function ConnectorListCard({ card }: { card: ListCard }) {
  return <section className="el-card" aria-label={card.title}>
    <header className="el-card-head">{ICONS[card.icon]} {card.title}</header>
    {card.items.length ? <ul className="el-card-rows">{card.items.map((item, index) => {
      const body = <>
        <span className={`el-status-dot ${item.state || "info"}`} aria-label={item.state || undefined} />
        <span className="el-card-text"><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
        {item.trail ? <span className="el-card-trail">{item.trail}</span> : item.url ? <ExternalLink size={14} className="el-card-trail" /> : null}
      </>;
      return <li key={`${item.title}-${index}`}>{item.url ? <a className="el-card-row" href={item.url} target="_blank" rel="noreferrer">{body}</a> : <div className="el-card-row">{body}</div>}</li>;
    })}</ul> : <p className="el-card-foot">Nothing to show.</p>}
    {card.footer ? <p className="el-card-foot">{card.footer}</p> : null}
  </section>;
}

type ItemState = "idle" | "editing" | "confirmed" | "forgotten" | "saving";

function ReviewRow({ item }: { item: ReviewItem }) {
  const [state, setState] = useState<ItemState>("idle");
  const [content, setContent] = useState(item.content);
  const [draft, setDraft] = useState(item.content);
  const [error, setError] = useState<string | null>(null);
  async function call(path: string, init: RequestInit, next: ItemState) {
    setState("saving"); setError(null);
    try { await api(path, init); setState(next); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save that."); setState("idle"); }
  }
  if (state === "forgotten") return <li className="el-review-item"><span className="el-review-gone">Forgotten.</span></li>;
  return <li className="el-review-item">
    {state === "editing" ? <>
      <textarea className="el-textarea" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Edit what Elias learned" />
      <div className="el-review-actions">
        <button type="button" className="el-btn el-btn-sm" onClick={() => setState("idle")}><X size={15} /> Cancel</button>
        <button type="button" className="el-btn el-btn-primary el-btn-sm" disabled={!draft.trim()} onClick={() => { const text = draft.trim(); void call(`/api/assistant/memories/${item.id}`, { method: "PATCH", body: JSON.stringify({ content: text }) }, "confirmed").then(() => setContent(text)); }}><Check size={15} /> Save</button>
      </div>
    </> : <>
      <p>{content}</p>
      <div className="el-review-meta"><span className="el-tag">{item.kind}</span>{item.entity ? <span className="el-mem-entity">{item.entity}</span> : null}</div>
      {state === "confirmed" ? <span className="el-review-done"><Check size={14} /> Confirmed</span> : <div className="el-review-actions">
        <button type="button" className="el-btn el-btn-primary el-btn-sm" disabled={state === "saving"} onClick={() => void call(`/api/assistant/memories/${item.id}`, { method: "PATCH", body: JSON.stringify({ confirmed: true }) }, "confirmed")}><Check size={15} /> Right</button>
        <button type="button" className="el-btn el-btn-sm" disabled={state === "saving"} onClick={() => { setDraft(content); setState("editing"); }}><Pencil size={15} /> Edit</button>
        <button type="button" className="el-btn el-btn-sm" disabled={state === "saving"} onClick={() => void call(`/api/assistant/memories/${item.id}`, { method: "DELETE" }, "forgotten")}><Trash2 size={15} /> Forget</button>
      </div>}
    </>}
    {error ? <small className="el-review-gone">{error}</small> : null}
  </li>;
}

/** The weekly "Here's what I learned about you" card: confirm, edit or forget each item in place. */
export function MemoryReview({ card }: { card: MemoryReviewCard }) {
  return <section className="el-card" aria-label={card.title}>
    <header className="el-card-head"><Brain size={15} /> {card.title}</header>
    <ul className="el-card-rows el-review">{card.items.map((item) => <ReviewRow key={item.id} item={item} />)}</ul>
    <p className="el-card-foot"><a href="/memory">See everything Elias remembers</a></p>
  </section>;
}
