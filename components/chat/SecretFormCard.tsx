"use client";

import { Check, ExternalLink, KeyRound, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/chatClient";
import type { SecretFormCard as SecretFormInfo } from "@/lib/assistant/cards";
import { sendAsUser } from "@/components/chat/VaultFormCard";

/** Secure API-key form inside the chat (MCP servers). Posts straight to /api/mcp/servers; the key never enters the conversation. */
export default function SecretFormCard({ card }: { card: SecretFormInfo }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function save() {
    setState("saving"); setError("");
    try {
      const data = await api<{ server: { name: string } }>("/api/mcp/servers", { method: "POST", body: JSON.stringify({ preset: card.preset, key }) });
      setKey(""); setState("saved");
      sendAsUser(`I connected ${data.server.name}. Carry on.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't connect it."); setState("idle"); }
  }

  if (state === "saved") return <section className="el-card el-card-compact" aria-label="Connected"><Check size={15} /><span><strong>Connected</strong><small>Key stored encrypted</small></span></section>;
  return <section className="el-card" aria-label={card.title}>
    <header style={{ display: "flex", gap: 8, alignItems: "center" }}><KeyRound size={15} /><strong>{card.title}</strong></header>
    {card.help ? <p style={{ margin: "4px 0 8px", opacity: 0.75, fontSize: 13 }}>{card.help}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} autoComplete="off" style={{ display: "grid", gap: 8 }}>
      <input className="el-mem-entity-input" type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={card.label} aria-label={card.label} autoComplete="off" required />
      {card.getKeyUrl ? <a href={card.getKeyUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Get a key <ExternalLink size={12} /></a> : null}
      {error ? <small style={{ color: "var(--danger, #c0392b)" }}>{error}</small> : null}
      <button type="submit" className="el-btn el-btn-primary" disabled={state === "saving" || !key}><LockKeyhole size={15} /> {state === "saving" ? "Connecting…" : "Connect securely"}</button>
    </form>
  </section>;
}
