"use client";

import Link from "next/link";
import { BookOpen, Code2, FileText, Globe2, ListChecks, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

export default function HomeScreen() {
  return (
    <AppShell>
      <main className="screen home-screen">
        <div className="hero task-home-hero">
          <p className="eyebrow">your intelligence workbench</p>
          <h1>start with the<br />outcome.</h1>
          <p className="hero-dek">ELIAS plans the work, shows the evidence, and keeps the deliverable recoverable.</p>
        </div>

        <Composer onSubmit={(value) => { window.location.href = `/tasks?prompt=${encodeURIComponent(value)}`; }} />

        <div className="task-home-links">
          <Link href="/tasks"><ListChecks size={17} /><span><strong>Start a task</strong><small>plan · act · verify</small></span><Sparkles size={15} /></Link>
          <Link href="/chat"><Sparkles size={17} /><span><strong>Open a conversation</strong><small>ask, explain, brainstorm</small></span><Sparkles size={15} /></Link>
        </div>

        <div className="section-head"><h2>choose a starting point</h2><Link href="/projects">your projects <span>›</span></Link></div>
        <div className="quick-grid">
          <Link href="/tasks?prompt=Inspect%20this%20project%20and%20propose%20the%20highest-value%20engineering%20improvements" className="quick-card"><span><Code2 size={21} /></span><strong>Code</strong><small>inspect & change</small></Link>
          <Link href="/tasks?prompt=Research%20this%20question%20using%20current%20primary%20sources%20and%20cite%20the%20evidence" className="quick-card"><span><Globe2 size={21} /></span><strong>Research</strong><small>sources & evidence</small></Link>
          <Link href="/tasks?prompt=Turn%20these%20documents%20into%20clear%20study%20notes%20and%20practice%20questions" className="quick-card"><span><BookOpen size={21} /></span><strong>Study</strong><small>documents & notes</small></Link>
          <Link href="/files" className="quick-card"><span><FileText size={21} /></span><strong>Artifacts</strong><small>outputs & reports</small></Link>
        </div>

        <div className="capability-strip"><div><ListChecks size={16} /><span>task plans</span></div><div><ShieldIcon /><span>evidence trail</span></div><div><Code2 size={16} /><span>workspace edits</span></div><div><Sparkles size={16} /><span>multi-model</span></div></div>
      </main>
    </AppShell>
  );
}

function ShieldIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
}
