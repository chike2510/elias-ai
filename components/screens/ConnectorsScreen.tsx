"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Github, Globe2, Plus, Server, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type UserState = { githubConnected?: boolean; vercelConnected?: boolean };

export default function ConnectorsScreen() {
  const [user, setUser] = useState<UserState>({});
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((d) => setUser(d.user || {})).catch(() => undefined); }, []);
  const cards = [
    { href: "/connectors/github", name: "GitHub", detail: "Manage repositories, track code changes, and collaborate on projects", type: "App", icon: <Github size={23} />, connected: Boolean(user.githubConnected) },
    { href: "/connectors/vercel", name: "Vercel", detail: "Manage Vercel projects, deployments, and build logs", type: "MCP", icon: <span className="vercel-glyph">▲</span>, connected: Boolean(user.vercelConnected) },
    { href: "/connectors/browser", name: "My Browser", detail: "Access the web through a separate browser session", type: "Browser", icon: <Globe2 size={23} />, connected: false },
  ];
  return <AppShell title="Connectors"><main className="screen connectors-screen"><div className="mobile-screen-heading"><Link href="/profile" aria-label="Back to profile"><ArrowLeft size={19} /></Link><h1>Connectors</h1><button className="icon-btn" aria-label="Add connector"><Plus size={21} /></button></div><p className="connectors-intro">Give Elias the right context for the work. Each connection is separate from your Elias account.</p><section className="connector-list">{cards.map((card) => <Link className="connector-card" href={card.href} key={card.name}><span className="connector-card-icon">{card.icon}</span><span className="connector-card-copy"><strong>{card.name}</strong><small>{card.detail}</small><em>{card.connected ? <><i className="live-dot" /> Connected · {card.type}</> : `${card.type} · Not connected`}</em></span><ChevronRight size={18} /></Link>)}</section><section className="connector-note"><Sparkles size={17} /><span><strong>Account-safe by design</strong><small>Connections are stored against the signed-in Elias account and never shared with another user.</small></span></section></main></AppShell>;
}
