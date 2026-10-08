"use client";

import Link from "next/link";
import { ArrowLeft, Brain, ChevronRight, CircleDot, Code2, CreditCard, Database, Github, Globe2, Plus, Search, Send, Server, Sparkles, SquareCode } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "@/components/brain.css";
import AppShell from "@/components/AppShell";
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
  useEffect(() => { void api<Status>("/api/assistant/status").then(setStatus).catch(() => undefined); }, []);
  async function disconnect() { setBusy(true); await api("/api/connect/google/disconnect", { method: "POST", body: "{}" }).catch(() => undefined); setStatus((current) => current ? { ...current, google: { ...current.google, connected: false, email: null } } : current); setBusy(false); }
  if (!status) return null;
  return <section className="el-section el-connections"><h2>Personal assistant</h2><ul className="el-list">
    <li><div className="el-list-row static"><span className="el-list-icon"><Globe2 size={17} /></span><span className="el-list-text"><strong>Google</strong><small>{status.google.connected ? `Gmail & Calendar · ${status.google.email || "connected"}` : status.google.configured ? "Gmail & Calendar. Sending and invites always ask first." : "Not configured yet: the server needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."}</small></span>
      {status.google.connected ? <button type="button" className="el-btn el-btn-sm" disabled={busy} onClick={() => void disconnect()}>Disconnect</button> : status.google.configured ? <a className="el-btn el-btn-primary el-btn-sm" href="/api/connect/google?return=/connectors">Connect</a> : <span className="el-state na">Not configured yet</span>}</div></li>
    <li><div className="el-list-row static"><span className="el-list-icon"><Server size={17} /></span><span className="el-list-text"><strong>Browser</strong><small>{status.browser.configured ? "Remote browser for forms, carts and bookings" : "Browser not configured: the server needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_BROWSER_TOKEN (or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID)."}</small></span><span className={`el-state ${status.browser.configured ? "on" : "na"}`}>{status.browser.configured ? "Ready" : "Not configured"}</span></div></li>
    {status.connectors ? <AgentConnectorRows connectors={status.connectors} /> : null}
  </ul>
  <p className="el-conn-note">Payments are read-only: Elias can read balances and transactions, never move money. Redeploys and new issues always ask first.</p></section>;
}

/** Status of the env-gated agent connectors (GitHub, Vercel, Supabase, Telegram, Paystack, Flutterwave, memory search). */
function AgentConnectorRows({ connectors }: { connectors: NonNullable<Status["connectors"]> }) {
  const rows: Array<{ icon: React.ReactNode; name: string; on: boolean; detail: string; off: string; href?: string }> = [
    { icon: <Github size={17} />, name: "GitHub tools", on: connectors.github.configured, detail: connectors.github.source === "oauth" ? "Issues, PRs and CI with your GitHub account" : "Issues, PRs and CI via the server token", off: "Connect GitHub, or the owner sets GITHUB_TOKEN.", href: "/connectors/github" },
    { icon: <span className="vercel-glyph">▲</span>, name: "Vercel", on: connectors.vercel.configured, detail: "Projects, deployments, redeploy (asks first)", off: "Needs VERCEL_API_TOKEN on the server." },
    { icon: <Database size={17} />, name: "Supabase health", on: connectors.supabase.configured, detail: connectors.supabase.mode === "management" ? "Service health and security advisors" : "Database check (add SUPABASE_ACCESS_TOKEN for service health)", off: "Needs POSTGRES_URL." },
    { icon: <Send size={17} />, name: "Telegram", on: connectors.telegram.configured && connectors.telegram.linked, detail: connectors.telegram.linked ? `Linked${connectors.telegram.username ? ` · @${connectors.telegram.username}` : ""}` : "Ready: link your chat on the You page", off: "Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (bot from @BotFather).", href: "/you" },
    { icon: <CreditCard size={17} />, name: "Paystack", on: connectors.paystack.configured, detail: "Transactions and balance (read-only)", off: "Needs PAYSTACK_SECRET_KEY (read-only use)." },
    { icon: <CreditCard size={17} />, name: "Flutterwave", on: connectors.flutterwave.configured, detail: "Transactions and balances (read-only)", off: "Needs FLUTTERWAVE_SECRET_KEY (read-only use)." },
    { icon: <Brain size={17} />, name: "Memory search", on: connectors.embeddings.configured, detail: "Meaning-based recall (free gte-small embeddings)", off: "Keyword recall only: embeddings aren't configured." },
  ];
  return <>{rows.map((row) => {
    const pending = row.name === "Telegram" && connectors.telegram.configured && !connectors.telegram.linked;
    const body = <><span className="el-list-icon">{row.icon}</span><span className="el-list-text"><strong>{row.name}</strong><small>{row.on || pending ? row.detail : row.off}</small></span><span className={`el-state ${row.on ? "on" : pending ? "off" : "na"}`}>{row.on ? "On" : pending ? "Link" : "Not set up"}</span></>;
    return <li key={row.name}>{row.href ? <Link className="el-list-row" href={row.href}>{body}</Link> : <div className="el-list-row static">{body}</div>}</li>;
  })}</>;
}
