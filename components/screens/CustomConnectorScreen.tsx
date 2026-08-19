"use client";

import Link from "next/link";
import { ArrowLeft, Check, Link2, Server, ShieldCheck } from "lucide-react";
import { useState } from "react";
import AppShell from "@/components/AppShell";

export default function CustomConnectorScreen({ type = "custom_api" }: { type?: string }) {
  const isMcp = type === "custom_mcp";
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [status, setStatus] = useState("");
  function saveDraft() { if (!name.trim() || !endpoint.trim()) { setStatus("Add a name and endpoint."); return; } setStatus("Draft saved. Elias will require a server-side connection test before enabling tools."); }
  return <AppShell title={isMcp ? "Custom MCP" : "Custom API"}><main className="screen custom-connector-screen"><div className="mobile-screen-heading"><Link href="/connectors" aria-label="Back to connectors"><ArrowLeft size={19} /></Link><h1>{isMcp ? "Custom MCP" : "Custom API"}</h1><span /></div><section className="custom-connector-hero panel"><span className="connector-hero-icon">{isMcp ? <Server size={24} /> : <Link2 size={24} />}</span><h2>{isMcp ? "Add an MCP server" : "Add an API"}</h2><p>Define the connection first. Elias will discover tools, show permissions, and keep execution approval-gated.</p></section><section className="connector-auth-card"><label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder={isMcp ? "Analytics MCP" : "Internal API"} /></label><label>Endpoint<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={isMcp ? "https://example.com/mcp" : "https://api.example.com"} /></label><button type="button" className="primary wide" onClick={saveDraft}>Save connection draft</button>{status ? <p className="inline-status"><Check size={14} /> {status}</p> : null}</section><section className="connector-note"><ShieldCheck size={17} /><span><strong>Permission-first</strong><small>Credentials are not stored in this draft. Tool execution and write permissions require a separate server-side connection and explicit approval.</small></span></section></main></AppShell>;
}
