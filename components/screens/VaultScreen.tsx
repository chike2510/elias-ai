"use client";

import "@/components/brain.css";
import { Cookie, KeyRound, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { ErrorCard } from "@/components/chat/ChatView";
import { api } from "@/lib/chatClient";

type Secret = { id: string; site: string; label: string; username: string; hasTotp: boolean; lastUsedAt: string | null };
type Session = { site: string; cookies: number; updatedAt: string };

/** Logins Elias may use in its browser. Passwords are write-only: encrypted on save, filled server-side, never shown to the model or this page. */
export default function VaultScreen() {
  const [data, setData] = useState<{ secrets: Secret[]; sessions: Session[]; encrypted: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ site: "", username: "", password: "", loginUrl: "", totp: "", label: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setError(null); void api<{ secrets: Secret[]; sessions: Session[]; encrypted: boolean }>("/api/vault").then(setData).catch((err) => setError(err.message)); }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true);
    try {
      await api("/api/vault", { method: "POST", body: JSON.stringify(form) });
      setForm({ site: "", username: "", password: "", loginUrl: "", totp: "", label: "" });
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); } finally { setBusy(false); }
  }
  async function remove(query: string) {
    await api(`/api/vault?${query}`, { method: "DELETE" }).catch((err) => setError(err.message));
    load();
  }
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  return <AppShell title="Vault">
    <main className="el-page">
      <header className="el-page-head"><h1>Vault</h1><p>Logins Elias can use in its browser: betting, shopping, socials, school portals. Passwords are encrypted, filled in on the server and never shown to the AI. Anything that spends money, bets, posts or sends still waits for your approval.</p></header>
      {data && !data.encrypted ? <p className="el-empty-line"><LockKeyhole size={16} /> Set ELIAS_ENCRYPTION_KEY on the server for full-strength encryption.</p> : null}
      <form className="el-editor" onSubmit={(event) => { event.preventDefault(); void add(); }} autoComplete="off">
        <input className="el-mem-entity-input" value={form.site} onChange={set("site")} placeholder="Site, e.g. sportybet.com" aria-label="Site" required />
        <input className="el-mem-entity-input" value={form.username} onChange={set("username")} placeholder="Username, email or phone" aria-label="Username" autoComplete="off" required />
        <input className="el-mem-entity-input" type="password" value={form.password} onChange={set("password")} placeholder="Password" aria-label="Password" autoComplete="new-password" required />
        <input className="el-mem-entity-input" value={form.loginUrl} onChange={set("loginUrl")} placeholder="Login page URL (optional)" aria-label="Login page URL" />
        <input className="el-mem-entity-input" value={form.totp} onChange={set("totp")} placeholder="Authenticator key (optional, for 2FA codes)" aria-label="Authenticator key" autoComplete="off" />
        <input className="el-mem-entity-input" value={form.label} onChange={set("label")} placeholder="Label (optional), e.g. main account" aria-label="Label" />
        <div className="el-editor-actions"><button type="submit" className="el-btn el-btn-primary" disabled={busy || !form.site || !form.username || !form.password}><Plus size={16} /> Save login</button></div>
      </form>
      {error ? <ErrorCard text={error} onRetry={load} /> : null}
      {!data && !error ? <ListSkeleton /> : null}
      {data ? <section className="el-mem-group" aria-label="Saved logins">
        <h2>Saved logins</h2>
        {data.secrets.length ? <ul className="el-list">{data.secrets.map((item) => <li key={item.id} className="el-list-item"><div className="el-list-row">
          <span className="el-list-icon"><KeyRound size={17} /></span>
          <span className="el-list-text"><strong>{item.site}{item.label ? ` · ${item.label}` : ""}</strong><small>{item.username}{item.hasTotp ? " · 2FA key" : ""}{item.lastUsedAt ? ` · used ${new Date(item.lastUsedAt).toLocaleDateString()}` : ""}</small></span>
          <span className="el-list-actions"><button type="button" className="el-icon-btn" aria-label={`Delete ${item.site} login`} onClick={() => void remove(`id=${encodeURIComponent(item.id)}`)}><Trash2 size={16} /></button></span>
        </div></li>)}</ul> : <p className="el-empty-line"><KeyRound size={16} /> No logins yet.</p>}
      </section> : null}
      {data ? <section className="el-mem-group" aria-label="Saved sessions">
        <h2>Signed-in sessions</h2>
        {data.sessions.length ? <ul className="el-list">{data.sessions.map((item) => <li key={item.site} className="el-list-item"><div className="el-list-row">
          <span className="el-list-icon"><Cookie size={17} /></span>
          <span className="el-list-text"><strong>{item.site}</strong><small>{item.cookies} cookies · saved {new Date(item.updatedAt).toLocaleString()}</small></span>
          <span className="el-list-actions"><button type="button" className="el-icon-btn" aria-label={`Sign Elias out of ${item.site}`} onClick={() => void remove(`session=${encodeURIComponent(item.site)}`)}><Trash2 size={16} /></button></span>
        </div></li>)}</ul> : <p className="el-empty-line"><Cookie size={16} /> Elias saves a session here after its first sign-in, so later runs skip the login.</p>}
      </section> : null}
    </main>
  </AppShell>;
}
