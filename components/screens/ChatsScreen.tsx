"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SquarePen } from "lucide-react";
import { useState } from "react";
import AppShell, { ConversationList, useConversations } from "@/components/AppShell";
import { announceConversationsChanged, api } from "@/lib/chatClient";

/** /chats: every conversation, newest first. Replaces the old mobile history drawer. */
export default function ChatsScreen() {
  const router = useRouter();
  const conversations = useConversations();
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const items = conversations.items && term ? conversations.items.filter((item) => `${item.title} ${item.preview || ""}`.toLowerCase().includes(term)) : conversations.items;

  async function remove(id: string) {
    if (!window.confirm("Delete this chat?")) return;
    conversations.setItems((current) => current?.filter((item) => item.id !== id) || null);
    await api(`/api/assistant/conversations/${id}`, { method: "DELETE" }).catch(() => undefined);
    announceConversationsChanged();
  }

  return <AppShell title="Chats" back="/">
    <main className="el-page v4-chats">
      <header className="el-page-head"><h1>Chats</h1></header>
      <div className="v4-chats-tools">
        <label className="v4-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" /></label>
        <Link href="/" className="el-btn el-btn-primary" onClick={() => router.prefetch("/")}><SquarePen size={16} /> New</Link>
      </div>
      <ConversationList items={items} error={conversations.error} reload={conversations.reload} activeId={null} onDelete={(id) => void remove(id)} />
      {term && items && !items.length && conversations.items?.length ? <p className="el-muted el-pad">No chats match “{query}”.</p> : null}
    </main>
  </AppShell>;
}
