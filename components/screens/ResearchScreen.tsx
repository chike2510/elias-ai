"use client";

import { ExternalLink, Globe2, LoaderCircle, Search, X } from "lucide-react";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { readApiResponse } from "@/lib/clientApi";

type Source = { title: string; url: string; source?: string };

export default function ResearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Source[]>([]);
  const [selected, setSelected] = useState<{ url: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!query.trim() || busy) return;
    setBusy(true); setError(""); setSelected(null);
    try {
      const data = await readApiResponse<{ results?: Source[] }>(await fetch("/api/web/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) }));
      setResults(data.results || []);
      if (!data.results?.length) setError("No readable sources were returned. Try a more specific query.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Search failed."); }
    finally { setBusy(false); }
  }

  async function openSource(source: Source) {
    setOpening(true); setError("");
    try { const data = await readApiResponse<{ url?: string; content?: string }>(await fetch("/api/web/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: source.url }) })); setSelected({ url: data.url || source.url, content: data.content || "No readable content returned." }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Source could not be opened."); }
    finally { setOpening(false); }
  }

  return <AppShell title="Research"><main className="screen"><ScreenHeader title="Research" /><div className="research-box"><div className="research-label"><Globe2 size={16} /> live source research</div><textarea value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void run(); } }} placeholder="what do you need current information about?" rows={4} /><button className="primary wide" disabled={busy || !query.trim()} onClick={() => void run()}>{busy ? <><LoaderCircle className="spin" size={16} /> searching…</> : <><Search size={16} /> search the web</>}</button></div>{error ? <div className="inline-error">{error}</div> : null}<div className="research-layout"><div className="research-results">{results.map((result, index) => <button className={`source-card ${selected?.url === result.url ? "selected" : ""}`} type="button" key={`${result.url}-${index}`} onClick={() => void openSource(result)}><div><b>{result.title}</b><small>{result.source || result.url}</small></div><ExternalLink size={15} /></button>)}{!results.length && !error ? <section className="panel"><div className="empty-state"><Globe2 size={22} /><b>current information, not stale answers</b><small>Search first, then open a source to read the bounded text that ELIAS can reason over.</small></div></section> : null}</div>{selected ? <aside className="research-reader"><div className="reader-head"><div><span className="eyebrow">source excerpt</span><a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a></div><button type="button" onClick={() => setSelected(null)} aria-label="Close source"><X size={16} /></button></div>{opening ? <LoaderCircle className="spin" size={18} /> : <p>{selected.content}</p>}</aside> : null}</div></main></AppShell>;
}
