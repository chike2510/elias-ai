"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, Code2, FileText, Folder, Globe2, ListChecks, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

const suggestions = [
  { href: "/tasks?prompt=Inspect%20this%20project%20and%20propose%20the%20highest-value%20engineering%20improvements", label: "Audit a project", detail: "Review health, risks, and recommendations.", icon: Code2 },
  { href: "/tasks?prompt=Research%20this%20question%20using%20current%20primary%20sources%20and%20cite%20the%20evidence", label: "Research with evidence", detail: "Find and synthesize trustworthy sources.", icon: Globe2 },
  { href: "/tasks?prompt=Create%20a%20technical%20architecture%20document%20with%20clear%20sections%20and%20a%20downloadable%20deliverable", label: "Create a deliverable", detail: "Draft reports, plans, or briefs.", icon: FileText },
];

export default function HomeScreen() {
  return (
    <AppShell>
      <main className="screen home-screen redesigned-home">
        <section className="task-home-hero">
          <p className="eyebrow">ELIAS / command center</p>
          <h1>What do you want<br />to get done?</h1>
          <p className="hero-dek">Describe your objective. ELIAS will plan the work, show the evidence, and keep the deliverable recoverable.</p>
        </section>

        <Composer onSubmit={(value) => { window.location.href = `/tasks?prompt=${encodeURIComponent(value)}`; }} />

        <section className="suggestion-section">
          <div className="section-head"><h2>Try these</h2><Link href="/chat">Ask in chat <ArrowUpRight size={14} /></Link></div>
          <div className="quick-grid redesigned-suggestions">{suggestions.map(({ href, label, detail, icon: Icon }) => <Link href={href} className="quick-card" key={label}><span><Icon size={20} /></span><strong>{label}</strong><small>{detail}</small><ArrowUpRight className="card-arrow" size={15} /></Link>)}</div>
        </section>

        <div className="home-columns">
          <section className="home-work panel empty-home-panel">
            <div className="section-head"><h2>Active task</h2><Link href="/tasks">Open tasks <ArrowUpRight size={14} /></Link></div>
            <div className="user-empty-state"><ListChecks size={20} /><strong>No active tasks yet</strong><small>Describe an outcome above and Elias will create a plan you can follow.</small><Link className="secondary" href="/tasks">Start a task</Link></div>
          </section>
          <section className="home-projects panel empty-home-panel">
            <div className="section-head"><h2>Connected projects</h2><Link href="/projects">Manage <ArrowUpRight size={14} /></Link></div>
            <div className="user-empty-state"><Folder size={20} /><strong>No projects connected</strong><small>Use + Add in Chat or open Projects to connect GitHub and Vercel.</small><Link className="secondary" href="/projects">Connect a project</Link></div>
          </section>
        </div>

        <section className="recent-home panel empty-home-panel">
          <div className="section-head"><h2>Recent work</h2><Link href="/tasks">View history <ArrowUpRight size={14} /></Link></div>
          <div className="user-empty-state horizontal"><Sparkles size={20} /><span><strong>Your history will appear here</strong><small>Completed tasks and deliverables will be saved to your account.</small></span></div>
        </section>

        <div className="capability-strip"><div><ListChecks size={16} /><span>task plans</span></div><div><Globe2 size={16} /><span>evidence trail</span></div><div><Code2 size={16} /><span>workspace edits</span></div><div><BookOpen size={16} /><span>recoverable outputs</span></div></div>
      </main>
    </AppShell>
  );
}
