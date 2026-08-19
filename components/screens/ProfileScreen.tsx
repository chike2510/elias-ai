"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, CircleHelp, Database, LogOut, Moon, Puzzle, ShieldCheck, Sparkles, UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type User = { name?: string; login?: string; email?: string; avatarUrl?: string; githubConnected?: boolean; vercelConnected?: boolean };
function Row({ icon, label, detail, href }: { icon: React.ReactNode; label: string; detail?: string; href?: string }) { const content = <><span className="profile-row-icon">{icon}</span><span className="profile-row-copy"><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span><ChevronRight size={16} /></>; return href ? <Link className="profile-row" href={href}>{content}</Link> : <button className="profile-row" type="button">{content}</button>; }

export default function ProfileScreen() {
  const [user, setUser] = useState<User>({});
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => setUser(data.user || {})).catch(() => undefined); }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }
  const initial = (user.name || user.login || "C").slice(0, 1).toUpperCase();
  const connected = user.githubConnected || user.vercelConnected ? "Connected services" : "No services connected";
  return <AppShell title="Profile"><main className="screen profile-screen"><div className="profile-titlebar"><Link href="/chat" aria-label="Back to chat"><ArrowLeft size={19} /></Link><span className="profile-wordmark">Profile</span><span /></div><section className="account-card"><span className="account-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}</span><span><strong>{user.name || user.login || "Your account"}</strong><small>{user.login ? `@${user.login}` : "Personal workspace"}</small></span></section><section className="profile-group"><div className="profile-group-label">Workspace</div><Row icon={<Sparkles size={18} />} label="Approvals" href="/approvals" /><Row icon={<Database size={18} />} label="Memory" href="/memory" /><Row icon={<Sparkles size={18} />} label="Improve Elias" href="/improvements" /><Row icon={<Sparkles size={18} />} label="Search" href="/search" /></section><section className="profile-group"><div className="profile-group-label">Connections</div><Row icon={<Puzzle size={18} />} label="Connectors" detail={connected} href="/connectors" /><Row icon={<Puzzle size={18} />} label="Skills" /><Row icon={<ShieldCheck size={18} />} label="Privacy" href="/privacy" /></section><section className="profile-group"><div className="profile-group-label">Account</div><Row icon={<UserCircle size={18} />} label="Account" detail={user.email || user.login || "Personal"} /><Row icon={<Moon size={18} />} label="Appearance" detail="System" /></section><section className="profile-group profile-actions"><Row icon={<CircleHelp size={18} />} label="Help" /><button className="profile-row danger-row" type="button" onClick={() => void logout()}><span className="profile-row-icon"><LogOut size={18} /></span><span className="profile-row-copy"><strong>Sign out</strong></span></button></section></main></AppShell>;
}
