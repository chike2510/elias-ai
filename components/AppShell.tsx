"use client";

import Link from "next/link";
import { ClipboardCheck, FileText, Folder, Home, LibraryBig, Menu, MessageSquare, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import HistoryDrawer from "@/components/HistoryDrawer";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/files", label: "Library", icon: LibraryBig },
];

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [user, setUser] = useState<{ login?: string; name?: string; avatarUrl?: string } | null>(null);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data: { user?: { login?: string; name?: string; avatarUrl?: string } | null }) => setUser(data.user || null)).catch(() => setUser(null)); }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  return (
    <div className="app-shell">
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
          <span className="profile-avatar">{user?.login?.slice(0, 1).toUpperCase() || "?"}</span>
          <div><strong>{user?.name || user?.login || "Your account"}</strong><small>@{user?.login || "not signed in"}</small></div>
          <button type="button" className="profile-menu" onClick={() => void logout()} aria-label="Sign out">↗</button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setHistoryOpen(true)} aria-label="Open conversation history"><Menu size={20} /></button>
          <Link href="/" className="brand mobile-brand">
            <span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span>
            <span className="brand-wordmark">ELIAS</span><i />
          </Link>
          <div className="topbar-context">{title || "AI workbench"}</div>
          <div className="top-actions">
            <button className="icon-btn desktop-history" onClick={() => setHistoryOpen(true)} aria-label="Open conversation history"><MessageSquare size={18} /></button>
            <Link className="top-start" href="/chat">New conversation <span>⌘K</span></Link>
            <span className="avatar">{user?.login?.slice(0, 1).toUpperCase() || "?"}</span>
          </div>
        </header>

        <div className="app-content">{children}</div>

        <nav className="bottom-nav" aria-label="Mobile navigation">
          <Nav href="/" label="Home" icon={Home} active={pathname === "/"} />
          <Nav href="/tasks" label="Tasks" icon={ClipboardCheck} active={pathname.startsWith("/tasks")} />
          <Link className="assistant-fab" href="/chat" aria-label="Open chat"><Sparkles size={22} /></Link>
          <Nav href="/projects" label="Projects" icon={Folder} active={pathname.startsWith("/projects")} />
          <Nav href="/files" label="Library" icon={LibraryBig} active={pathname.startsWith("/files")} />
        </nav>
      </div>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

function Nav({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ size?: number }>; active: boolean }) {
  return <Link href={href} className={`nav-item ${active ? "active" : ""}`}><Icon size={18} /><span>{label}</span></Link>;
}
