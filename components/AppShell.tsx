"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, Check, CheckSquare, Code2, Command, Copy, Ellipsis, Folder, Globe2, LibraryBig, Link2, LogOut, Menu, MessageSquare, Plus, Search, Settings2, Sparkles, Workflow, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import HistoryDrawer from "@/components/HistoryDrawer";
import { getConversations, type ConversationRecord } from "@/lib/persistence";

const navigation = [
  { href: "/chat", label: "New convo", icon: Plus, id: "new" },
  { href: "/projects", label: "Projects", icon: Folder, id: "projects" },
  { href: "/agent", label: "Coding workspace", icon: Code2, id: "coding" },
  { href: "/browser", label: "Browser", icon: Globe2, id: "browser" },
  { href: "/files", label: "Library", icon: LibraryBig, id: "library" },
] as const;

function recentMeta(conversation: ConversationRecord) {
  const date = new Date(conversation.updatedAt);
  const label = Number.isNaN(date.getTime()) ? "Recent" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  return `${label} · ${conversation.messages.filter((message) => message.role !== "system").length} messages`;
}

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [user, setUser] = useState<{ login?: string; name?: string } | null>(null);
  const [recentConversations, setRecentConversations] = useState<ConversationRecord[]>([]);
  const [copiedConversationId, setCopiedConversationId] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data: { user?: { login?: string; name?: string } | null }) => setUser(data.user || null)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const conversations = await getConversations();
        if (active) setRecentConversations(conversations.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8));
      } catch {
        if (active) setRecentConversations([]);
      }
    };
    void refresh();
    const onUpdate = () => { void refresh(); };
    window.addEventListener("elias:conversation-updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      active = false;
      window.removeEventListener("elias:conversation-updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); }
      if (event.key === "Escape") { setCommandOpen(false); setHistoryOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function copyConversationLink(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/chat?id=${encodeURIComponent(id)}`);
      setCopiedConversationId(id);
      window.setTimeout(() => setCopiedConversationId((current) => current === id ? null : current), 1400);
    } catch { /* clipboard access is optional; opening the conversation remains available */ }
  }

  const isActive = (id: typeof navigation[number]["id"]) => {
    if (id === "new") return pathname === "/" || pathname.startsWith("/chat");
    if (id === "projects") return pathname.startsWith("/projects");
    if (id === "coding") return pathname.startsWith("/agent");
    if (id === "browser") return pathname.startsWith("/browser");
    return pathname.startsWith("/files");
  };

  return <div className={`app-shell clean-app-shell surface-${pathname.split("/").filter(Boolean)[0] || "home"} ${pathname === "/chat" ? "open-chat-shell" : ""}`}>
    <aside className="desktop-sidebar clean-sidebar">
      <div className="clean-brand-card">
        <Link href="/" className="brand clean-brand" aria-label="ELIAS home"><span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span><span className="brand-wordmark">ELIAS</span></Link>
        <button type="button" className="icon-btn clean-sidebar-more" aria-label="Open workspace menu" onClick={() => setCommandOpen(true)}><Ellipsis size={19} /></button>
      </div>
      <nav className="sidebar-nav clean-sidebar-nav" aria-label="Primary navigation">{navigation.map((item) => <Nav key={item.href} {...item} active={isActive(item.id)} />)}</nav>
      <section className="clean-sidebar-recent" aria-labelledby="sidebar-recent-title">
        <div className="clean-sidebar-recent-heading"><span id="sidebar-recent-title">Recent chats</span><button type="button" onClick={() => setHistoryOpen(true)} aria-label="View all recent chats"><ArrowUpRight size={14} /></button></div>
        <div className="clean-sidebar-recent-list">{recentConversations.map((conversation) => <div className="clean-sidebar-chat" key={conversation.id}>
          <Link href={`/chat?id=${encodeURIComponent(conversation.id)}`} className="clean-sidebar-chat-link"><strong>{conversation.title || "Untitled conversation"}</strong><small>{recentMeta(conversation)}</small></Link>
          <button type="button" className="clean-sidebar-chat-copy" onClick={() => void copyConversationLink(conversation.id)} aria-label={copiedConversationId === conversation.id ? "Conversation link copied" : `Copy link to ${conversation.title || "conversation"}`}>{copiedConversationId === conversation.id ? <Check size={14} /> : <Copy size={13} />}</button>
        </div>)}{!recentConversations.length ? <p className="clean-sidebar-empty">Your conversations will appear here.</p> : null}</div>
      </section>
    </aside>
    <div className="app-main">
      <header className="topbar clean-topbar">
        <button className="icon-btn clean-menu-button" type="button" onClick={() => setHistoryOpen(true)} aria-label="Open recent chats"><Menu size={19} /></button>
        <Link href="/" className="brand mobile-brand clean-mobile-brand" aria-label="Elias home"><span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span><span className="brand-wordmark">ELIAS</span></Link>
        <div className="topbar-context clean-topbar-context">{pathname === "/chat" ? "" : title || ""}</div>
        <div className="top-actions clean-top-actions"><button className="icon-btn" type="button" onClick={() => setCommandOpen(true)} aria-label="Open workspace menu"><Command size={17} /></button><Link href="/profile" className="avatar" aria-label="Open profile">{user?.login?.slice(0, 1).toUpperCase() || "?"}</Link></div>
      </header>
      <nav className="mobile-primary-nav" aria-label="Primary navigation">{navigation.map((item) => <Nav key={item.href} {...item} active={isActive(item.id)} />)}</nav>
      <div className="app-content">{children}</div>
    </div>
    <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} user={user} />
    {commandOpen ? <div className="command-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}><section className="command-palette clean-command-palette" role="dialog" aria-modal="true" aria-label="Elias workspace menu" onMouseDown={(event) => event.stopPropagation()}><div className="command-palette-head"><Command size={16} /><strong>Go to</strong><button className="icon-btn" onClick={() => setCommandOpen(false)} aria-label="Close workspace menu"><X size={17} /></button></div><div className="command-list">
      <CommandLink href="/chat" label="New conversation" icon={<MessageSquare size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/tasks" label="Task history" icon={<CheckSquare size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/projects" label="Projects" icon={<Folder size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/files" label="Library" icon={<LibraryBig size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/agent" label="Coding workspace" icon={<Code2 size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/browser" label="Browser" icon={<Globe2 size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/research" label="Research" icon={<Search size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/study" label="Study" icon={<BookOpen size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/skills" label="Skills" icon={<Sparkles size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/automations" label="Automations" icon={<Workflow size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/profile" label="Profile & settings" icon={<Settings2 size={15} />} onSelect={() => setCommandOpen(false)} />
      <CommandLink href="/connectors" label="Connectors" icon={<Link2 size={15} />} onSelect={() => setCommandOpen(false)} />
      <button type="button" className="command-item command-action-item" onClick={() => { setCommandOpen(false); void logout(); }}><span><LogOut size={15} /></span><b>Sign out</b><span className="command-arrow" aria-hidden="true">↵</span></button>
    </div><small className="command-hint">Press Esc to close</small></section></div> : null}
  </div>;
}

function Nav({ href, label, icon: Icon, active, id }: { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; active: boolean; id: string }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={`nav-item ${id === "new" ? "nav-new-conversation" : ""} ${active ? "active" : ""}`}><span className="nav-icon"><Icon size={20} strokeWidth={1.25} /></span><span>{label}</span></Link>;
}

function CommandLink({ href, label, icon, onSelect }: { href: string; label: string; icon: React.ReactNode; onSelect: () => void }) {
  return <Link href={href} className="command-item" onClick={onSelect}><span>{icon}</span><b>{label}</b><span className="command-arrow">↵</span></Link>;
}
