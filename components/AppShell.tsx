"use client";

import Link from "next/link";
import { ChevronLeft, Command, History, LogOut, Search, SquarePen, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { MORE, PRIMARY } from "@/lib/navigation";
import { CONVERSATIONS_CHANGED, announceConversationsChanged, api, type ConversationSummary } from "@/lib/chatClient";
import { migrateLegacyConversations } from "@/lib/legacyImport";

type User = { login?: string; name?: string; avatarUrl?: string } | null;

function relative(iso: string) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/** Server conversations, shared by the desktop sidebar and the /chats page. */
export function useConversations() {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => api<{ conversations: ConversationSummary[] }>("/api/assistant/conversations").then((data) => { setItems(data.conversations); setError(false); }).catch(() => setError(true)), []);
  useEffect(() => {
    void load();
    window.addEventListener(CONVERSATIONS_CHANGED, load);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, load);
  }, [load]);
  return { items, error, reload: load, setItems };
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="el-skeleton-list" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div key={index} className="el-skeleton-row"><span className="el-skeleton" style={{ width: `${70 - (index % 3) * 14}%` }} /><span className="el-skeleton el-skeleton-sm" style={{ width: `${40 + (index % 2) * 18}%` }} /></div>)}</div>;
}

export function ConversationList({ items, error, reload, activeId, onPick, onDelete, compact }: { items: ConversationSummary[] | null; error: boolean; reload: () => void; activeId: string | null; onPick?: () => void; onDelete?: (id: string) => void; compact?: boolean }) {
  if (error && !items) return <div className="el-inline-error"><span>Couldn't load your chats.</span><button type="button" onClick={reload}>Retry</button></div>;
  if (!items) return <ListSkeleton rows={compact ? 4 : 7} />;
  if (!items.length) return <p className="el-muted el-pad">Your chats will show up here.</p>;
  return <ul className="el-convo-list">{items.map((item) => <li key={item.id} className={item.id === activeId ? "active" : ""}>
    <Link href={`/chat?id=${encodeURIComponent(item.id)}`} onClick={onPick} aria-current={item.id === activeId ? "page" : undefined}>
      <span className="el-convo-title">{item.kind === "schedule" ? "⏰ " : ""}{item.title || "Untitled"}</span>
      {!compact && item.preview ? <span className="el-convo-preview">{item.preview}</span> : null}
      <span className="el-convo-meta">{relative(item.updatedAt)}{item.pendingApprovals ? <em>{item.pendingApprovals} waiting</em> : null}</span>
    </Link>
    {onDelete ? <button type="button" className="el-icon-btn el-convo-delete" aria-label={`Delete ${item.title}`} onClick={() => onDelete(item.id)}><Trash2 size={15} /></button> : null}
  </li>)}</ul>;
}

function ActiveConversation({ onChange }: { onChange: (id: string | null) => void }) {
  const params = useSearchParams();
  const id = params.get("id");
  useEffect(() => { onChange(id); }, [id, onChange]);
  return null;
}

/** Where the mobile top bar's back arrow goes when a screen doesn't say. Primary tabs have no back arrow. */
export function defaultBack(pathname: string): string | undefined {
  if (pathname === "/" || pathname.startsWith("/chat/") || pathname === "/chat" || pathname === "/tasks" || pathname === "/you") return undefined;
  if (pathname === "/chats") return "/";
  if (pathname.startsWith("/connectors/")) return "/connectors";
  if (pathname.startsWith("/repositories/") || pathname.startsWith("/projects/") || pathname === "/agent") return "/projects";
  if (pathname.startsWith("/tasks/")) return "/tasks";
  if (pathname.startsWith("/you/")) return "/you";
  return "/you";
}

/**
 * Mobile: one top bar (back arrow or chat history, title, new chat) and the Chat/Tasks/You tab bar. Screens keep their
 * own big headings for desktop; app/v4-shell.css hides those duplicates (and their back links) under 900px.
 * `back`: a path for the back arrow, `false` for none, or omit to use defaultBack(pathname).
 */
export default function AppShell({ children, title, chat = false, back }: { children: React.ReactNode; title?: string; chat?: boolean; back?: string | false }) {
  const pathname = usePathname();
  const router = useRouter();
  const backHref = back === false ? undefined : back || (chat ? undefined : defaultBack(pathname || "/"));
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<User>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const conversations = useConversations();

  useEffect(() => {
    try { setUser(JSON.parse(window.localStorage.getItem("elias.user") || "null")); } catch { /* ignore */ }
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data: { user?: User }) => setUser(data.user || null)).catch(() => undefined);
    void migrateLegacyConversations().catch(() => undefined);
  }, []);

  // Keep the composer above the on-screen keyboard: track the visual viewport.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--vvh", `${Math.round(viewport.height)}px`);
      root.style.setProperty("--vv-top", `${Math.round(viewport.offsetTop)}px`);
      setKeyboard(window.innerHeight - viewport.height > 140);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); setQuery(""); }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => { setCommandOpen(false); }, [pathname]);

  async function remove(id: string) {
    conversations.setItems((current) => current?.filter((item) => item.id !== id) || null);
    await api(`/api/assistant/conversations/${id}`, { method: "DELETE" }).catch(() => undefined);
    announceConversationsChanged();
    if (id === activeId) router.push("/");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.localStorage.removeItem("elias.user");
    window.location.href = "/login";
  }

  const isActive = (href: string) => href === "/" ? pathname === "/" || pathname.startsWith("/chat") : pathname.startsWith(href.split("?")[0]);
  const commands = useMemo(() => {
    const all = [...PRIMARY, ...MORE];
    const value = query.trim().toLowerCase();
    return value ? all.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(value)) : all;
  }, [query]);
  const initial = (user?.name || user?.login || "?").slice(0, 1).toUpperCase();

  return <div className={`el-shell ${chat ? "el-shell-chat" : ""} ${keyboard ? "kb-open" : ""}`}>
    <Suspense fallback={null}><ActiveConversation onChange={setActiveId} /></Suspense>
    <aside className="el-sidebar" aria-label="Sidebar">
      <div className="el-sidebar-head">
        <Link href="/" className="el-brand" aria-label="Elias home"><img src="/branding/elias-logo.png" alt="" /><span>Elias</span></Link>
        <button type="button" className="el-icon-btn" onClick={() => { setCommandOpen(true); setQuery(""); }} aria-label="Search and go to (⌘K)"><Command size={17} /></button>
      </div>
      <Link href="/" className="el-new-chat"><SquarePen size={17} /> New chat</Link>
      <nav className="el-sidebar-nav" aria-label="Primary">
        <Link href="/" className={`el-nav-item ${isActive("/") ? "active" : ""}`} aria-current={isActive("/") ? "page" : undefined}><MessageIcon /> Chat</Link>
        <div className="el-sidebar-recent">
          <ConversationList {...conversations} activeId={activeId} onDelete={(id) => void remove(id)} compact />
        </div>
        {PRIMARY.slice(1).map((item) => <Link key={item.href} href={item.href} className={`el-nav-item ${isActive(item.href) ? "active" : ""}`} aria-current={isActive(item.href) ? "page" : undefined}><item.icon size={18} /> {item.label}</Link>)}
      </nav>
      <Link href="/you" className="el-sidebar-user"><span className="el-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initial}</span><span><strong>{user?.name || user?.login || "You"}</strong><small>{user?.login ? `@${user.login}` : "Settings and more"}</small></span></Link>
    </aside>

    <div className="el-main">
      <header className="el-topbar">
        {backHref ? <Link href={backHref} className="el-icon-btn" aria-label="Back"><ChevronLeft size={22} /></Link> : chat ? <Link href="/chats" className="el-icon-btn" aria-label="Your chats"><History size={19} /></Link> : <span aria-hidden="true" />}
        <div className="el-topbar-title">{title || "Elias"}</div>
        {chat ? <Link href="/" className="el-icon-btn" aria-label="New chat"><SquarePen size={19} /></Link> : <span aria-hidden="true" />}
      </header>
      <div className="el-content">{children}</div>
      <nav className="el-tabbar" aria-label="Primary">
        {PRIMARY.map((item) => <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""} aria-current={isActive(item.href) ? "page" : undefined}><item.icon size={22} strokeWidth={isActive(item.href) ? 2.2 : 1.7} /><span>{item.label}</span></Link>)}
      </nav>
    </div>

    {commandOpen ? <div className="el-overlay el-overlay-center" onMouseDown={() => setCommandOpen(false)}>
      <section className="el-palette" role="dialog" aria-modal="true" aria-label="Go to" onMouseDown={(event) => event.stopPropagation()}>
        <label className="el-palette-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go to…" aria-label="Search destinations" onKeyDown={(event) => { if (event.key === "Enter" && commands[0]) { router.push(commands[0].href); setCommandOpen(false); } }} /></label>
        <div className="el-palette-list">
          {commands.map((item) => <Link key={item.href} href={item.href} className="el-palette-item" onClick={() => setCommandOpen(false)}><item.icon size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></Link>)}
          {!query ? <button type="button" className="el-palette-item" onClick={() => { setCommandOpen(false); void logout(); }}><LogOut size={17} /><span><strong>Sign out</strong><small>End this session</small></span></button> : null}
          {!commands.length ? <p className="el-muted el-pad">Nothing matches “{query}”.</p> : null}
        </div>
      </section>
    </div> : null}
  </div>;
}

function MessageIcon() {
  const Icon = PRIMARY[0].icon;
  return <Icon size={18} />;
}
