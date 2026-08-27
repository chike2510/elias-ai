"use client";

import Link from "next/link";
import { BookOpen, CheckSquare, Command, FileText, Folder, Globe2, Home, LibraryBig, Menu, MessageSquare, Search, Settings2, Sparkles, SquarePen, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import HistoryDrawer from "@/components/HistoryDrawer";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/files", label: "Library", icon: LibraryBig },
  { href: "/agent", label: "Code", icon: Sparkles },
  { href: "/browser", label: "Browser", icon: Globe2 },
];

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [user, setUser] = useState<{ login?: string; name?: string } | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data: { user?: { login?: string; name?: string } | null }) => setUser(data.user || null)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); }
      if (event.key === "Escape") { setCommandOpen(false); setHistoryOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  return <div className={`app-shell clean-app-shell ${pathname === "/chat" ? "open-chat-shell" : ""}`}>
    <aside className="desktop-sidebar clean-sidebar">
      <Link href="/" className="brand clean-brand"><span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span><span className="brand-wordmark">ELIAS</span></Link>
      <button className="clean-new-button" type="button" onClick={() => { window.location.href = "/chat"; }}><SquarePen size={15} /> New conversation</button>
      <nav className="sidebar-nav clean-sidebar-nav" aria-label="Primary navigation">{navigation.map((item) => <Nav key={item.href} {...item} active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)} />)}</nav>
      <div className="clean-sidebar-section"><span className="clean-sidebar-label">Workspace</span><Link href="/skills" className="clean-sidebar-link"><BookOpen size={15} /> Skills</Link><Link href="/profile" className="clean-sidebar-link"><Settings2 size={15} /> Customize</Link></div>
      <div className="sidebar-footer clean-sidebar-footer"><Link href="/profile" className="profile-avatar" aria-label="Open profile">{user?.login?.slice(0, 1).toUpperCase() || "?"}</Link><Link href="/profile" className="profile-summary"><strong>{user?.name || user?.login || "Your account"}</strong><small>@{user?.login || "not signed in"}</small></Link><button type="button" className="profile-menu" onClick={() => void logout()} aria-label="Sign out">↗</button></div>
    </aside>
    <div className="app-main">
      <header className="topbar clean-topbar">
        <button className="icon-btn clean-menu-button" type="button" onClick={() => setHistoryOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
        <Link href="/" className="brand mobile-brand clean-mobile-brand" aria-label="Elias home"><span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span><span className="brand-wordmark">ELIAS</span></Link>
        <div className="topbar-context clean-topbar-context">{pathname === "/chat" ? "" : title || ""}</div>
        <div className="top-actions clean-top-actions"><button className="icon-btn" type="button" onClick={() => setCommandOpen(true)} aria-label="Open command palette"><Command size={17} /></button><Link href="/profile" className="avatar" aria-label="Open profile">{user?.login?.slice(0, 1).toUpperCase() || "?"}</Link></div>
      </header>
      <div className="app-content">{children}</div>
    </div>
    <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    {commandOpen ? <div className="command-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}><section className="command-palette clean-command-palette" role="dialog" aria-modal="true" aria-label="Elias command palette" onMouseDown={(event) => event.stopPropagation()}><div className="command-palette-head"><Command size={16} /><strong>Jump to</strong><button className="icon-btn" onClick={() => setCommandOpen(false)} aria-label="Close command palette"><X size={17} /></button></div><div className="command-list"><CommandLink href="/chat" label="New conversation" icon={<MessageSquare size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/projects" label="Projects" icon={<Folder size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/tasks" label="Tasks" icon={<CheckSquare size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/files" label="Library" icon={<FileText size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/search" label="Search" icon={<Search size={15} />} onSelect={() => setCommandOpen(false)} /></div><small className="command-hint">Press Esc to close</small></section></div> : null}
  </div>;
}

function Nav({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ size?: number }>; active: boolean }) { return <Link href={href} className={`nav-item ${active ? "active" : ""}`}><Icon size={17} /><span>{label}</span></Link>; }
function CommandLink({ href, label, icon, onSelect }: { href: string; label: string; icon: React.ReactNode; onSelect: () => void }) { return <Link href={href} className="command-item" onClick={onSelect}><span>{icon}</span><b>{label}</b><span className="command-arrow">↵</span></Link>; }
