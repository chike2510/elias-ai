"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Camera, Check, ChevronRight, Copy, FolderPlus, Link2, LoaderCircle, MessageSquare, Mic, Paperclip, Plus, Sparkles, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import { readApiResponse } from "@/lib/clientApi";
import { cacheTaskSnapshot } from "@/lib/clientTask";
import type { TaskRecord } from "@/lib/task";
import { getConversation,
  getConversations,
  makeId,
  saveConversation,
  type ConversationMessage,
  type ConversationRecord,
} from "@/lib/persistence";

function inferTask(value: string): "code" | "research" | "study" | "general" {
  const text = value.toLowerCase();
  if (/research|latest|current|today|news|source|search the web/.test(text)) return "research";
  if (/study|exam|notes|flashcard|pdf|chapter|document/.test(text)) return "study";
  if (/build|code|bug|debug|tsx|jsx|html|css|typescript|javascript|repository|github|refactor|implement/.test(text)) return "code";
  return "general";
}

function shouldHandoffToTask(value: string, attachments: Array<{ name: string; context?: string }>) {
  return attachments.length > 0 || /create|generate|build|make|write|produce|download|pdf|report|document|file|artifact|deliverable|research|latest|current|source|code|debug|refactor|repository|project|implement|study|exam|notes/i.test(value);
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedId = params.get("id");
  const requestedPrompt = params.get("prompt");
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [history, setHistory] = useState<ConversationRecord[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; context?: string }>>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void getConversations().then(setHistory).catch(() => setHistory([]));
    let active = true;
    async function load() {
      if (requestedId) {
        const existing = await getConversation(requestedId);
        if (active && existing) {
          setConversation(existing);
          return;
        }
      }
      if (!active) return;
      const now = Date.now();
      setConversation({ id: makeId("chat"), title: "New conversation", createdAt: now, updatedAt: now, messages: [] });
      if (requestedPrompt && !requestedId) setInput(requestedPrompt);
    }
    void load();
    return () => { active = false; };
  }, [requestedId, requestedPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, busy]);

  async function persist(next: ConversationRecord) {
    setConversation(next);
    await saveConversation(next);
  }

  async function sendMessage(value: string, retry = false) {
    const text = value.trim();
    if (!text || busy || !conversation) return;

    const base = retry
      ? { ...conversation, messages: conversation.messages.filter((message) => message.status !== "error") }
      : conversation;
    const attachmentContext = retry ? "" : attachments.filter((file) => file.context).map((file) => `\n\n[attached file: ${file.name}]\n${file.context!.slice(0, 60_000)}`).join("");
    const userMessage: ConversationMessage = {
      id: makeId("msg"),
      role: "user",
      content: `${text}${attachmentContext}`,
      createdAt: Date.now(),
    };
    const title = base.messages.length === 0 ? text.slice(0, 58) + (text.length > 58 ? "…" : "") : base.title;
    const optimistic: ConversationRecord = retry
      ? { ...base, title, updatedAt: Date.now() }
      : { ...base, title, updatedAt: Date.now(), messages: [...base.messages, userMessage] };

    setInput("");
    setAttachments([]);
    await persist(optimistic);
    if (!requestedId) router.replace(`/chat?id=${encodeURIComponent(optimistic.id)}`);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (shouldHandoffToTask(text, attachments)) {
        const taskResponse = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: `${text}${attachmentContext}`,
            kind: inferTask(text),
            conversationId: optimistic.id,
            autoStart: true,
          }),
          signal: controller.signal,
        });
        const taskData = await readApiResponse<{ task: TaskRecord }>(taskResponse);
        cacheTaskSnapshot(taskData.task);
        const taskMessage: ConversationMessage = {
          id: makeId("msg"),
          role: "assistant",
          content: `I turned this into a live task and started the workbench.\n\n[Open the task workspace](/tasks?id=${encodeURIComponent(taskData.task.id)})\n\nStatus: **${taskData.task.status}**${taskData.task.error ? `\n\n${taskData.task.error}` : ""}`,
          provider: "task orchestrator",
          model: "task runtime",
          status: "complete",
          createdAt: Date.now(),
        };
        await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, taskMessage] });
        router.push(`/tasks?id=${encodeURIComponent(taskData.task.id)}`);
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: inferTask(text), messages: optimistic.messages.map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal,
      });
      const data = await readApiResponse<{ content: string; provider?: string; model?: string }>(response);
      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: data.content,
        provider: data.provider,
        model: data.model,
        status: "complete",
        createdAt: Date.now(),
      };
      await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistant] });
    } catch (error) {
      if (controller.signal.aborted) return;
      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: error instanceof Error ? error.message : "ELIAS failed to respond.",
        status: "error",
        createdAt: Date.now(),
      };
      await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistant] });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const next: Array<{ name: string; context?: string }> = [];
    for (const file of Array.from(list)) {
      if (file.size > 20_000_000) {
        next.push({ name: `${file.name} · too large` });
        continue;
      }
      if (/\.(ts|tsx|js|jsx|html|css|scss|md|txt|json|py|java|sql)$/i.test(file.name)) {
        try { next.push({ name: file.name, context: await file.text() }); continue; } catch { /* show as name only */ }
      }
      if (/\.(pdf|docx|xlsx|xls|csv)$/i.test(file.name)) {
        try {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/documents/extract", { method: "POST", body: form });
          const data = await readApiResponse<{ text?: string }>(response);
          next.push({ name: file.name, context: data.text });
          continue;
        } catch { /* show as name only */ }
      }
      next.push({ name: file.name });
    }
    setAttachments((current) => [...current, ...next]);
  }

  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);
  const lastUser = [...messages].reverse().find((message) => message.role === "user");

  return (
    <AppShell title="Chat">
      <main className="screen chat-screen">
        <aside className="chat-history-panel">
          <div className="chat-history-heading"><strong>Conversations</strong><Link href="/chat" aria-label="New conversation"><Plus size={16} /></Link></div>
          <div className="history-search"><span>⌕</span><input aria-label="Search conversations" placeholder="Search conversations" /></div>
          <span className="history-group-label">Recent</span>
          {history.length ? history.slice(0, 7).map((item) => <Link key={item.id} href={`/chat?id=${encodeURIComponent(item.id)}`} className={`history-row ${item.id === conversation?.id ? "active" : ""}`}><span className="history-bullet"><MessageSquare size={14} /></span><span><strong>{item.title}</strong><small>{item.messages?.[0]?.content?.slice(0, 28) || "Conversation context"}</small></span></Link>) : <div className="history-empty"><MessageSquare size={16} /><strong>No conversations yet</strong><small>Start a conversation and your history will appear here.</small></div>}
          <span className="history-group-label">Workspace</span>
          <Link href="/tasks" className="history-row history-task-link"><span className="history-bullet"><Check size={14} /></span><span><strong>Active tasks</strong><small>View execution history</small></span></Link>
        </aside>
        <div className="chat-head">
          <div><p className="eyebrow">ELIAS / conversation</p><h1>{conversation?.title || "New conversation"}</h1></div>
          <div className="chat-head-actions"><div className="chat-add-wrap"><button type="button" className="chat-add" aria-expanded={contextOpen} onClick={() => setContextOpen((open) => !open)}><Plus size={15} /> add</button>{contextOpen ? <div className="chat-add-menu"><strong>Add to this conversation</strong><a href="/api/connect/github"><Link2 size={14} /> Connect GitHub</a><a href="/api/connect/vercel"><FolderPlus size={14} /> Connect Vercel</a><Link href="/tasks"><Sparkles size={14} /> Link a task</Link><button type="button" onClick={() => setContextOpen(false)}><X size={14} /> Close</button></div> : null}</div><Link href="/chat" className="chat-new"><Plus size={15} /> new</Link></div>
        </div>

        <div className="chat-body">
          {!messages.length ? (
            <div className="chat-empty">
              <div className="brand-mark large"><Sparkles size={27} /></div>
              <h2>what are we working on?</h2>
              <p>Talk normally. ELIAS can switch between conversation, coding, research, study, and agent work without losing the thread.</p>
              <div className="chat-suggestions">
                <button onClick={() => setInput("review this project architecture and tell me what you would improve")}><span>Review a project</span><ChevronRight size={14} /></button>
                <button onClick={() => setInput("research the latest changes in Next.js and cite your sources")}><span>Research something current</span><ChevronRight size={14} /></button>
                <button onClick={() => setInput("teach me this topic like an exam tutor")}><span>Study with ELIAS</span><ChevronRight size={14} /></button>
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role} ${message.status === "error" ? "error" : ""}`}>
              <div className="chat-avatar">{message.role === "assistant" ? <Sparkles size={14} /> : "you"}</div>
              <div className="chat-message-body">
                <span className="chat-role">{message.role === "assistant" ? `ELIAS${message.provider ? ` · ${message.provider}` : ""}` : "you"}</span>
                {message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <div className="chat-content user-content">{message.content}</div>}
                {message.role === "assistant" ? (
                  <div className="message-actions">
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(message.content); setCopied(message.id); window.setTimeout(() => setCopied(null), 1400); }}>
                      {copied === message.id ? <Check size={13} /> : <Copy size={13} />} {copied === message.id ? "copied" : "copy"}
                    </button>
                    {message.status === "error" && lastUser ? <button type="button" onClick={() => void sendMessage(lastUser.content, true)}><LoaderCircle size={13} /> retry</button> : null}
                  </div>
                ) : null}
                {message.role === "assistant" && message.status !== "error" && message.content.length > 1200 && /\b(tsx|jsx|html|css|javascript|typescript|python|java|sql)\b/i.test(message.content) ? (
                  <Link href={`/agent?fromChat=${encodeURIComponent(conversation?.id ?? "")}`} className="chat-agent-action"><WandSparkles size={14} /> continue in coding workspace</Link>
                ) : null}
              </div>
            </article>
          ))}

          {busy ? <div className="chat-message assistant"><div className="chat-avatar"><LoaderCircle size={14} className="spin" /></div><div className="chat-message-body"><span className="chat-role">ELIAS</span><div className="chat-content typing-line">working…</div></div></div> : null}
          <div ref={bottomRef} />
        </div>

        {attachments.length ? <div className="attachment-strip">{attachments.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></span>)}</div> : null}

        <aside className="chat-context-panel">
          <div className="context-heading"><strong>Active context</strong><span>•••</span></div>
          <div className="context-block"><span className="context-label">Project</span><Link href="/projects" className="context-item"><span className="context-icon"><FolderIcon /></span><span><strong>Orion Platform</strong><small>Platform redesign</small></span><ChevronRight size={14} /></Link></div>
          <div className="context-block"><span className="context-label">Linked task</span><Link href="/tasks" className="context-item"><span className="context-icon violet"><ListIcon /></span><span><strong>Launch brief research</strong><small><i className="live-dot" /> Ready to start</small></span><ChevronRight size={14} /></Link></div>
          <div className="context-summary"><span className="context-label">Context summary</span><p>Elias will use the active project and linked task to ground responses and deliverables.</p></div>
          <Link href="/projects" className="secondary context-manage">Manage context</Link>
        </aside>
        <div className="chat-composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={3} placeholder="Message ELIAS…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } }} />
          <input ref={uploadRef} hidden type="file" multiple accept=".zip,.ts,.tsx,.js,.jsx,.html,.css,.md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ""; }} />
          <div className="chat-composer-bar">
            <div className="composer-left"><button type="button" onClick={() => uploadRef.current?.click()} title="Attach files" aria-label="Attach files"><Paperclip size={17} /><span>attach</span></button><Link href="/studio?mode=voice" title="Voice"><Mic size={17} /></Link><Link href="/studio?mode=camera" title="Camera"><Camera size={17} /></Link></div>
            {busy ? <button className="chat-send stop-button" type="button" onClick={stop} title="Stop generation"><X size={18} /></button> : <button className="chat-send" type="button" disabled={!input.trim()} onClick={() => void sendMessage(input)}><ArrowUp size={18} /></button>}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function FolderIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>; }
function ListIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>; }
