"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUp, Camera, ChevronRight, LoaderCircle, Menu, Mic, Paperclip, Plus, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  getConversation,
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

export default function ChatScreen() {
  const params = useSearchParams();
  const requestedId = params.get("id");
  const requestedPrompt = params.get("prompt");
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<
    Array<{ name: string; context?: string }>
  >([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadConversation(requestedId, requestedPrompt);
  }, [requestedId, requestedPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, busy]);

  async function loadConversation(id: string | null, prompt: string | null) {
    if (id) {
      const existing = await getConversation(id);
      if (existing) {
        setConversation(existing);
        return;
      }
    }

    const nextConversation: ConversationRecord = {
      id: makeId("chat"),
      title: "New conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    setConversation(nextConversation);
    if (prompt && !requestedId) {
      setInput(prompt);
    }
  }

  async function persist(next: ConversationRecord) {
    setConversation(next);
    await saveConversation(next);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !conversation) return;

    const attachmentContext = attachments
      .filter((file) => file.context)
      .map(
        (file) =>
          `\n\n[attached file: ${file.name}]\n${file.context!.slice(0, 60_000)}`,
      )
      .join("");

    const userMessage: ConversationMessage = {
      id: makeId("msg"),
      role: "user",
      content: `${text}${attachmentContext}`,
      createdAt: Date.now(),
    };

    const title =
      conversation.messages.length === 0
        ? text.slice(0, 58) + (text.length > 58 ? "…" : "")
        : conversation.title;

    const optimistic: ConversationRecord = {
      ...conversation,
      title,
      updatedAt: Date.now(),
      messages: [...conversation.messages, userMessage],
    };

    setInput("");
    setAttachments([]);
    await persist(optimistic);
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: inferTask(text),
          messages: optimistic.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "ELIAS could not respond.");
      }

      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: data.content,
        provider: data.provider,
        status: "complete",
        createdAt: Date.now(),
      };

      await persist({
        ...optimistic,
        updatedAt: Date.now(),
        messages: [...optimistic.messages, assistant],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ELIAS failed.";
      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: message,
        status: "error",
        createdAt: Date.now(),
      };

      await persist({
        ...optimistic,
        updatedAt: Date.now(),
        messages: [...optimistic.messages, assistant],
      });
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;

    const next: Array<{ name: string; context?: string }> = [];

    for (const file of Array.from(list)) {
      if (file.size > 20_000_000) {
        next.push({ name: file.name });
        continue;
      }

      if (
        /\.(ts|tsx|js|jsx|html|css|scss|md|txt|json|py|java|sql)$/i.test(
          file.name,
        )
      ) {
        try {
          next.push({
            name: file.name,
            context: await file.text(),
          });
          continue;
        } catch {}
      }

      if (/\.(pdf|docx|xlsx|xls|csv)$/i.test(file.name)) {
        try {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/documents/extract", {
            method: "POST",
            body: form,
          });
          const data = await response.json();
          next.push({
            name: file.name,
            context: response.ok ? data.text : undefined,
          });
          continue;
        } catch {}
      }

      next.push({ name: file.name });
    }

    setAttachments((current) => [...current, ...next]);
  }

  const messages = useMemo(
    () => conversation?.messages ?? [],
    [conversation],
  );

  return (
    <AppShell title="Chat">
      <main className="screen chat-screen">
        <div className="chat-head">
          <div>
            <p className="eyebrow">ELIAS</p>
            <h1>{conversation?.title || "New conversation"}</h1>
          </div>
          <div className="chat-head-actions">
            <Link href="/chat" className="chat-new">
              <Plus size={15} />
              new
            </Link>
          </div>
        </div>

        <div className="chat-body">
          {!messages.length ? (
            <div className="chat-empty">
              <div className="brand-mark large">
                <Sparkles size={27} />
              </div>
              <h2>what are we working on?</h2>
              <p>
                Talk normally. ELIAS can switch from conversation to coding,
                research, study, or agent work without starting a separate app.
              </p>
              <div className="chat-suggestions">
                <button onClick={() => setInput("review this project architecture and tell me what you'd improve")}>
                  Review a project
                  <ChevronRight size={14} />
                </button>
                <button onClick={() => setInput("research the latest changes in Next.js")}>
                  Research something current
                  <ChevronRight size={14} />
                </button>
                <button onClick={() => setInput("teach me this topic like an exam tutor")}>
                  Study with ELIAS
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              key={message.id}
              className={`chat-message ${message.role} ${message.status === "error" ? "error" : ""}`}
            >
              <div className="chat-avatar">
                {message.role === "assistant" ? <Sparkles size={14} /> : "you"}
              </div>
              <div className="chat-message-body">
                <span className="chat-role">
                  {message.role === "assistant"
                    ? `ELIAS${message.provider ? ` · ${message.provider}` : ""}`
                    : "you"}
                </span>
                <div className="chat-content">{message.content}</div>

                {message.role === "assistant" &&
                message.content.length > 1200 &&
                /\b(tsx|tsx|jsx|html|css|javascript|typescript|python|java|sql)\b/i.test(
                  message.content,
                ) ? (
                  <Link
                    href={`/agent?fromChat=${encodeURIComponent(conversation?.id ?? "")}`}
                    className="chat-agent-action"
                  >
                    <WandSparkles size={14} />
                    continue this in the coding workspace
                  </Link>
                ) : null}
              </div>
            </article>
          ))}

          {busy ? (
            <div className="chat-message assistant">
              <div className="chat-avatar">
                <LoaderCircle size={14} className="spin" />
              </div>
              <div className="chat-message-body">
                <span className="chat-role">ELIAS</span>
                <div className="chat-content typing-line">working…</div>
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        {attachments.length ? (
          <div className="attachment-strip">
            {attachments.map((file) => (
              <span key={`${file.name}-${file.context?.length || 0}`}>
                {file.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="chat-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={3}
            placeholder="Message ELIAS…"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />

          <input
            ref={uploadRef}
            hidden
            type="file"
            multiple
            accept=".zip,.ts,.tsx,.js,.jsx,.html,.css,.md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />

          <div className="chat-composer-bar">
            <div className="composer-left">
              <button onClick={() => uploadRef.current?.click()} title="Attach files">
                <Paperclip size={17} />
              </button>
              <button onClick={() => window.location.href = "/studio"} title="Voice">
                <Mic size={17} />
              </button>
              <button onClick={() => window.location.href = "/studio"} title="Camera">
                <Camera size={17} />
              </button>
            </div>

            <button className="chat-send" disabled={busy || !input.trim()} onClick={() => void send()}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
