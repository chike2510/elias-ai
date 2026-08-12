"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Composer from "@/components/Composer";
import ScreenHeader from "@/components/ScreenHeader";

type Message = { role: "user" | "assistant"; content: string; provider?: string };

function splitFence(text: string) {
  const chunks = text.split(/```/g);
  return chunks.map((chunk, i) => i % 2 === 1 ? <pre key={i}><code>{chunk.replace(/^[a-zA-Z0-9_-]+\n/, "")}</code></pre> : <span key={i}>{chunk}</span>);
}

export default function ChatScreen() {
  const params = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const prompt = params.get("prompt");
    if (prompt && !messages.length) void send(prompt);
  }, [params]);

  async function send(value: string) {
    const next = [...messages, { role: "user" as const, content: value }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ task: inferTask(value), messages: next })
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.content || data.error, provider: data.provider }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "ELIAS could not reach an inference provider. Check the provider environment variables." }]);
    } finally { setBusy(false); }
  }

  return <AppShell title="Conversation">
    <main className="screen chat-screen">
      <ScreenHeader title="Conversation" />
      <div className="chat-body">
        {!messages.length && <div className="empty-chat"><div className="brand-mark large"><span>∿</span></div><h2>talk to ELIAS</h2><p>Ask, build, research, study, or upload something to get started.</p></div>}
        {messages.map((m, i) => <article className={`bubble ${m.role}`} key={i}><div>{m.role === "assistant" ? splitFence(m.content) : m.content}</div>{m.provider && <small className="provider-tag">{m.provider}</small>}</article>)}
        {busy && <div className="bubble assistant"><span className="typing">ELIAS is working<span>.</span><span>.</span><span>.</span></span></div>}
      </div>
      <Composer onSubmit={send} />
    </main>
  </AppShell>;
}

function inferTask(v: string): "general"|"code"|"research"|"study" {
  const s = v.toLowerCase();
  if (/research|latest|today|current|news|source|search the web/.test(s)) return "research";
  if (/study|exam|notes|flashcard|pdf|chapter|explain this document/.test(s)) return "study";
  if (/code|build|bug|debug|tsx|jsx|html|css|typescript|javascript|repository|github/.test(s)) return "code";
  return "general";
}