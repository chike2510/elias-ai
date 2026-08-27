"use client";

import { BookOpen, CheckSquare, Clock3, Code2, Folder, Globe2, LibraryBig, MessageSquare, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { deleteConversation, getConversations, type ConversationRecord } from "@/lib/persistence";

const items = [
  { href: "/chat", label: "New conversation", icon: Plus },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/files", label: "Library", icon: LibraryBig },
  { href: "/agent", label: "Code", icon: Code2 },
  { href: "/browser", label: "Browser", icon: Globe2 },
  { href: "/skills", label: "Skills", icon: BookOpen },
  { href: "/profile", label: "Customize", icon: Settings2 },
];

export default function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) void refresh(); }, [open]);
  async function refresh() { try { setConversations(await getConversations()); } catch { setConversations([]); } }
  async function remove(id: string) { await deleteConversation(id); await refresh(); }
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? conversations.filter((item) => `${item.title} ${item.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(q)) : conversations; }, [conversations, query]);
  if (!open) return null;
  return <div className="history-overlay clean-history-overlay" onClick={onClose}><aside className="history-drawer clean-history-drawer" onClick={(event) => event.stopPropagation()}>
    <div className="history-head clean-drawer-head"><div className="clean-drawer-brand"><span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span><strong>ELIAS</strong></div><button className="icon-btn" onClick={onClose} aria-label="Close navigation"><X size={18} /></button></div>
    <nav className="drawer-primary" aria-label="Workspace navigation">{items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`drawer-nav-row ${href === "/chat" ? "drawer-new-row" : ""}`} onClick={onClose}><Icon size={17} /><span>{label}</span>{href === "/chat" ? <span className="drawer-key">N</span> : null}</Link>)}</nav>
    <div className="drawer-section-head"><span>Conversations</span><Link href="/chat" onClick={onClose} aria-label="New conversation"><Plus size={15} /></Link></div>
    <div className="history-search drawer-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></div>
    <div className="history-list drawer-history-list">{filtered.length ? filtered.slice(0, 30).map((item) => <div className="history-item" key={item.id}><Link href={`/chat?id=${encodeURIComponent(item.id)}`} onClick={onClose}><span className="history-icon"><MessageSquare size={14} /></span><span className="history-copy"><strong>{item.title || "Untitled conversation"}</strong><small>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {item.messages.length} messages</small></span></Link><button className="history-delete" title="Delete conversation" onClick={() => void remove(item.id)}><Trash2 size={13} /></button></div>) : <div className="history-empty"><Clock3 size={21} /><strong>No conversations yet</strong><small>Start a conversation and it will appear here.</small></div>}</div>
    <div className="drawer-account"><span className="profile-avatar">?</span><span><strong>Your account</strong><small>Open profile and settings</small></span><Link href="/profile" onClick={onClose}><Settings2 size={15} /></Link></div>
  </aside></div>;
}
