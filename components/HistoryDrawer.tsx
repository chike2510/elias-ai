"use client";

import { Clock3, MessageSquare, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { deleteConversation, getConversations, type ConversationRecord } from "@/lib/persistence";

export default function HistoryDrawer({ open, onClose, user }: { open: boolean; onClose: () => void; user?: { login?: string; name?: string } | null }) {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => { if (open) void refresh(); }, [open]);
  async function refresh() {
    try { setConversations((await getConversations()).sort((a, b) => b.updatedAt - a.updatedAt)); }
    catch { setConversations([]); }
  }
  async function remove(id: string) {
    await deleteConversation(id);
    await refresh();
    window.dispatchEvent(new Event("elias:conversation-updated"));
  }

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? conversations.filter((item) => `${item.title} ${item.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(value)) : conversations;
  }, [conversations, query]);
  if (!open) return null;

  return <div className="history-overlay clean-history-overlay" onClick={onClose}><aside className="history-drawer clean-history-drawer" aria-label="Recent chats" onClick={(event) => event.stopPropagation()}>
    <div className="history-head clean-drawer-head"><Link href="/" className="clean-drawer-brand" onClick={onClose}><span className="brand-mark"><img src="/branding/elias-logo.png" alt="" /></span><strong>ELIAS</strong></Link><button className="icon-btn" onClick={onClose} aria-label="Close recent chats"><X size={18} /></button></div>
    <div className="drawer-section-head"><span>Recent chats</span><Link href="/chat" onClick={onClose} aria-label="New conversation"><Plus size={17} /></Link></div>
    <label className="history-search drawer-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label>
    <div className="history-list drawer-history-list">{filtered.length ? filtered.slice(0, 60).map((item) => <div className="history-item" key={item.id}><Link href={`/chat?id=${encodeURIComponent(item.id)}`} onClick={onClose}><span className="history-icon"><MessageSquare size={14} /></span><span className="history-copy"><strong>{item.title || "Untitled conversation"}</strong><small>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {item.messages.filter((message) => message.role !== "system").length} messages</small></span></Link><button className="history-delete" title="Delete conversation" aria-label={`Delete ${item.title || "conversation"}`} onClick={() => void remove(item.id)}><Trash2 size={13} /></button></div>) : <div className="history-empty"><Clock3 size={21} /><strong>No conversations yet</strong><small>Start a conversation and it will appear here.</small></div>}</div>
    <div className="drawer-account"><span className="profile-avatar">{user?.login?.slice(0, 1).toUpperCase() || user?.name?.slice(0, 1).toUpperCase() || "?"}</span><span><strong>{user?.name || user?.login || "Profile"}</strong><small>{user?.login ? `@${user.login}` : "Account"}</small></span><Link href="/profile" onClick={onClose} aria-label="Open profile and settings"><Settings2 size={15} /></Link></div>
  </aside></div>;
}
