"use client";

import Link from "next/link";
import { BookOpen, Code2, FileText, Globe2, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";
import ProjectCard from "@/components/ProjectCard";

const recent = [
  ["StoreOS","E-commerce platform","Yesterday","code"],
  ["Edge X","Analytics dashboard","2 days ago","code"],
  ["CSC 428 Study Guide","Memory Management","4 days ago","study"],
  ["Personal Portfolio","Next.js + Tailwind","1 week ago","code"]
] as const;

export default function HomeScreen() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "good morning" : hour < 18 ? "good afternoon" : "good evening";

  return <AppShell>
    <main className="screen home-screen">
      <div className="hero">
        <p className="eyebrow">{greeting}</p>
        <h1>what are we<br/>building today?</h1>
      </div>

      <Composer onSubmit={(text) => { window.location.href = `/chat?prompt=${encodeURIComponent(text)}`; }} />

      <div className="quick-grid">
        <Link href="/projects/storeos/code" className="quick-card"><span><Code2 size={21}/></span><strong>Code</strong><small>build anything</small></Link>
        <Link href="/research" className="quick-card"><span><Globe2 size={21}/></span><strong>Research</strong><small>search the web</small></Link>
        <Link href="/study" className="quick-card"><span><BookOpen size={21}/></span><strong>Study</strong><small>learn anything</small></Link>
        <Link href="/chat" className="quick-card"><span><Sparkles size={21}/></span><strong>Create</strong><small>generate content</small></Link>
      </div>

      <div className="section-head"><h2>Recent projects</h2><Link href="/projects">View all <span>›</span></Link></div>
      <div className="project-list">
        {recent.map(([name,type,time,kind]) => <ProjectCard key={name} name={name} type={type} time={time} href={name === "StoreOS" ? "/projects/storeos" : "/projects"} />)}
      </div>

      <div className="capability-strip">
        <div><FileText size={16}/><span>files</span></div>
        <div><Globe2 size={16}/><span>web research</span></div>
        <div><Code2 size={16}/><span>code agents</span></div>
        <div><Sparkles size={16}/><span>multi-model</span></div>
      </div>
    </main>
  </AppShell>;
}