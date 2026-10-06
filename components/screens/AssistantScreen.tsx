"use client";

import { ArrowUp, Brain, CalendarClock, Check, Loader2, Mail, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import MarkdownMessage from "@/components/MarkdownMessage";

type Message = { id: number | string; role: "user" | "assistant" | "event"; content: string; meta?: Record<string, unknown>; createdAt?: string };
type Approval = { id: string; tool: string; summary: string; status: string; conversationId: string | null; result?: string | null };
type Conversation = { id: string; title: string; kind: string; updatedAt: string; pendingApprovals: number };
type Memory = { id: string; kind: string; content: string; source: string };
type Schedule = { id: string; name: string; when: string; status: string; nextRunAt: string | null; lastResult: string | null };
type Status = { database: boolean; providers: string[]; google: { configured: boolean; connected: boolean; email: string | null }; browser: { configured: boolean }; github: { connected: boolean }; scheduler: { configured: boolean } };
type Panel = "chat" | "memory" | "schedules";

const timezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Africa/Lagos";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
  const data = await response.json().catch(() => ({ ok: false, error: { message: `HTTP ${response.status}` } }));
  if (!data.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
  return data as T;
}

export default function AssistantScreen() {
  const [panel, setPanel] = useState<Panel>("chat");
  const [status, setStatus] = useState<Status | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(() => api<{ conversations: Conversation[] }>("/api/assistant/conversations").then((data) => setConversations(data.conversations)).catch(() => undefined), []);
  const loadConversation = useCallback(async (id: string) => {
    const data = await api<{ messages: Message[]; approvals: Approval[] }>(`/api/assistant/conversations/${id}`);
    setConversationId(id); setMessages(data.messages); setApprovals(data.approvals);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setError(params.get("error") === "google_not_configured" ? "Google isn't set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." : `Connection failed: ${params.get("error")}`);
    void api<Status>("/api/assistant/status").then(setStatus).catch((err: Error) => setError(err.message));
    void loadConversations();
    const saved = window.localStorage.getItem("elias.assistant.conversation");
    if (saved) void loadConversation(saved).catch(() => window.localStorage.removeItem("elias.assistant.conversation"));
  }, [loadConversation, loadConversations]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);
  useEffect(() => { if (conversationId) window.localStorage.setItem("elias.assistant.conversation", conversationId); }, [conversationId]);
  useEffect(() => {
    if (panel === "memory") void api<{ memories: Memory[] }>("/api/assistant/memories").then((data) => setMemories(data.memories)).catch((err: Error) => setError(err.message));
    if (panel === "schedules") void api<{ schedules: Schedule[] }>("/api/assistant/schedules").then((data) => setSchedules(data.schedules)).catch((err: Error) => setError(err.message));
  }, [panel]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true); setError(null);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: text }]);
    try {
      const result = await api<{ conversationId: string; reply: string; approvals: Approval[] }>("/api/assistant/chat", { method: "POST", body: JSON.stringify({ text, conversationId, timezone }) });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { id: `reply-${Date.now()}`, role: "assistant", content: result.reply }]);
      if (result.approvals.length) setApprovals((current) => [...result.approvals, ...current]);
      void loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Elias couldn't answer.");
    } finally { setBusy(false); }
  }

  async function decide(approval: Approval, decision: "approve" | "decline") {
    setBusy(true); setError(null);
    setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, status: decision === "approve" ? "running" : "declined" } : item));
    try {
      const result = await api<{ conversationId: string; reply: string }>(`/api/assistant/approvals/${approval.id}`, { method: "POST", body: JSON.stringify({ decision, timezone }) });
      await loadConversation(result.conversationId);
    } catch (err) { setError(err instanceof Error ? err.message : "Approval failed."); if (conversationId) void loadConversation(conversationId); }
    finally { setBusy(false); }
  }

  function newChat() { setConversationId(undefined); setMessages([]); setApprovals([]); setShowList(false); setPanel("chat"); window.localStorage.removeItem("elias.assistant.conversation"); }

  const pending = approvals.filter((item) => item.status === "pending");
  const visible = messages.filter((item) => item.role !== "event");

  return (
    <AppShell title="Elias">
      <main className="screen assistant-screen">
        <header className="assistant-top">
          <div className="assistant-tabs">
            <button className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")}><MessageSquare size={15} /> Chat</button>
            <button className={panel === "memory" ? "active" : ""} onClick={() => setPanel("memory")}><Brain size={15} /> Memory</button>
            <button className={panel === "schedules" ? "active" : ""} onClick={() => setPanel("schedules")}><CalendarClock size={15} /> Scheduled</button>
          </div>
          <div className="assistant-actions">
            {status && (status.google.connected
              ? <span className="assistant-chip ok"><Mail size={13} /> {status.google.email || "Google"}</span>
              : <a className="assistant-chip" href="/api/connect/google"><Mail size={13} /> Connect Google</a>)}
            <button className="assistant-chip" onClick={() => setShowList((value) => !value)}>History</button>
            <button className="assistant-chip" onClick={newChat}><Plus size={13} /> New</button>
          </div>
        </header>

        {showList && <nav className="assistant-history">
          {conversations.length === 0 && <p className="assistant-muted">No conversations yet.</p>}
          {conversations.map((item) => <button key={item.id} className={item.id === conversationId ? "active" : ""} onClick={() => { void loadConversation(item.id); setShowList(false); setPanel("chat"); }}>
            <span>{item.kind === "schedule" ? "⏰ " : ""}{item.title}</span>{item.pendingApprovals > 0 && <em>{item.pendingApprovals}</em>}
          </button>)}
        </nav>}

        {error && <div className="assistant-error" role="alert">{error}<button onClick={() => setError(null)} aria-label="Dismiss"><X size={14} /></button></div>}

        {panel === "chat" && <>
          <section className="assistant-thread">
            {visible.length === 0 && !busy && <div className="assistant-empty">
              <h2>What can I take off your plate?</h2>
              <p>I remember what you tell me, read your email and calendar, browse the web, and run things on a schedule. Anything that sends, books or pays waits for your tap.</p>
              <div className="assistant-suggestions">
                {["What's in my inbox that needs me today?", "Every weekday at 8am, brief me on my calendar and unread email", "Remember I prefer window seats and no red-eyes", "Find the best-rated suya spot near me"].map((text) => <button key={text} onClick={() => setInput(text)}>{text}</button>)}
              </div>
            </div>}
            {visible.map((message) => <div key={message.id} className={`assistant-bubble ${message.role}`}>
              {message.role === "assistant" ? <MarkdownMessage content={message.content} /> : message.content}
            </div>)}
            {pending.map((approval) => <div key={approval.id} className="assistant-approval">
              <strong>Needs your go-ahead</strong>
              <pre>{approval.summary}</pre>
              <div><button className="approve" disabled={busy} onClick={() => void decide(approval, "approve")}><Check size={14} /> Approve</button><button disabled={busy} onClick={() => void decide(approval, "decline")}><X size={14} /> Decline</button></div>
            </div>)}
            {busy && <div className="assistant-bubble assistant typing"><Loader2 size={14} className="spin" /> Working…</div>}
            <div ref={endRef} />
          </section>
          <form className="assistant-composer" onSubmit={send}>
            <textarea value={input} rows={1} placeholder="Message Elias" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send"><ArrowUp size={18} /></button>
          </form>
        </>}

        {panel === "memory" && <section className="assistant-list">
          <p className="assistant-muted">What Elias remembers about you. It learns from your chats; delete anything that's wrong.</p>
          {memories.length === 0 && <p className="assistant-muted">Nothing saved yet.</p>}
          {memories.map((memory) => <div key={memory.id} className="assistant-row"><span className="tag">{memory.kind}</span><p>{memory.content}</p>
            <button aria-label="Forget" onClick={() => void api(`/api/assistant/memories/${memory.id}`, { method: "DELETE" }).then(() => setMemories((current) => current.filter((item) => item.id !== memory.id)))}><Trash2 size={14} /></button></div>)}
        </section>}

        {panel === "schedules" && <section className="assistant-list">
          <p className="assistant-muted">Ask in chat to set one up, like "every Monday at 9am, summarise my week".{status && !status.scheduler.configured ? " The scheduler isn't configured on the server yet (CRON_SECRET)." : ""}</p>
          {schedules.length === 0 && <p className="assistant-muted">No scheduled tasks.</p>}
          {schedules.map((item) => <div key={item.id} className="assistant-row"><span className="tag">{item.status}</span><p><strong>{item.name}</strong><br />{item.when}{item.nextRunAt ? ` · next ${new Date(item.nextRunAt).toLocaleString()}` : ""}</p>
            <button aria-label="Cancel" onClick={() => void api(`/api/assistant/schedules/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }).then(() => setSchedules((current) => current.filter((row) => row.id !== item.id)))}><Trash2 size={14} /></button></div>)}
        </section>}
      </main>
    </AppShell>
  );
}
