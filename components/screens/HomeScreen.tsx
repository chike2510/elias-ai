"use client";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Code2, FileText, FolderKanban, Globe2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";
import { getArtifacts, type ArtifactRecord } from "@/lib/persistence";

const prompts = [
  { label: "Review a project", icon: Code2, prompt: "Review this project and propose the highest-value engineering improvements" },
  { label: "Research a question", icon: Globe2, prompt: "Research this question using current sources and cite the evidence" },
  { label: "Learn a topic", icon: BookOpen, prompt: "Teach me this topic with a practical study plan" },
];
export default function HomeScreen() {
  const [recent, setRecent] = useState<ArtifactRecord[]>([]);
  useEffect(() => { void getArtifacts().then((items) => setRecent(items.slice(0, 3))).catch(() => setRecent([])); }, []);
  return <AppShell><main className="screen objective-home-screen">
    <div className="home-plan-badge"><span>ELIAS workspace</span><span>·</span><Link href="/profile">Customize</Link></div>
    <section className="objective-hero"><div className="objective-kicker"><span className="objective-mark"><Sparkles size={16} /></span><span>YOUR INTELLIGENCE LAYER</span></div><h1>What would you like to accomplish?</h1><p>Describe the outcome in your own words. ELIAS will help clarify the work, gather context, and turn it into something usable.</p></section>
    <Composer onSubmit={(value) => { window.location.href = `/chat?prompt=${encodeURIComponent(value)}`; }} />
    <nav className="objective-prompts" aria-label="Suggested objectives">{prompts.map(({ label, icon: Icon, prompt }) => <Link key={label} href={`/chat?prompt=${encodeURIComponent(prompt)}`}><Icon size={15} /><span>{label}</span><ArrowUpRight size={13} /></Link>)}</nav>
    <section className="objective-path" aria-label="How ELIAS works"><div><span>01</span><strong>Describe</strong><small>Start with the goal, not the tool.</small></div><div><span>02</span><strong>Work together</strong><small>ELIAS researches, codes, or drafts with you.</small></div><div><span>03</span><strong>Keep the outcome</strong><small>Your useful work stays in your library.</small></div></section>
    <section className="recent-outcomes-home"><div className="section-head"><div><span className="eyebrow">CONTINUE WHERE YOU LEFT OFF</span><h2>Recent outcomes</h2></div><Link href="/outcomes">View all <ArrowUpRight size={13} /></Link></div>{recent.length ? <div className="recent-outcome-grid">{recent.map((item) => <Link href="/outcomes" className="recent-outcome-card" key={item.id}><FileText size={17} /><span><strong>{item.name}</strong><small>{item.summary || "Open the finished work"}</small></span><ArrowUpRight size={14} /></Link>)}</div> : <div className="home-empty-outcomes"><FolderKanban size={18} /><span><strong>Your outcomes will appear here</strong><small>Start an objective and ELIAS will save the result for later.</small></span><Link href="/resources">Browse resources</Link></div>}</section>
  </main></AppShell>;
}
