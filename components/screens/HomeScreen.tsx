"use client";

import Link from "next/link";
import { BookOpen, Code2, FileText, Globe2, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

export default function HomeScreen() {
  return (
    <AppShell>
      <main className="screen home-screen">
        <div className="hero">
          <p className="eyebrow">your intelligence layer</p>
          <h1>what are we<br />working on today?</h1>
        </div>

        <Composer
          onSubmit={(value) => {
            window.location.href = `/chat?prompt=${encodeURIComponent(value)}`;
          }}
        />

        <div className="quick-grid">
          <Link href="/agent" className="quick-card">
            <span><Code2 size={21} /></span>
            <strong>Code</strong>
            <small>build anything</small>
          </Link>

          <Link href="/research" className="quick-card">
            <span><Globe2 size={21} /></span>
            <strong>Research</strong>
            <small>live web data</small>
          </Link>

          <Link href="/study" className="quick-card">
            <span><BookOpen size={21} /></span>
            <strong>Study</strong>
            <small>documents & notes</small>
          </Link>

          <Link href="/chat" className="quick-card">
            <span><Sparkles size={21} /></span>
            <strong>Chat</strong>
            <small>talk to ELIAS</small>
          </Link>
        </div>

        <div className="section-head">
          <h2>capabilities</h2>
          <Link href="/projects">your projects <span>›</span></Link>
        </div>

        <div className="capability-strip">
          <div><FileText size={16} /><span>files + ZIP</span></div>
          <div><Globe2 size={16} /><span>web research</span></div>
          <div><Code2 size={16} /><span>long code</span></div>
          <div><Sparkles size={16} /><span>multi-model</span></div>
        </div>
      </main>
    </AppShell>
  );
}
