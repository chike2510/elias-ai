"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, CircleDot, Code2, Github, Globe2, Plus, Search, Server, Sparkles, SquareCode } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
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
  return <AppShell title="Connectors"><main className="screen connectors-screen"><div className="mobile-screen-heading"><Link href="/profile" aria-label="Back to profile"><ArrowLeft size={19} /></Link><h1>Connectors</h1><Link className="icon-btn" href="/connectors/custom?type=custom_api" aria-label="Add connector"><Plus size={21} /></Link></div><div className="connector-search searchbox"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search connectors" /></div><div className="connector-tabs">{(["app", "custom_api", "custom_mcp"] as ConnectorCategory[]).map((item) => <button type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{categoryLabel(item)}</button>)}</div><section className="connector-list">{visible.map((connector) => { const isConnected = connected(connector); const content = <><span className={`connector-card-icon connector-icon-${connector.icon}`}>{icons[connector.icon] || <SquareCode size={21} />}</span><span className="connector-card-copy"><strong>{connector.name}{connector.status === "planned" ? <small className="connector-beta">Soon</small> : null}</strong><small>{connector.description}</small><em>{isConnected ? "Connected" : connector.status === "planned" ? "Coming soon" : `${connector.auth === "oauth" ? "OAuth" : connector.auth === "token" ? "Token" : "Configure"} · ${connector.tools.length} tools`}</em></span><ChevronRight size={18} /></>; return connector.href && connector.status === "available" ? <Link className="connector-card" href={connector.href} key={connector.id}>{content}</Link> : connector.category !== "app" ? <Link className="connector-card" href={`/connectors/custom?type=${connector.category}`} key={connector.id}>{content}</Link> : <div className="connector-card connector-card-disabled" key={connector.id}>{content}</div>; })}</section><p className="connector-registry-note"><Sparkles size={14} /> Tools and permissions are reviewed before Elias can use them.</p></main></AppShell>;
}
