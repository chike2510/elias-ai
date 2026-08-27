"use client";

import Link from "next/link";
import { BookOpen, Code2, Globe2, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

const prompts = [
  { href: "/chat?prompt=Review%20this%20project%20and%20propose%20the%20highest-value%20engineering%20improvements", label: "Review code", icon: Code2 },
  { href: "/chat?prompt=Research%20this%20question%20using%20current%20sources%20and%20cite%20the%20evidence", label: "Research", icon: Globe2 },
  { href: "/chat?prompt=Teach%20me%20this%20topic%20like%20an%20exam%20tutor", label: "Study", icon: BookOpen },
];

export default function HomeScreen() {
  return <AppShell><main className="screen clean-home-screen">
    <div className="home-plan-badge"><span>Free plan</span><span>·</span><Link href="/profile">Upgrade</Link></div>
    <section className="clean-home-welcome"><div className="clean-home-mark"><Sparkles size={26} /></div><h1>What are we working on?</h1><p>Ask Elias anything or describe an outcome.</p></section>
    <Composer onSubmit={(value) => { window.location.href = `/chat?prompt=${encodeURIComponent(value)}`; }} />
    <nav className="clean-prompt-row" aria-label="Suggested prompts">{prompts.map(({ href, label, icon: Icon }) => <Link key={label} href={href}><Icon size={15} /><span>{label}</span></Link>)}</nav>
    <p className="clean-home-note">Your chats, projects, files, and tasks stay connected in the navigation drawer.</p>
  </main></AppShell>;
}
