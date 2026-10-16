"use client";

import Link from "next/link";
import { ArrowLeft, Brain, ChevronRight, CircleDot, Code2, CreditCard, Database, Github, Globe2, Plus, Search, Send, Server, Sparkles, SquareCode } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "@/components/brain.css";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import GoogleStatusRow, { GoogleReturnNotice } from "@/components/google/GoogleStatusRow";
import { api, type Status } from "@/lib/chatClient";
import { CONNECTOR_REGISTRY, categoryLabel, type ConnectorCategory, type ConnectorDefinition } from "@/lib/connectors";

type UserState = { githubConnected?: boolean; vercelConnected?: boolean };
const icons: Record<string, React.ReactNode> = { github: <Github size={21} />, vercel: <span className="vercel-glyph">▲</span>, drive: <Globe2 size={21} />, notion: <CircleDot size={21} />, slack: <Sparkles size={21} />, api: <Code2 size={21} />, mcp: <Server size={21} /> };

export default function ConnectorsScreen() {
  const [user, setUser] = useState<UserState>({});
  const [category, setCategory] = useState<ConnectorCategory>("app");
  const [query, setQuery] = useState("");
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => setUser(data.user || {})).catch(() => undefined); }, []);
  const visible = useMemo(() => CONNECTOR_REGISTRY.filter((connector) => connector.category === category && `${connector.name} ${connector.description} ${connector.tools.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [category, query]);
  function connected(connector: ConnectorDefinition) { return connector.id === "github" ? Boolean(user.githubConnected) : connector.id === "vercel" ? Boolean(user.vercelConnected) : false; }
  return <AppShell title="Connectors"><main className="screen connectors-screen"><div className="mobile-screen-heading"><Link href="/you" aria-label="Back to You"><ArrowLeft size={19} /></Link><h1>Connectors</h1><Link className="icon-btn" href="/connectors/custom?type=custom_api" aria-label="Add connector"><Plus size={21} /></Link></div><AssistantConnections /><div className="connector-search searchbox"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search connectors" /></div><div className="connector-tabs">{(["app", "custom_api", "custom_mcp"] as ConnectorCategory[]).map((item) => <button type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{categoryLabel(item)}</button>)}</div><section className="connector-list">{visible.map((connector) => { const isConnected = connected(connector); const content = <><span className={`connector-card-icon connector-icon-${connector.icon}`}>{icons[connector.icon] || <SquareCode size={21} />}</span><span className="connector-card-copy"><strong>{connector.name}{connector.status === "planned" ? <small className="connector-beta">Soon</small> : null}</strong><small>{connector.description}</small><em>{isConnected ? "Connected" : connector.status === "planned" ? "Coming soon" : `${connector.auth === "oauth" ? "OAuth" : connector.auth === "token" ? "Token" : "Configure"} · ${connector.tools.length} tools`}</em></span><ChevronRight size={18} /></>; return connector.href && connector.status === "available" ? <Link className="connector-card" href={connector.href} key={connector.id}>{content}</Link> : connector.category !== "app" ? <Link className="connector-card" href={`/connectors/custom?type=${connector.category}`} key={connector.id}>{content}</Link> : <div className="connector-card connector-card-disabled" key={connector.id}>{content}</div>; })}</section><p className="connector-registry-note"><Sparkles size={14} /> Tools and permissions are reviewed before Elias can use them.</p></main></AppShell>;
}

/** Google (Gmail + Calendar) and the remote browser, with a clear "not configured yet" state. */
function AssistantConnections() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = () => { setFailed(false); void api<Status>("/api/assistant/status").then(setStatus).catch(() => setFailed(true)); };
  useEffect(load, []);
  async function disconnect() { setBusy(true); await api("/api/connect/google/disconnect", { method: "POST", body: "{}" }).catch(() => undefined); setStatus((current) => current ? { ...current, google: { ...current.google, connected: false, email: null, status: "none", renewBy: null, expiresSoon: false, drive: false } } : current); setBusy(false); }
  if (!status) return <section className="el-section el-connections" aria-busy={!failed}><h2>Personal assistant</h2>{failed ? <div className="el-inline-error" role="alert"><span>Couldn't check your connections.</span><button type="button" onClick={load}>Retry</button></div> : <ListSkeleton rows={3} />}</section>;
  return <section className="el-section el-connections"><h2>Personal assistant</h2><GoogleReturnNotice /><ul className="el-list">
    <li><GoogleStatusRow google={status.google} returnTo="/connectors" icon={<Globe2 size={17} />} busy={busy} onDisconnect={() => void disconnect()} /></li>
    <ConnectorRow icon={<Server size={17} />} name="Browser" summary="Remote browser for forms, carts and bookings" state={status.browser.configured ? "on" : "na"} stateLabel={status.browser.configured ? "Ready" : "Not set up"} detail={status.browser.configured ? "Runs on Cloudflare Browser Run, with Browserbase as the fallback." : "The server needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_BROWSER_TOKEN (or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID)."} />
    {status.connectors ? <AgentConnectorRows connectors={status.connectors} /> : null}
  </ul>
  <p className="el-conn-note">Payments are read-only: Elias can read balances and transactions, never move money. Redeploys and new issues always ask first.</p></section>;
}

/**
 * One connector row: a plain summary up front; setup notes (env vars, modes) only show when you tap it.
 */
function ConnectorRow({ icon, name, summary, detail, state, stateLabel, href, hrefLabel }: { icon: React.ReactNode; name: string; summary: string; detail?: string; state: "on" | "off" | "na"; stateLabel: string; href?: string; hrefLabel?: string }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(detail || href);
  const head = <><span className="el-list-icon">{icon}</span><span className="el-list-text"><strong>{name}</strong><small>{summary}</small></span><span className={`el-state ${state}`}>{stateLabel}</span>{expandable ? <ChevronRight size={16} className={`el-conn-chevron${open ? " open" : ""}`} aria-hidden /> : null}</>;
  return <li className={`el-conn-row${open ? " open" : ""}`}>
    {expandable ? <button type="button" className="el-list-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{head}</button> : <div className="el-list-row static">{head}</div>}
    {open ? <div className="el-conn-detail">{detail ? <p>{detail}</p> : null}{href ? <Link className="el-btn-sm" href={href}>{hrefLabel || "Open"}</Link> : null}</div> : null}
  </li>;
}

/** Status of the env-gated agent connectors (GitHub, Vercel, Supabase, Telegram, Paystack, Flutterwave, memory search). */
function AgentConnectorRows({ connectors }: { connectors: NonNullable<Status["connectors"]> }) {
  const telegramPending = connectors.telegram.configured && !connectors.telegram.linked;
  const rows: Array<{ icon: React.ReactNode; name: string; on: boolean; pending?: boolean; summary: string; detail: string; href?: string; hrefLabel?: string }> = [
    { icon: <Github size={17} />, name: "GitHub tools", on: connectors.github.configured, summary: "Issues, PRs and CI", detail: !connectors.github.configured ? "Connect GitHub, or the owner sets GITHUB_TOKEN." : connectors.github.source === "oauth" ? "Uses your connected GitHub account." : "Uses the server's GITHUB_TOKEN.", href: "/connectors/github", hrefLabel: "Manage" },
    { icon: <span className="vercel-glyph">▲</span>, name: "Vercel", on: connectors.vercel.configured, summary: "Projects and deployments", detail: connectors.vercel.configured ? "Redeploys always ask first." : "Needs VERCEL_API_TOKEN on the server." },
    { icon: <Database size={17} />, name: "Supabase health", on: connectors.supabase.configured, summary: "Database health checks", detail: !connectors.supabase.configured ? "Needs POSTGRES_URL." : connectors.supabase.mode === "management" ? "Service health and security advisors." : "Database check only. Add SUPABASE_ACCESS_TOKEN for service health and security advisors." },
    { icon: <Send size={17} />, name: "Telegram", on: connectors.telegram.configured && connectors.telegram.linked, pending: telegramPending, summary: connectors.telegram.linked && connectors.telegram.username ? `Linked · @${connectors.telegram.username}` : "Chat with Elias on Telegram", detail: connectors.telegram.linked ? "Your Telegram chat is linked." : telegramPending ? "Ready: link your chat on the You page." : "Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (bot from @BotFather).", href: telegramPending ? "/you" : undefined, hrefLabel: "Link chat" },
    { icon: <CreditCard size={17} />, name: "Paystack", on: connectors.paystack.configured, summary: "Transactions and balance", detail: connectors.paystack.configured ? "Read-only: Elias never moves money." : "Needs PAYSTACK_SECRET_KEY (read-only use)." },
    { icon: <CreditCard size={17} />, name: "Flutterwave", on: connectors.flutterwave.configured, summary: "Transactions and balances", detail: connectors.flutterwave.configured ? "Read-only: Elias never moves money." : "Needs FLUTTERWAVE_SECRET_KEY (read-only use)." },
    { icon: <Brain size={17} />, name: "Memory search", on: connectors.embeddings.configured, summary: "Meaning-based recall", detail: connectors.embeddings.configured ? "Free gte-small embeddings." : "Keyword recall only: embeddings aren't configured." },
  ];
  return <>{rows.map((row) => <ConnectorRow key={row.name} icon={row.icon} name={row.name} summary={row.summary} detail={row.detail} href={row.href} hrefLabel={row.hrefLabel} state={row.on ? "on" : row.pending ? "off" : "na"} stateLabel={row.on ? "On" : row.pending ? "Link" : "Not set up"} />)}</>;
}
