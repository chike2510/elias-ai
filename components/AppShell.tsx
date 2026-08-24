"use client";

import Link from "next/link";
import { ArrowLeft, Command, Folder, Globe2, Home, LibraryBig, Menu, MessageSquare, Search, ShieldCheck, Sparkles, SquarePen } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import HistoryDrawer from "@/components/HistoryDrawer";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/files", label: "Library", icon: LibraryBig },
  { href: "/browser", label: "Browser", icon: Globe2 },
];

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const openConversation = pathname === "/chat" && Boolean(params.get("id") || params.get("prompt"));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [user, setUser] = useState<{ login?: string; name?: string; avatarUrl?: string } | null>(null);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data: { user?: { login?: string; name?: string; avatarUrl?: string } | null }) => setUser(data.user || null)).catch(() => setUser(null)); }, []);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); } if (event.key === "Escape") setCommandOpen(false); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  return (
    <div className={`app-shell ${openConversation ? "open-chat-shell" : ""}`}>
      <aside className="desktop-sidebar">
        <Link href="/" className="brand sidebar-brand">
          <span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span>
          <span className="brand-wordmark">ELIAS</span>
          <i />
        </Link>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navigation.map((item) => <Nav key={item.href} {...item} active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)} />)}
        </nav>
        <div className="sidebar-footer">
          <Link href="/profile" className="profile-avatar" aria-label="Open profile">{user?.login?.slice(0, 1).toUpperCase() || "?"}</Link>
          <Link href="/profile" className="profile-summary"><strong>{user?.name || user?.login || "Your account"}</strong><small>@{user?.login || "not signed in"}</small></Link>
          <button type="button" className="profile-menu" onClick={() => void logout()} aria-label="Sign out">↗</button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          {openConversation ? <Link href="/" className="icon-btn mobile-only" aria-label="Back to home"><ArrowLeft size={20} /></Link> : <button className="icon-btn mobile-only" onClick={() => setHistoryOpen(true)} aria-label="Open conversation history"><Menu size={20} /></button>}
          <Link href="/" className="brand mobile-brand">
            <span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span>
            <span className="brand-wordmark">ELIAS</span><i />
          </Link>
          <div className="topbar-context">{title || ""}</div>
          <div className="top-actions">
            <button className="icon-btn desktop-history" onClick={() => setHistoryOpen(true)} aria-label="Open conversation history"><MessageSquare size={18} /></button>
            <Link href="/chat" className="icon-btn new-chat-button" aria-label="Start a new chat"><SquarePen size={18} /></Link><button className="icon-btn command-trigger" type="button" onClick={() => setCommandOpen(true)} aria-label="Open command palette"><Command size={17} /></button>
            <Link href="/profile" className="avatar" aria-label="Open profile">{user?.login?.slice(0, 1).toUpperCase() || "?"}</Link>
          </div>
        </header>

        <div className="app-content">{children}</div>

        {!openConversation ? <nav className="bottom-nav" aria-label="Mobile navigation">
          <Nav href="/" label="Home" icon={Home} active={pathname === "/"} />
          <Link className="assistant-fab" href="/chat" aria-label="Open Chat and execution workspace"><Sparkles size={22} /></Link>
          <Nav href="/projects" label="Projects" icon={Folder} active={pathname.startsWith("/projects")} />
          <Nav href="/files" label="Library" icon={LibraryBig} active={pathname.startsWith("/files")} />
        </nav> : null}
      </div>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {commandOpen ? <div className="command-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Elias command palette" onMouseDown={(event) => event.stopPropagation()}><div className="command-palette-head"><Command size={16} /><strong>Command Elias</strong><button className="icon-btn" onClick={() => setCommandOpen(false)} aria-label="Close command palette">×</button></div><div className="command-list"><CommandLink href="/chat" label="New chat" icon={<MessageSquare size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/search" label="Search" icon={<Search size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/chat" label="Chat & tasks" icon={<MessageSquare size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/browser" label="Browser workspace" icon={<Globe2 size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/approvals" label="Approvals" icon={<ShieldCheck size={15} />} onSelect={() => setCommandOpen(false)} /><CommandLink href="/profile" label="Settings" icon={<Sparkles size={15} />} onSelect={() => setCommandOpen(false)} /></div><small className="command-hint">Press Esc to close</small></section></div> : null}
    </div>
  );
}

function Nav({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ size?: number }>; active: boolean }) {
  return <Link href={href} className={`nav-item ${active ? "active" : ""}`}><Icon size={18} /><span>{label}</span></Link>;
}
function CommandLink({ href, label, icon, onSelect }: { href: string; label: string; icon: React.ReactNode; onSelect: () => void }) {
  return <Link href={href} className="command-item" onClick={onSelect}><span>{icon}</span><b>{label}</b><span className="command-arrow">↵</span></Link>;
}
