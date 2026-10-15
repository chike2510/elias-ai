"use client";

import { Check, KeyRound, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/chatClient";
import type { VaultFormCard as VaultFormInfo } from "@/lib/assistant/cards";

/** Asks the chat to send a message as the user (ChatView listens), so Elias carries on once the login is saved. */
export function sendAsUser(text: string) {
  window.dispatchEvent(new CustomEvent("elias:send", { detail: { text } }));
}

/** Secure login form inside the chat. Posts straight to /api/vault: the password never enters the conversation or the model. */
export default function VaultFormCard({ card }: { card: VaultFormInfo }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function save() {
    setState("saving"); setError("");
    try {
      await api("/api/vault", { method: "POST", body: JSON.stringify({ site: card.site, loginUrl: card.loginUrl, username, password, totp: totp || undefined }) });
      setPassword(""); setTotp(""); setState("saved");
      sendAsUser(`I saved my ${card.site} login in the Vault. Carry on.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save it."); setState("idle"); }
  }

  if (state === "saved") return <section className="el-card el-card-compact" aria-label="Login saved"><Check size={15} /><span><strong>{card.site} login saved</strong><small>Encrypted in your Vault</small></span><a href="/vault">Vault</a></section>;

  return <section className="el-card el-vault-form" aria-label={card.title}>
    <header className="el-card-head" style={{ display: "flex", gap: 8, alignItems: "center" }}><KeyRound size={15} /><strong>{card.title}</strong></header>
    {card.reason ? <p style={{ margin: "4px 0 8px", opacity: 0.75, fontSize: 13 }}>{card.reason}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} autoComplete="off" style={{ display: "grid", gap: 8 }}>
      <input className="el-mem-entity-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username, email or phone" aria-label="Username" autoComplete="off" required />
      <input className="el-mem-entity-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" aria-label="Password" autoComplete="new-password" required />
      {more ? <input className="el-mem-entity-input" value={totp} onChange={(event) => setTotp(event.target.value)} placeholder="Authenticator key (optional)" aria-label="Authenticator key" autoComplete="off" /> : <button type="button" className="el-btn" onClick={() => setMore(true)}>Add 2FA authenticator key</button>}
      {error ? <small style={{ color: "var(--danger, #c0392b)" }}>{error}</small> : null}
      <button type="submit" className="el-btn el-btn-primary" disabled={state === "saving" || !username || !password}><LockKeyhole size={15} /> {state === "saving" ? "Saving…" : "Save securely"}</button>
      <small style={{ opacity: 0.65 }}>Encrypted and filled in on the server. Elias never sees the password.</small>
    </form>
  </section>;
}
