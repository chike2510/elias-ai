"use client";

import Link from "next/link";
import { ArrowUpRight, Code2, FileText, Folder, Globe2, ListChecks, MessageSquare, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";

const actions = [
  { href: "/chat?prompt=Inspect%20this%20project%20and%20propose%20the%20highest-value%20engineering%20improvements", label: "Review a project", icon: Code2 },
  { href: "/chat?prompt=Research%20this%20question%20using%20current%20primary%20sources%20and%20cite%20the%20evidence", label: "Research", icon: Globe2 },
  { href: "/chat?prompt=Create%20a%20technical%20architecture%20document", label: "Create a file", icon: FileText },
];

const workspace = [
  { href: "/chat", label: "Chat", detail: "Your conversations", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", detail: "Active work and history", icon: ListChecks },
  { href: "/projects", label: "Projects", detail: "Open a workspace", icon: Folder },
  { href: "/files", label: "Library", detail: "Your files", icon: FileText },
];

export default function HomeScreen() {
  return <AppShell><main className="screen home-screen redesigned-home"><section className="home-compact-hero"><span className="eyebrow">ELIAS</span><h1>What do you want to do?</h1></section><Composer onSubmit={(value) => { window.location.href = `/chat?prompt=${encodeURIComponent(value)}`; }} /><section className="home-action-row">{actions.map(({ href, label, icon: Icon }) => <Link href={href} className="home-action-card" key={label}><Icon size={17} /><span>{label}</span><ArrowUpRight size={14} /></Link>)}</section><section className="home-workspace"><div className="section-head"><h2>Workspace</h2><Link href="/profile" aria-label="Open settings"><Sparkles size={14} /></Link></div><div className="home-workspace-grid">{workspace.map(({ href, label, detail, icon: Icon }) => <Link href={href} className="home-workspace-card" key={label}><span className="home-workspace-icon"><Icon size={17} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></Link>)}</div></section></main></AppShell>;
}
