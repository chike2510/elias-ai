"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, Code2, FileText, Folder, Globe2, ListChecks, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

const quickActions = [
  { href: "/tasks", label: "Start a task", detail: "plan · act · verify", icon: ListChecks },
  { href: "/chat", label: "Open a conversation", detail: "ask, explain, brainstorm", icon: MessageSquare },
];

const startingPoints = [
  { href: "/chat?prompt=Inspect%20this%20project%20and%20propose%20the%20highest-value%20engineering%20improvements", label: "Code", detail: "inspect & change", icon: Code2 },
  { href: "/chat?prompt=Research%20this%20question%20using%20current%20primary%20sources%20and%20cite%20the%20evidence", label: "Research", detail: "sources & evidence", icon: Globe2 },
  { href: "/chat?prompt=Teach%20me%20this%20topic%20like%20an%20exam%20tutor", label: "Study", detail: "documents & notes", icon: BookOpen },
  { href: "/files", label: "Artifacts", detail: "outputs & reports", icon: FileText },
];

const capabilities = [
  { href: "/tasks", label: "task plans", icon: ListChecks },
  { href: "/approvals", label: "evidence trail", icon: ShieldCheck },
  { href: "/agent", label: "workspace edits", icon: Code2 },
  { href: "/skills", label: "multi-model", icon: Sparkles },
];

export default function HomeScreen() {
  return <AppShell><main className="screen home-screen redesigned-home">
    <section className="home-hero">
      <p className="eyebrow">YOUR INTELLIGENCE WORKBENCH</p>
      <h1>Start with the<br />outcome.</h1>
      <p className="home-hero-copy">ELIAS plans the work, shows the evidence, and keeps every deliverable recoverable.</p>
    </section>

    <Composer onSubmit={(value) => { window.location.href = `/chat?prompt=${encodeURIComponent(value)}`; }} />

    <section className="home-quick-actions" aria-label="Quick actions">
      {quickActions.map(({ href, label, detail, icon: Icon }) => <Link href={href} className="home-quick-card" key={label}><Icon size={16} /><span><strong>{label}</strong><small>{detail}</small></span><Sparkles size={15} /></Link>)}
    </section>

    <section className="home-start-section">
      <div className="section-head"><h2>Choose a starting point</h2><Link href="/projects">your projects <ArrowUpRight size={13} /></Link></div>
      <div className="home-start-grid">{startingPoints.map(({ href, label, detail, icon: Icon }) => <Link href={href} className="home-start-card" key={label}><span className="home-start-icon"><Icon size={17} /></span><strong>{label}</strong><small>{detail}</small></Link>)}</div>
    </section>

    <nav className="home-capability-row" aria-label="Elias capabilities">{capabilities.map(({ href, label, icon: Icon }) => <Link href={href} key={label}><Icon size={13} /><span>{label}</span></Link>)}</nav>

    <section className="home-workspace-note"><Folder size={15} /><span><strong>Your workspace</strong><small>Projects, files, and active work stay connected.</small></span><Link href="/projects" aria-label="Open workspace"><ArrowUpRight size={15} /></Link></section>
  </main></AppShell>;
}
