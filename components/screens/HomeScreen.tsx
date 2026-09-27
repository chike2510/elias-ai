"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, Code2, FileText, Globe2, ListChecks, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

const prompts = [
  { href: "/chat?prompt=Review%20this%20project%20and%20propose%20the%20highest-value%20engineering%20improvements", label: "Review code", icon: Code2 },
  { href: "/chat?prompt=Research%20this%20question%20using%20current%20sources%20and%20cite%20the%20evidence", label: "Research", icon: Globe2 },
  { href: "/chat?prompt=Teach%20me%20this%20topic%20like%20an%20exam%20tutor", label: "Study", icon: BookOpen },
];

export default function HomeScreen() {
  return <AppShell><main className="screen clean-home-screen">
    <div className="home-plan-badge"><span>ELIAS / WORKSPACE</span><span>·</span><Link href="/profile">Customize</Link></div>
    <section className="clean-home-welcome"><div className="clean-home-mark"><Sparkles size={26} /></div><span className="home-kicker">YOUR INTELLIGENCE LAYER</span><h1>What would you like to accomplish?</h1><p>Give Elias a direction. We’ll help you turn it into useful work.</p></section>
    <Composer onSubmit={(value) => { window.location.href = `/chat?prompt=${encodeURIComponent(value)}`; }} />
    <nav className="clean-prompt-row" aria-label="Suggested prompts">{prompts.map(({ href, label, icon: Icon }) => <Link key={label} href={href}><Icon size={15} /><span>{label}</span></Link>)}</nav>
    <section className="home-work-grid"><div className="home-section-heading"><span>START WITH A DIRECTION</span><small>Choose a path or write your own.</small></div><div className="home-work-cards"><Link href={prompts[1].href}><Globe2 size={18} /><strong>Research</strong><small>Find current sources and make sense of them.</small><ArrowUpRight size={14} /></Link><Link href={prompts[0].href}><Code2 size={18} /><strong>Build</strong><small>Review a project, fix a bug, or ship a feature.</small><ArrowUpRight size={14} /></Link><Link href={prompts[2].href}><BookOpen size={18} /><strong>Study</strong><small>Turn a topic into a practical learning plan.</small><ArrowUpRight size={14} /></Link><Link href="/tasks"><ListChecks size={18} /><strong>Plan work</strong><small>Break a complex request into visible steps.</small><ArrowUpRight size={14} /></Link></div></section>
    <section className="home-recent-strip"><div><span className="home-section-heading">RECENT WORK</span><p>Your conversations, files, and project context stay close by.</p></div><Link href="/files">Open Library <FileText size={14} /></Link></section>
  </main></AppShell>;
}
