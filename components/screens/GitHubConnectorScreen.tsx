"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, Github, Link2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

export default function GitHubConnectorScreen() {
  const [connected, setConnected] = useState(false);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((d) => setConnected(Boolean(d.user?.githubConnected))).catch(() => undefined); }, []);
  return <AppShell title="GitHub"><main className="screen connector-detail-screen"><div className="mobile-screen-heading"><Link href="/connectors" aria-label="Back to connectors"><ArrowLeft size={19} /></Link><h1>GitHub</h1><span className="detail-menu">•••</span></div><section className="connector-hero-card"><span className="connector-hero-icon"><Github size={31} /></span><h2>GitHub</h2><p>Access repositories, review code changes, track issues, and connect project context to Elias.</p></section><section className="detail-list"><div><span>Connector type</span><strong>OAuth App</strong></div><div><span>Authorization</span><strong>{connected ? "This Elias account" : "Not connected"}</strong></div><div><span>Provider</span><strong>GitHub</strong></div></section><section className="connector-auth-card">{connected ? <div className="connected-heading"><CheckCircle2 size={18} /><span><strong>GitHub connected</strong><small>This Elias account can use its authorized repositories.</small></span></div> : <><div className="auth-heading"><Link2 size={18} /><span><strong>Authorize GitHub</strong><small>GitHub will open its confirmation screen. Choose the repositories Elias may access.</small></span></div><a className="primary wide connector-cta" href="/api/connect/github"><ShieldCheck size={15} /> Authorize GitHub account</a></>}<p className="connector-help">If GitHub returns an error, confirm the callback URL is <code>https://elias-ai-chi.vercel.app/api/connect/github/callback</code>.</p></section><div className="connector-links"><a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">GitHub Developer Settings <ExternalLink size={13} /></a><a href="/docs/AUTH_AND_CONNECTORS.md">Elias connector setup <ExternalLink size={13} /></a></div></main></AppShell>;
}
