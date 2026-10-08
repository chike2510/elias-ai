"use client";

import Link from "next/link";
import { ChevronRight, Globe2, LogOut, Mail, Github, MessagesSquare, Sparkles, History } from "lucide-react";
import NotificationSettings from "@/components/NotificationSettings";
import TelegramLink from "@/components/screens/TelegramLink";
import { useEffect, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { MORE } from "@/lib/navigation";
import { api, userTimezone, type Status } from "@/lib/chatClient";

type User = { name?: string; login?: string; email?: string; avatarUrl?: string };

/** "You": account, connections at a glance, and every other part of Elias. */
export default function YouScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => setUser(data.user || {})).catch(() => setUser({}));
    void api<Status>(`/api/assistant/status?timezone=${encodeURIComponent(userTimezone())}`).then(setStatus).catch(() => setStatusError(true));
  }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.localStorage.removeItem("elias.user"); window.location.href = "/login"; }
  const initial = (user?.name || user?.login || "?").slice(0, 1).toUpperCase();

  return <AppShell title="You">
    <main className="el-page">
      <section className="el-profile">
        <span className="el-avatar el-avatar-lg">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}</span>
        <div><h1>{user?.name || user?.login || (user ? "You" : " ")}</h1><p>{user?.login ? `@${user.login}` : user?.email || "Personal workspace"}</p></div>
      </section>

      <section className="el-section">
        <h2>Connections</h2>
        {!status && !statusError ? <ListSkeleton rows={3} /> : null}
        {statusError ? <p className="el-empty-line">Couldn't check connections right now.</p> : null}
        {status ? <ul className="el-list">
          <li><ConnectionRow icon={<Mail size={17} />} name="Google" detail={status.google.connected ? `Gmail & Calendar · ${status.google.email || "connected"}` : status.google.configured ? "Gmail & Calendar" : "Not configured yet"} state={status.google.connected ? "on" : status.google.configured ? "off" : "na"} href={status.google.connected || !status.google.configured ? "/connectors" : "/api/connect/google?return=/you"} action={status.google.configured && !status.google.connected ? "Connect" : undefined} /></li>
          <li><ConnectionRow icon={<Github size={17} />} name="GitHub" detail={status.github.connected ? "Repository access" : "Repository access not connected"} state={status.github.connected ? "on" : "off"} href="/connectors/github" /></li>
          <li><ConnectionRow icon={<Globe2 size={17} />} name="Browser" detail={status.browser.configured ? "Interactive browsing ready" : "Browser not configured"} state={status.browser.configured ? "on" : "na"} href="/browser" /></li>
        </ul> : null}
      </section>

      <NotificationSettings />
      <TelegramLink />

      <section className="el-section">
        <h2>Workspace</h2>
        <ul className="el-list">{MORE.filter((item) => item.group === "work").map((item) => <li key={item.href}><Link className="el-list-row" href={item.href}><span className="el-list-icon"><item.icon size={17} /></span><span className="el-list-text"><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={17} className="el-list-trail" /></Link></li>)}</ul>
      </section>

      <section className="el-section">
        <h2>You & Elias</h2>
        <ul className="el-list"><li><Link className="el-list-row" href="/chats"><span className="el-list-icon"><MessagesSquare size={17} /></span><span className="el-list-text"><strong>Chats</strong><small>Every conversation with Elias</small></span><ChevronRight size={17} className="el-list-trail" /></Link></li>
          <li><Link className="el-list-row" href="/you/activity"><span className="el-list-icon"><History size={17} /></span><span className="el-list-text"><strong>Activity</strong><small>Everything Elias did on your behalf</small></span><ChevronRight size={17} className="el-list-trail" /></Link></li>
          {MORE.filter((item) => item.group === "you").map((item) => <li key={item.href}><Link className="el-list-row" href={item.href}><span className="el-list-icon"><item.icon size={17} /></span><span className="el-list-text"><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={17} className="el-list-trail" /></Link></li>)}
          <li><Link className="el-list-row" href="/welcome"><span className="el-list-icon"><Sparkles size={17} /></span><span className="el-list-text"><strong>Redo setup</strong><small>Name, timezone, brief time, connections and preferences</small></span><ChevronRight size={17} className="el-list-trail" /></Link></li>
          <li><button type="button" className="el-list-row danger" onClick={() => void logout()}><span className="el-list-icon"><LogOut size={17} /></span><span className="el-list-text"><strong>Sign out</strong></span></button></li>
        </ul>
      </section>
      <p className="el-fineprint v4-desktop-only">Press ⌘K (Ctrl K) anywhere to jump to any of these.</p>
    </main>
  </AppShell>;
}

function ConnectionRow({ icon, name, detail, state, href, action }: { icon: React.ReactNode; name: string; detail: string; state: "on" | "off" | "na"; href: string; action?: string }) {
  return <Link className="el-list-row" href={href}>
    <span className="el-list-icon">{icon}</span>
    <span className="el-list-text"><strong>{name}</strong><small>{detail}</small></span>
    {action ? <span className="el-btn el-btn-primary el-btn-sm">{action}</span> : <span className={`el-state ${state}`}>{state === "on" ? "On" : state === "off" ? "Off" : "Not set up"}</span>}
  </Link>;
}
