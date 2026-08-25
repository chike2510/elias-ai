"use client";

import Link from "next/link";
import { ArrowUpRight, Check, ExternalLink, Eye, Figma, GitBranch, LayoutTemplate, Search, Sparkles, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";

const sources = [
  { name: "Beautiful UI", url: "https://beautifului.dev", kind: "AI interface patterns", tone: "violet" },
  { name: "beUI", url: "https://beui.dev", kind: "Animated React components", tone: "blue" },
  { name: "Rare UI", url: "https://rareui.com", kind: "Product interface modules", tone: "orange" },
  { name: "Transitions", url: "https://transitions.dev", kind: "Motion patterns", tone: "green" },
  { name: "shadcn/ui", url: "https://ui.shadcn.com", kind: "Accessible primitives", tone: "neutral" },
];

const components = [
  { name: "Foldable progress card", category: "Task execution", source: "Beautiful UI", fit: 96, note: "Compact summary with tap-to-expand evidence." },
  { name: "Approval panel", category: "Safety", source: "shadcn/ui", fit: 94, note: "Clear decision actions with an auditable diff." },
  { name: "Command sheet", category: "Navigation", source: "beUI", fit: 91, note: "Origin-aware + menu for mobile context." },
  { name: "Repository activity row", category: "Agent", source: "Rare UI", fit: 89, note: "Dense file and commit activity without clutter." },
  { name: "Source citation block", category: "Research", source: "Transitions", fit: 86, note: "Evidence-first response module with source links." },
];

export default function DesignSourcesScreen() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(components[0]);
  const [applied, setApplied] = useState(false);
  const filtered = useMemo(() => components.filter((item) => `${item.name} ${item.category} ${item.source}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <AppShell title="Design Sources"><main className="screen design-sources-screen">
    <header className="design-sources-hero"><div><span className="eyebrow">ELIAS / DESIGN SYSTEM</span><h1>Design Sources</h1><p>Collect strong interface modules, adapt them to Elias, and review the result before it touches your repository.</p></div><span className="design-sources-mark"><Sparkles size={24} /></span></header>
    <section className="design-source-panel"><div className="design-source-panel-head"><div><span className="eyebrow">APPROVED SOURCES</span><h2>Reference libraries</h2></div><Link className="secondary" href="/connectors"><GitBranch size={14} /> Manage</Link></div><div className="design-source-list">{sources.map((source) => <a className="design-source-row" href={source.url} target="_blank" rel="noreferrer" key={source.name}><span className={`design-source-logo ${source.tone}`}><LayoutTemplate size={16} /></span><span><strong>{source.name}</strong><small>{source.kind}</small></span><ExternalLink size={14} /></a>)}</div></section>
    <section className="design-source-panel"><div className="design-source-panel-head"><div><span className="eyebrow">COMPONENT CATALOG</span><h2>Find a module</h2></div><span className="design-source-count">{filtered.length} matches</span></div><label className="design-source-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cards, rows, loaders…" /></label><div className="design-component-list">{filtered.map((item) => <button type="button" className={`design-component-row ${selected.name === item.name ? "active" : ""}`} onClick={() => { setSelected(item); setApplied(false); }} key={item.name}><span className="design-component-icon"><WandSparkles size={15} /></span><span><strong>{item.name}</strong><small>{item.category} · {item.source}</small></span><b>{item.fit}%</b></button>)}</div></section>
    <section className="design-preview-panel"><div className="design-preview-head"><div><span className="eyebrow">ELIAS ADAPTATION</span><h2>{selected.name}</h2><p>{selected.note}</p></div><span className="design-fit"><Check size={13} /> {selected.fit}% fit</span></div><div className="design-preview-card"><div className="design-preview-card-top"><span className="design-live-dot" /><span>ELIAS TOKENS APPLIED</span><small>Space Grotesk · violet · 18px radius</small></div><div className="design-preview-content"><div className="design-preview-spark"><Sparkles size={18} /></div><div><strong>{selected.name}</strong><p>Adapted for Elias mobile surfaces with consistent spacing, contrast, focus states, and touch targets.</p></div></div></div><div className="design-qa-grid"><div><Check size={14} /><span><strong>Responsive</strong><small>540px mobile checked</small></span></div><div><Check size={14} /><span><strong>Accessible</strong><small>Focus and contrast checked</small></span></div><div><Eye size={14} /><span><strong>Preview only</strong><small>No repository changes</small></span></div></div><button type="button" className="primary wide" onClick={() => setApplied(true)}>{applied ? <><Check size={15} /> Added to Agent review queue</> : <><Figma size={15} /> Add to Agent review queue</>}</button></section>
  </main></AppShell>;
}
