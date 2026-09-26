"use client";
import { ArrowDownToLine, ArrowUpRight, FileText, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { getArtifacts, type ArtifactRecord } from "@/lib/persistence";
export default function OutcomesScreen() {
  const [items, setItems] = useState<ArtifactRecord[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => { void getArtifacts().then(setItems).catch(() => setItems([])); }, []);
  const visible = useMemo(() => items.filter((item) => `${item.name} ${item.summary || ""}`.toLowerCase().includes(query.toLowerCase().trim())), [items, query]);
  return <AppShell title="Outcomes"><main className="screen outcomes-screen"><header className="screen-header"><div className="screen-header-copy"><span className="eyebrow">WORK DELIVERED</span><h1>Outcomes</h1><p className="screen-description">The useful results ELIAS has created for you, ready to continue or download.</p></div><Link className="primary" href="/chat"><Sparkles size={15} /> Start something new</Link></header><label className="searchbox outcome-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search outcomes" /><span>{visible.length}</span></label><section className="outcome-list">{visible.map((item) => <article className="outcome-card" key={item.id}><div className="outcome-card-main"><span className="outcome-file-icon"><FileText size={18} /></span><div><span className="eyebrow">{item.type || "DELIVERABLE"}</span><h2>{item.name}</h2><p>{item.summary || "Created by ELIAS. Open the artifact to review the full result."}</p><small>{new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</small></div></div><div className="outcome-actions"><button type="button" className="icon-btn" title="Download" aria-label={`Download ${item.name}`}><ArrowDownToLine size={16} /></button><Link className="secondary" href={`/files?artifact=${encodeURIComponent(item.id)}`}>Open <ArrowUpRight size={14} /></Link></div></article>)}{!visible.length ? <section className="outcomes-empty"><Sparkles size={22} /><h2>No outcomes yet</h2><p>Start with an objective and ELIAS will keep the finished work here.</p><Link className="primary" href="/chat">Describe an objective</Link></section> : null}</section></main></AppShell>;
}
