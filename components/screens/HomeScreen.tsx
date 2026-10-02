"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Copy, ListChecks, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import AppShell from "@/components/AppShell";
import { getConversations, type ConversationRecord } from "@/lib/persistence";

function previewText(conversation: ConversationRecord) {
  const message = conversation.messages.find((item) => item.role !== "system" && item.content.trim());
  if (!message) return "A new conversation";
  return message.content.split(/\n\n\[(?:attached file|retrieved document context)/i)[0].replace(/\s+/g, " ").trim().slice(0, 120);
}

function recentMeta(conversation: ConversationRecord) {
  const date = new Date(conversation.updatedAt);
  const dateLabel = Number.isNaN(date.getTime()) ? "Recent" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  const count = conversation.messages.filter((message) => message.role !== "system").length;
  return `${dateLabel} · ${count} ${count === 1 ? "message" : "messages"}`;
}

function dateTimeValue(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function HomeScreen() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [recent, setRecent] = useState<ConversationRecord[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const conversations = await getConversations();
        if (active) setRecent(conversations.sort((a, b) => b.updatedAt - a.updatedAt).filter((item) => item.messages.some((message) => message.role !== "system")).slice(0, 5));
      } catch { if (active) setRecent([]); }
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
  }, []);

  function startConversation(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const value = prompt.trim();
    if (value) router.push(`/chat?prompt=${encodeURIComponent(value)}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      startConversation();
    }
  }

  function openChatWithDraft() {
    router.push(`/chat${prompt.trim() ? `?draft=${encodeURIComponent(prompt.trim())}` : ""}`);
  }

  async function copyConversationLink(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/chat?id=${encodeURIComponent(id)}`);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1400);
    } catch { /* Copying is optional; the chat remains available from its card. */ }
  }

  return <AppShell><main className="screen clean-home-screen paper-home-screen">
    <section className="home-hero" aria-labelledby="home-title">
      <h1 id="home-title">Good morning</h1>
      <p>What should we build today?</p>
    </section>

    <form className="home-composer" onSubmit={startConversation} aria-label="Start a conversation">
      <button className="home-composer-add" type="button" onClick={openChatWithDraft} aria-label="Open chat to add a file or context" title="Open chat to add a file or context"><Plus size={20} strokeWidth={1.5} /></button>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} rows={1} maxLength={20000} placeholder="Ask anything, create, or build…" aria-label="Ask ELIAS anything" />
      <button className="home-composer-send" type="submit" disabled={!prompt.trim()} aria-label="Start conversation"><ArrowUp size={19} strokeWidth={1.6} /></button>
    </form>

    <section className="home-recent" aria-labelledby="recent-chats-title">
      <div className="home-recent-heading"><h2 id="recent-chats-title">Recent chats</h2><Link href="/tasks" className="home-task-history-link"><ListChecks size={14} /> Task history</Link></div>
      <div className="home-recent-list">{recent.length ? recent.map((conversation) => <article className="home-recent-card" key={conversation.id}>
        <Link className="home-recent-card-main" href={`/chat?id=${encodeURIComponent(conversation.id)}`}>
          <strong>{conversation.title || "Untitled conversation"}</strong>
          <span className="home-recent-description">{previewText(conversation)}</span>
          <time className="home-recent-meta" dateTime={dateTimeValue(conversation.updatedAt)}>{recentMeta(conversation)}</time>
        </Link>
        <button className="home-recent-copy" type="button" onClick={() => void copyConversationLink(conversation.id)} aria-label={copiedId === conversation.id ? "Conversation link copied" : `Copy link to ${conversation.title || "conversation"}`} title="Copy link">{copiedId === conversation.id ? <Check size={17} /> : <Copy size={16} strokeWidth={1.5} />}<span>{copiedId === conversation.id ? "Copied" : "Copy link"}</span></button>
      </article>) : <p className="home-recent-empty">Your recent conversations will appear here.</p>}</div>
    </section>
  </main></AppShell>;
}
