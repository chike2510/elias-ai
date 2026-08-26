"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, CircleHelp, Database, LogOut, Moon, Puzzle, ShieldCheck, Sparkles, UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type User = { name?: string; login?: string; email?: string; avatarUrl?: string; githubConnected?: boolean; vercelConnected?: boolean };

function Row({ icon, label, detail, href, danger = false, onClick }: { icon: React.ReactNode; label: string; detail?: string; href?: string; danger?: boolean; onClick?: () => void }) {
  const content = <><span className="profile-row-icon">{icon}</span><span className="profile-row-copy"><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span><ChevronRight size={16} className="profile-row-arrow" /></>;
  if (href) return <Link className={`profile-row ${danger ? "danger-row" : ""}`} href={href}>{content}</Link>;
  return <button className={`profile-row ${danger ? "danger-row" : ""}`} type="button" onClick={onClick}>{content}</button>;
}

export default function ProfileScreen() {
  const [user, setUser] = useState<User>({});
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => setUser(data.user || {})).catch(() => undefined); }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }
  const initial = (user.name || user.login || "C").slice(0, 1).toUpperCase();
  const connected = user.githubConnected || user.vercelConnected ? "Connected services" : "No services connected";
  const displayName = user.name || user.login || "Your account";

  return <AppShell title="Profile"><main className="screen profile-screen">
    <div className="screen-title profile-titlebar"><Link href="/" className="back" aria-label="Back to home"><ArrowLeft size={20} /></Link><span>Profile</span><span /></div>
    <section className="account-card panel"><span className="account-avatar">{user.avatarUrl && !avatarFailed ? <img src={user.avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : initial}</span><span className="account-copy"><strong>{displayName}</strong><small>{user.login ? `@${user.login}` : "Personal workspace"}</small></span><ChevronRight size={17} className="account-arrow" /></section>
    <section className="profile-group"><div className="profile-group-label">Workspace</div><div className="profile-card panel"><Row icon={<Sparkles size={17} />} label="Approvals" href="/approvals" /><Row icon={<Database size={17} />} label="Memory" href="/memory" /><Row icon={<Sparkles size={17} />} label="Improve Elias" href="/improvements" /><Row icon={<Sparkles size={17} />} label="Skills" detail="Enable capabilities and review contributors" href="/skills" /><Row icon={<Sparkles size={17} />} label="Search" href="/search" /></div></section>
    <section className="profile-group"><div className="profile-group-label">Connections</div><div className="profile-card panel"><Row icon={<Puzzle size={17} />} label="Connectors" detail={connected} href="/connectors" /><Row icon={<ShieldCheck size={17} />} label="Privacy" href="/privacy" /></div></section>
    <section className="profile-group"><div className="profile-group-label">Account</div><div className="profile-card panel"><Row icon={<UserCircle size={17} />} label="Account" detail={user.email || user.login || "Personal"} /><Row icon={<Moon size={17} />} label="Appearance" detail="System" /></div></section>
    <section className="profile-group profile-actions"><div className="profile-card panel"><Row icon={<CircleHelp size={17} />} label="Help" /><Row icon={<LogOut size={17} />} label="Sign out" danger onClick={() => void logout()} /></div></section>
  </main></AppShell>;
}
