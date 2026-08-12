"use client";

import { Clock3, MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deleteConversation,
  getConversations,
  type ConversationRecord,
} from "@/lib/persistence";

export default function HistoryDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ConversationRecord[]>([]);
  const [query, setQuery] = useState("");

  async function refresh() {
    try {
      setItems(await getConversations());
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.title} ${item.messages.map((m) => m.content).join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  if (!open) return null;

  async function remove(id: string) {
    await deleteConversation(id);
    await refresh();
  }

  return (
    <div className="history-overlay" onClick={onClose}>
      <aside
        className="history-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="history-head">
          <div>
            <p className="history-kicker">ELIAS</p>
            <h2>Conversations</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close history">
            <X size={18} />
          </button>
        </div>

        <Link href="/chat" className="history-new" onClick={onClose}>
          <Plus size={17} />
          <span>New conversation</span>
        </Link>

        <div className="history-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
          />
        </div>

        <div className="history-list">
          {filtered.length ? (
            filtered.map((item) => (
              <div className="history-item" key={item.id}>
                <Link
                  href={`/chat?id=${encodeURIComponent(item.id)}`}
                  onClick={onClose}
                >
                  <span className="history-icon">
                    <MessageSquare size={15} />
                  </span>
                  <span className="history-copy">
                    <strong>{item.title || "Untitled conversation"}</strong>
                    <small>
                      {new Date(item.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                      {" · "}
                      {item.messages.length} messages
                    </small>
                  </span>
                </Link>
                <button
                  className="history-delete"
                  title="Delete conversation"
                  onClick={() => void remove(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="history-empty">
              <Clock3 size={21} />
              <strong>No conversations yet</strong>
              <small>Your chats will appear here and remain after refreshes.</small>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
