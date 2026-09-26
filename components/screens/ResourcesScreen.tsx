"use client";
import { ArrowUpRight, BookOpen, Boxes, Code2, GitBranch, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { developerResources } from "@/lib/developerResources";

const icons = { Learn: BookOpen, Build: Code2, Explore: Search, Architecture: Boxes, Interview: GitBranch };
export default function ResourcesScreen() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const visible = useMemo(() => developerResources.filter((item) => {
    const matchesCategory = category === "All" || item.category === category;
    const text = `${item.name} ${item.owner} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
    return matchesCategory && text.includes(query.toLowerCase().trim());
  }), [category, query]);
  return <AppShell title="Resources"><main className="screen resources-screen">
    <header className="screen-header resources-header"><div className="screen-header-copy"><span className="eyebrow">CURATED TOOLKIT</span><h1>Developer resources</h1><p className="screen-description">A focused shelf of repositories ELIAS can use to help you learn, build, and ship.</p></div><Link className="secondary resources-chat-link" href="/chat?prompt=Recommend%20the%20best%20developer%20resources%20for%20my%20goal"><Sparkles size={15} /> Ask ELIAS</Link></header>
    <div className="resource-toolbar"><label className="searchbox"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resources" /></label><div className="resource-filters" aria-label="Resource categories">{["All", "Learn", "Build", "Explore", "Architecture", "Interview"].map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
    <section className="resource-grid" aria-label="Developer resources">{visible.map((item) => { const Icon = icons[item.category]; return <article className="resource-card" key={item.slug}><div className="resource-card-top"><span className="resource-icon"><Icon size={17} /></span><span className="resource-category">{item.category}</span></div><h2>{item.name}</h2><p>{item.description}</p><div className="resource-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><a href={item.url} target="_blank" rel="noreferrer">Open on GitHub <ArrowUpRight size={14} /></a></article>; })}</section>
    {!visible.length ? <div className="empty-state panel"><Search size={22} /><b>No resources match that search</b><small>Try a broader goal, like APIs, architecture, or projects.</small></div> : null}
  </main></AppShell>;
}
