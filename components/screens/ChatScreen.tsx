"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, AudioLines, CalendarClock, Camera, Check, ChevronRight, Clapperboard, Copy, FileClock, FileText, FolderOpen, FolderPlus, Gamepad2, ImagePlus, Link2, ListChecks, LoaderCircle, MessageSquare, Mic, Monitor, Paperclip, Plus, Puzzle, Sparkles, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import GoalProgressCard from "@/components/GoalProgressCard";
import MarkdownMessage from "@/components/MarkdownMessage";
import { readApiResponse } from "@/lib/clientApi";
import { cacheTaskSnapshot } from "@/lib/clientTask";
import type { TaskRecord } from "@/lib/task";
import { getArtifacts,
  getConversation,
  getConversations,
  makeId,
  saveArtifact,
  saveConversation,
  recordAutomaticSignal,
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

type ModelOption = { id: string; provider: string; label: string; detail: string; configured?: boolean };
type VercelMcpStatus = { configured?: boolean; connected?: boolean; message?: string; tools?: Array<{ name: string; description?: string }> };
type Attachment = { name: string; context?: string; status?: "uploading" | "ready" | "error"; progress?: number; error?: string; documentId?: string; source?: File };

const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  { id: "auto", provider: "auto", label: "Auto", detail: "Best model for the task", configured: true },
  { id: "qwen:qwen3.7-plus", provider: "qwen", label: "Qwen 3.7 Plus", detail: "Qwen · general / code" },
  { id: "qwen:qwen3.7-flash", provider: "qwen", label: "Qwen 3.7 Flash", detail: "Qwen · fast reasoning" },
  { id: "agentrouter:kimi-k2.6", provider: "agentrouter", label: "Kimi K2.6", detail: "AgentRouter · reasoning" },
  { id: "agentrouter:glm-5.1", provider: "agentrouter", label: "GLM 5.1", detail: "AgentRouter · general" },
  { id: "agentrouter:step3p5-code-alpha", provider: "agentrouter", label: "Step 3.5 Code", detail: "AgentRouter · coding" },
  { id: "cerebras:zai-glm-4.7", provider: "cerebras", label: "GLM 4.7", detail: "Cerebras · fast reasoning" },
  { id: "mistral:mistral-large-latest", provider: "mistral", label: "Mistral Large", detail: "Mistral · writing / study" },
  { id: "groq:openai/gpt-oss-120b", provider: "groq", label: "GPT OSS 120B", detail: "Groq · fast responses" },
  { id: "openrouter:openrouter/free", provider: "openrouter", label: "OpenRouter Free", detail: "OpenRouter · automatic free route" },
];

function shouldHandoffToTask(value: string, attachments: Attachment[]) {
  if (attachments.length > 0) return true;
  const text = value.trim();
  if (text.length < 12) return false;
  const explicitWork = /\b(create|generate|build|make|write|produce|download|develop|implement|refactor|debug|review|research|study|analy[sz]e|compare|summari[sz]e)\b/i.test(text);
  const liveResearch = /\b(latest|current|today|yesterday|recent|live)\b/i.test(text) && /\b(update|news|result|score|fixture|match|source|sources|citation|verify|research|report)\b/i.test(text);
  return (explicitWork || liveResearch) && /\b(report|pdf|document|file|artifact|website|web app|app|page|screen|dashboard|repository|repo|project|code|source|paper|slides|presentation|chapter|notes|exam|course|latest|current|sources|citations|interface|ui|ux|design|feature|bug|component|update|news|result|score|fixture|match|verify)\b/i.test(text);
}

function normalizeConversation(value: ConversationRecord): ConversationRecord {
  const messages = Array.isArray(value.messages) ? value.messages.filter((message) => message && typeof message.content === "string").map((message) => ({ ...message, role: (message.role === "assistant" || message.role === "system" ? message.role : "user") as ConversationMessage["role"], content: message.content })) : [];
  return { ...value, id: value.id || makeId("chat"), title: value.title || "Conversation", messages };
}

function inlineArtifactHref(taskId: string, artifact: TaskRecord["artifacts"][number]) {
  if (artifact.content !== undefined) {
    if (artifact.encoding === "base64") return `data:${artifact.type};base64,${artifact.content}`;
    return `data:${artifact.type},${encodeURIComponent(artifact.content)}`;
  }
  return `/api/tasks/${encodeURIComponent(taskId)}/artifact/${encodeURIComponent(artifact.id)}`;
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedId = params.get("id");
  const requestedPrompt = params.get("prompt");
  const requestedDocumentId = params.get("documentId");
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [history, setHistory] = useState<ConversationRecord[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskMode, setTaskMode] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activeDocumentIds, setActiveDocumentIds] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [vercelStatus, setVercelStatus] = useState<VercelMcpStatus | null>(null);
  const [recentArtifacts, setRecentArtifacts] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void getConversations().then(setHistory).catch(() => setHistory([]));
    void getArtifacts().then((items) => setRecentArtifacts(items.slice(0, 4).map(({ id, name, type }) => ({ id, name, type })))).catch(() => setRecentArtifacts([]));
    void fetch("/api/models").then((response) => response.ok ? response.json() as Promise<{ models?: ModelOption[] }> : Promise.reject(new Error("models unavailable"))).then((data) => {
      if (Array.isArray(data.models) && data.models.length) setModelOptions(data.models);
    }).catch(() => undefined);
    let active = true;
    async function load() {
      setActiveTask(null);
      setTaskMode(false);
      try {
        if (requestedId) {
          const existing = await getConversation(requestedId);
          if (active && existing) {
          setConversation(normalizeConversation(existing));
            return;
          }
        }
      } catch {
        // A stale or corrupted local conversation must not take down the Chat route.
      }
      if (!active) return;
      if (requestedDocumentId) setActiveDocumentIds([requestedDocumentId]);
      const now = Date.now();
      setConversation({ id: requestedId || makeId("chat"), title: "New conversation", createdAt: now, updatedAt: now, messages: [] });
      if (requestedPrompt) setInput(requestedPrompt);
    }
    void load();
    return () => { active = false; };
  }, [requestedId, requestedPrompt, requestedDocumentId]);

  useEffect(() => {
    if (!conversation?.id) return;
    void fetch(`/api/tasks?conversationId=${encodeURIComponent(conversation.id)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ tasks?: TaskRecord[] }> : Promise.reject(new Error("task lookup failed")))
      .then((data) => {         const latest = data.tasks?.[0]; if (latest) { setActiveTask(latest); cacheTaskSnapshot(latest); } })
      .catch(() => undefined);
  }, [conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, busy, activeTask?.events.length]);

  useEffect(() => {
    if (!activeTask?.id) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(activeTask.id)}`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const payload = await response.json() as { task?: TaskRecord };
        const latest = payload.task;
        if (!latest || stopped) return;
        setActiveTask(latest);
        cacheTaskSnapshot(latest);
        if (["completed", "failed", "cancelled"].includes(latest.status) && timer !== undefined) window.clearInterval(timer);
      } catch { /* keep the inline task state while the network recovers */ }
    };
    void poll();
    timer = window.setInterval(() => { void poll(); }, 1200);
    return () => { stopped = true; if (timer !== undefined) window.clearInterval(timer); };
  }, [activeTask?.id]);

  async function persist(next: ConversationRecord) {
    setConversation(next);
    try {
      await saveConversation(next);
    } catch {
      // Chat must remain usable when browser storage is blocked, unavailable, or corrupted.
      // The conversation remains in React state for the current session.
    }
  }

  async function sendMessage(value: string, retry = false) {
    const text = value.trim();
    if (!text || busy || !conversation) return;

    const base = retry
      ? { ...conversation, messages: conversation.messages.filter((message) => message.status !== "error") }
      : conversation;
    let retrievedContext = "";
    if (!retry && !attachments.length && activeDocumentIds.length) {
      try {
        const artifacts = await getArtifacts();
        const stopWords = new Set(["this", "that", "with", "from", "what", "which", "about", "into", "have", "does", "your", "please", "document"]);
        const terms = [...new Set(text.toLowerCase().split(/\W+/).filter((term) => term.length > 2 && !stopWords.has(term)))];
        const ranked = artifacts.filter((artifact) => activeDocumentIds.includes(artifact.id) && artifact.chunks?.length).flatMap((artifact) => (artifact.chunks || []).map((chunk) => {
          const source = chunk.text.toLowerCase();
          const summary = (chunk.summary || "").toLowerCase();
          const score = terms.reduce((total, term) => total + (summary.includes(term) ? 4 : source.includes(term) ? 2 : 0), 0) + (source.includes(text.toLowerCase()) ? 8 : 0) + (chunk.summary ? 1 : 0);
          return { artifact, chunk, score };
        })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index).slice(0, 6);
        if (!ranked.length) {
          void recordAutomaticSignal({ kind: "evaluation", title: "Document retrieval returned no matching chunks", detail: `No relevant chunk matched the query across ${activeDocumentIds.length} selected document${activeDocumentIds.length === 1 ? "" : "s"}.`, severity: "warning", source: "chat-retrieval" }).catch(() => undefined);
        }
        if (ranked.length) {
          const sections: string[] = [];
          let budget = 18_000;
          for (const { artifact, chunk } of ranked) {
            const excerpt = (chunk.summary || chunk.text).slice(0, Math.min(4_500, budget));
            if (!excerpt) continue;
            sections.push(`[${artifact.name} · pages ${chunk.pageStart}-${chunk.pageEnd}]\\n${excerpt}`);
            budget -= excerpt.length;
            if (budget <= 0) break;
          }
          retrievedContext = sections.length ? `\\n\\n[retrieved document context]\\n${sections.join("\\n\\n")}` : "";
        }
      } catch { /* continue without retrieval context */ }
    }
    const attachmentContext = retry ? "" : attachments.filter((file) => file.context).map((file) => `\n\n[attached file: ${file.name}]\n${file.context!.slice(0, 60_000)}`).join("");
    const documentContext = `${attachmentContext}${retrievedContext}`;
    const userMessage: ConversationMessage = {
      id: makeId("msg"),
      role: "user",
      content: `${text}${documentContext}`,
      createdAt: Date.now(),
    };
    const title = base.messages.length === 0 ? text.slice(0, 58) + (text.length > 58 ? "…" : "") : base.title;
    const optimistic: ConversationRecord = retry
      ? { ...base, title, updatedAt: Date.now() }
      : { ...base, title, updatedAt: Date.now(), messages: [...base.messages, userMessage] };

    setInput("");
    setAttachments([]);
    await persist(optimistic);
    if (!requestedId) window.history.replaceState(null, "", `/chat?id=${encodeURIComponent(optimistic.id)}`);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (shouldHandoffToTask(text, attachments)) {
        setTaskMode(true);
        const handoffBudget = Math.max(0, 20_000 - text.length - 2);
        const handoffObjective = text.length >= 20_000 ? text.slice(0, 20_000) : `${text}\n\n${documentContext.slice(0, handoffBudget)}`;
        const taskResponse = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: handoffObjective,
            kind: inferTask(text),
            conversationId: optimistic.id,
            ...(selectedModel !== "auto" ? { preferredProvider: selectedModel.split(":")[0], preferredModel: selectedModel.split(":").slice(1).join(":") } : {}),
            autoStart: true,
          }),
          signal: controller.signal,
        });
        const taskData = await readApiResponse<{ task: TaskRecord }>(taskResponse);
        cacheTaskSnapshot(taskData.task);
        const taskMessage: ConversationMessage = {
          id: makeId("msg"),
          role: "assistant",
          content: `I turned this into a live task inside this conversation.\n\nStatus: **${taskData.task.status}**${taskData.task.error ? `\n\n${taskData.task.error}` : ""}`,
          provider: "task orchestrator",
          model: "task runtime",
          status: "complete",
          createdAt: Date.now(),
        };
        await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, taskMessage] });
        setActiveTask(taskData.task);
        return;
      }

      setTaskMode(false);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: inferTask(text),
          messages: optimistic.messages.map(({ role, content }) => ({ role, content })),
          ...(selectedModel !== "auto" ? { provider: selectedModel.split(":")[0], model: selectedModel.split(":").slice(1).join(":") } : {}),
        }),
        signal: controller.signal,
      });
      const data = await readApiResponse<{ content?: string; provider?: string; model?: string; runtime?: { webEvidence?: { status: string; resultCount: number; fetchedSourceCount: number; sourceUrls: string[]; errors: string[] }; groundingWarning?: boolean }; result?: { content?: string; provider?: string; model?: string; runtime?: { webEvidence?: { status: string; resultCount: number; fetchedSourceCount: number; sourceUrls: string[]; errors: string[] }; groundingWarning?: boolean } } }>(response);
      const reply = data.result || data;
      const content = typeof reply.content === "string" && reply.content.trim() ? reply.content : "I received your message but could not form a response.";
      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content,
        provider: reply.provider,
        model: reply.model,
        status: "complete",
        webEvidence: reply.runtime?.webEvidence,
        createdAt: Date.now(),
      };
      await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistant] });
    } catch (error) {
      if (controller.signal.aborted) return;
      void recordAutomaticSignal({ kind: "evaluation", title: "Chat or task request failed", detail: error instanceof Error ? error.message : "ELIAS failed to respond.", severity: "critical", source: selectedModel === "auto" ? "chat-auto" : `chat-${selectedModel}` }).catch(() => undefined);
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

  async function continueTask() {
    if (!activeTask || taskBusy || ["completed", "cancelled"].includes(activeTask.status)) return;
    setTaskBusy(true);
    try {
      let current = activeTask;
      // One model/tool step per request keeps execution reliable on Vercel.
      // Continue the loop in the browser so every result is immediately visible.
      for (let step = 0; step < 12; step += 1) {
        const response = await fetch(`/api/tasks/${encodeURIComponent(current.id)}/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxSteps: 1 }) });
        const data = await readApiResponse<{ task: TaskRecord }>(response);
        current = data.task;
        setActiveTask(current);
        cacheTaskSnapshot(current);
        if (["completed", "failed", "cancelled", "waiting_approval", "paused"].includes(current.status)) break;
      }
    } catch (error) {
      setActiveTask((current) => current ? { ...current, status: "failed", error: error instanceof Error ? error.message : "Task execution failed." } : current);
    } finally { setTaskBusy(false); }
  }

  async function resolveTaskApproval(approvalId: string, decision: "approve" | "reject") {
    if (!activeTask || taskBusy) return;
    setTaskBusy(true);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(activeTask.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: decision, value: approvalId }) });
      const data = await readApiResponse<{ task: TaskRecord }>(response);
      setActiveTask(data.task);
      cacheTaskSnapshot(data.task);
      if (decision === "approve") window.setTimeout(() => void continueTask(), 0);
    } catch (error) {
      setActiveTask((current) => current ? { ...current, error: error instanceof Error ? error.message : "Approval update failed." } : current);
    } finally { setTaskBusy(false); }
  }

  async function connectVercel() {
    setPlusOpen(false);
    setVercelStatus({ message: "Checking the Vercel MCP connector…" });
    try {
      const response = await fetch("/api/connect/vercel", { method: "POST" });
      const data = await response.json() as VercelMcpStatus;
      setVercelStatus(data);
    } catch {
      setVercelStatus({ connected: false, message: "Could not reach the Vercel MCP connector." });
    }
  }

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const selected = Array.from(list);
    setAttachments((current) => [...current, ...selected.map((file) => ({ name: file.name, status: "uploading" as const, progress: 0, source: file }))]);
    const updateAttachment = (name: string, patch: Partial<Attachment>) => setAttachments((current) => {
      const index = current.findIndex((file) => file.name === name && file.status === "uploading");
      if (index < 0) return current;
      return current.map((file, itemIndex) => itemIndex === index ? { ...file, ...patch } : file);
    });
    for (const file of selected) {
      if (file.size > 20_000_000) {
        updateAttachment(file.name, { status: "error", progress: 0, error: "File is larger than 20 MB." });
        continue;
      }
      let extractedText: string | undefined;
      updateAttachment(file.name, { progress: 20 });
      if (/\.(ts|tsx|js|jsx|html|css|scss|md|txt|json|py|java|sql)$/i.test(file.name)) {
        try { extractedText = await file.text(); updateAttachment(file.name, { progress: 70 }); } catch { /* preserve the original file */ }
      }
      if (!extractedText && /\.(pdf|docx|xlsx|xls|csv)$/i.test(file.name)) {
        try {
          const form = new FormData();
          form.append("file", file);
          updateAttachment(file.name, { progress: 45 });
          const response = await fetch("/api/documents/process", { method: "POST", body: form });
          const data = await readApiResponse<{ text?: string; document?: { summary?: string; pageCount?: number; chars?: number; truncated?: boolean; chunks?: Array<{ id: string; index: number; pageStart: number; pageEnd: number; text: string; summary?: string }> } }>(response);
          extractedText = data.text;
          var processedDocument = data.document;
          updateAttachment(file.name, { progress: 78 });
        } catch { updateAttachment(file.name, { status: "error", progress: 0, error: "Could not process this file." }); continue; }
      }
      try {
        const documentId = makeId("artifact");
        await saveArtifact({ id: documentId, name: file.name, type: file.type || "application/octet-stream", createdAt: Date.now(), blob: file, text: extractedText, summary: processedDocument?.summary, pageCount: processedDocument?.pageCount, charCount: processedDocument?.chars, truncated: processedDocument?.truncated, chunks: processedDocument?.chunks });
        setActiveDocumentIds((current) => current.includes(documentId) ? current : [...current, documentId]);
        updateAttachment(file.name, { context: extractedText, status: "ready", progress: 100, documentId, error: undefined });
      } catch {
        updateAttachment(file.name, { context: extractedText, status: "error", progress: 0, error: "Could not save this file." });
      }
    }
  }

  const messages = useMemo(() => Array.isArray(conversation?.messages) ? conversation.messages : [], [conversation]);
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
          <Link href="/chat" className="history-row history-task-link"><span className="history-bullet"><Check size={14} /></span><span><strong>Active work</strong><small>Tasks run inside this conversation</small></span></Link>
        </aside>
        <div className="chat-body">
          {!messages.length ? (
            <div className="chat-empty">
              <div className="brand-mark large"><Sparkles size={27} /></div>
              <h2>What are we working on?</h2>
              <p>Ask anything or add context with +.</p>
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
                {message.role === "assistant" ? <MarkdownMessage content={message.content} taskId={activeTask?.id} /> : <UserMessageContent content={message.content} />}
                {message.role === "assistant" && message.webEvidence ? <small className={`web-evidence-status ${message.webEvidence.status === "searched" ? "verified" : "warning"}`}>web search · {message.webEvidence.status === "searched" ? `${message.webEvidence.resultCount} results · ${message.webEvidence.fetchedSourceCount} sources fetched` : message.webEvidence.status.replaceAll("_", " ")}</small> : null}
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

          {busy ? <div className="chat-message assistant"><div className="chat-avatar"><LoaderCircle size={14} className="spin" /></div><div className="chat-message-body"><span className="chat-role">ELIAS</span>{taskMode && activeTask ? <LiveExecutionFeed task={activeTask} /> : taskMode ? <div className="chat-content typing-line">setting up the task…</div> : <div className="chat-content typing-line">thinking…</div>}</div></div> : null}
          {activeTask ? <article className="chat-message assistant task-timeline-message"><div className="chat-avatar"><Sparkles size={14} /></div><div className="chat-message-body"><span className="chat-role">ELIAS · WORKING</span><div className="task-timeline-card"><GoalProgressCard task={activeTask} compact /><div className="task-timeline-meta">{activeTask.events.at(-1)?.detail || "Task state updates appear here as Elias works."}</div>{!['completed','cancelled','waiting_approval'].includes(activeTask.status) ? <button type="button" className="primary task-timeline-continue" disabled={taskBusy} onClick={() => void continueTask()}>{taskBusy ? "Working…" : "Continue task"}</button> : null}</div></div></article> : null}
          <div ref={bottomRef} />
        </div>

        {attachments.length ? <div className="attachment-strip">{attachments.map((file, index) => <span className={`attachment-status ${file.status === "error" ? "attachment-error" : file.status === "ready" ? "attachment-ready" : ""}`} key={`${file.name}-${index}`}><span className="attachment-status-main"><FileText size={13} /><strong>{file.name}</strong><small>{file.status === "uploading" ? `Processing ${file.progress || 0}%` : file.status === "error" ? (file.error || "Failed") : "Ready"}</small></span>{file.status === "uploading" ? <i className="attachment-progress"><b style={{ width: `${file.progress || 0}%` }} /></i> : null}{file.status === "error" ? <button type="button" className="attachment-retry" onClick={() => { if (file.source) void addFiles([file.source]); }}>Retry</button> : null}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={12} /></button></span>)}</div> : null}

        {activeDocumentIds.length ? <aside className="chat-context-panel"><div className="context-heading"><strong>Context</strong></div><div className="context-summary"><p>{activeDocumentIds.length} document{activeDocumentIds.length === 1 ? "" : "s"} active</p></div><Link href="/files" className="secondary context-manage">Open Library</Link></aside> : null}
        <div className="chat-composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={3} placeholder="Message ELIAS…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } }} />
          <input ref={uploadRef} hidden type="file" multiple accept=".zip,.ts,.tsx,.js,.jsx,.html,.css,.md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); void addFiles(files); event.currentTarget.value = ""; }} />
          <div className="chat-composer-bar">
            <div className="composer-left"><div className="composer-plus-wrap"><button type="button" className="composer-plus" aria-label="Add to chat" aria-expanded={plusOpen} onClick={() => setPlusOpen((open) => !open)}><Plus size={19} /></button>{plusOpen ? <div className="add-chat-backdrop" role="presentation" onMouseDown={() => setPlusOpen(false)}><section className="add-chat-sheet" role="dialog" aria-modal="true" aria-label="Add to chat" onMouseDown={(event) => event.stopPropagation()}><div className="add-chat-sheet-head"><button type="button" className="add-chat-close" onClick={() => setPlusOpen(false)} aria-label="Close Add to chat"><X size={21} /></button><h2>Add to chat</h2><Link href="/files" onClick={() => setPlusOpen(false)}>All files</Link></div><div className="add-chat-photos"><button type="button" onClick={() => { uploadRef.current?.click(); setPlusOpen(false); }}><Camera size={22} /><span>Camera</span></button>{recentArtifacts.map((artifact) => <button type="button" key={artifact.id} onClick={() => { setPlusOpen(false); setInput(`Use the recent file ${artifact.name} as context for this conversation.`); }}><FileText size={20} /><span>{artifact.name}</span></button>)}</div><div className="add-chat-section add-chat-model-section"><div className="add-chat-section-label">Model <small>{modelOptions.find((option) => option.id === selectedModel)?.label || "Auto"}</small></div><div className="add-chat-models">{modelOptions.map((option) => <button type="button" key={option.id} className={option.id === selectedModel ? "selected" : ""} onClick={() => setSelectedModel(option.id)}><span><strong>{option.label}</strong><small>{option.detail}</small></span>{option.id === selectedModel ? <Check size={14} /> : null}</button>)}</div></div><div className="add-chat-section"><AddChatAction icon={<Paperclip />} label="Add local files" onClick={() => { uploadRef.current?.click(); setPlusOpen(false); }} /><Link href="/files" className="add-chat-action" onClick={() => setPlusOpen(false)}><FileClock /><span>Recent files</span></Link><button type="button" className="add-chat-action" onClick={() => { setPlusOpen(false); setInput("Review my recent tasks and continue the most relevant one."); }}><ListChecks /><span>Recent tasks</span></button><Link href="/skills" className="add-chat-action" onClick={() => setPlusOpen(false)}><Puzzle /><span>Skills</span></Link><button type="button" className="add-chat-action" onClick={() => { setPlusOpen(false); setInput("Create a clear plan for this request before taking action."); }}><ListChecks /><span>Plan</span></button></div><div className="add-chat-section add-chat-section-grid"><AddChatAction icon={<ImagePlus />} label="Create image" onClick={() => { setPlusOpen(false); setInput("Create an image of "); }} /><AddChatAction icon={<WandSparkles />} label="Edit image" onClick={() => { setPlusOpen(false); setInput("Edit the attached image by "); }} /><AddChatAction icon={<AudioLines />} label="Generate audio" onClick={() => { setPlusOpen(false); setInput("Generate audio that "); }} /><AddChatAction icon={<Clapperboard />} label="Create video" onClick={() => { setPlusOpen(false); setInput("Create a video showing "); }} /></div><div className="add-chat-section add-chat-section-grid"><AddChatAction icon={<Gamepad2 />} label="Create games" badge="New" onClick={() => { setPlusOpen(false); setInput("Build a playable browser game about "); }} /><AddChatAction icon={<FolderPlus />} label="Create slides" onClick={() => { setPlusOpen(false); setInput("Create a presentation about "); }} /><AddChatAction icon={<FolderOpen />} label="Build website" onClick={() => { setPlusOpen(false); setInput("Build a website for "); }} /><AddChatAction icon={<Monitor />} label="Develop apps" onClick={() => { setPlusOpen(false); setInput("Develop an app that "); }} /></div><div className="add-chat-section"><AddChatAction icon={<CalendarClock />} label="Schedule a task" onClick={() => { setPlusOpen(false); setInput("Schedule a recurring task that "); }} /><Link href="/connectors" className="add-chat-action" onClick={() => setPlusOpen(false)}><Link2 /><span>Connectors</span></Link><Link href="/projects" className="add-chat-action" onClick={() => setPlusOpen(false)}><FolderPlus /><span>Project context</span></Link><Link href="/profile" className="add-chat-action" onClick={() => setPlusOpen(false)}><Monitor /><span>Connect My Computer</span></Link></div></section></div> : null}</div><Link href="/studio?mode=voice" className="composer-utility" title="Voice" aria-label="Voice"><Mic size={17} /></Link><Link href="/studio?mode=camera" className="composer-utility" title="Camera" aria-label="Camera"><Camera size={17} /></Link></div>
            {busy ? <button className="chat-send stop-button" type="button" onClick={stop} title="Stop generation"><X size={18} /></button> : <button className="chat-send" type="button" disabled={!input.trim()} onClick={() => void sendMessage(input)}><ArrowUp size={18} /></button>}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function AddChatAction({ icon, label, badge, onClick }: { icon: React.ReactNode; label: string; badge?: string; onClick: () => void }) {
  return <button type="button" className="add-chat-action" onClick={onClick}>{icon}<span>{label}</span>{badge ? <b className="add-chat-badge">{badge}</b> : null}</button>;
}

function formatToolOutput(value: unknown) {
  if (value === undefined || value === null) return "No output returned";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function LiveExecutionFeed({ task }: { task: TaskRecord }) {
  const plan = Array.isArray(task.plan) ? task.plan : [];
  const events = Array.isArray(task.events) ? task.events : [];
  const toolResults = Array.isArray(task.toolResults) ? task.toolResults : [];
  const completed = plan.filter((step) => step.status === "completed").length;
  const activeStep = plan.find((step) => step.status === "active") || plan.find((step) => step.status === "pending");
  const latest = events.at(-1);
  const percent = plan.length ? Math.round((completed / plan.length) * 100) : 0;
  const timeline = events.slice(-8).reverse();
  return <div className="live-execution-feed"><div className="live-execution-title"><strong>{task.status === "completed" ? "Execution complete" : task.status === "failed" ? "Execution failed" : task.status === "waiting_approval" ? "Waiting for approval" : "Agent is working"}</strong><span>{percent}%</span></div><div className="live-execution-bar"><b style={{ width: `${percent}%` }} /></div><div className="live-execution-current">{activeStep ? <><span className="live-execution-pulse" />{activeStep.title}</> : latest?.label || "Starting the task…"}</div>{latest ? <small className="live-execution-detail">{latest.detail || latest.label}</small> : null}<div className="live-execution-steps">{plan.slice(0, 5).map((step) => <span className={step.status} key={step.id}>{step.status === "completed" ? "✓" : step.status === "active" ? "•" : step.status === "failed" ? "×" : "○"} {step.title}</span>)}</div>{timeline.length || toolResults.length ? <div className="agent-timeline"><div className="agent-timeline-heading"><span>LIVE ACTIVITY</span><small>{events.length} events · {toolResults.length} tools</small></div>{timeline.map((event) => <div className={`agent-timeline-row ${event.status} ${event.kind}`} key={event.id}><span className="agent-timeline-icon">{event.status === "completed" ? "✓" : event.status === "failed" ? "×" : event.kind === "tool" ? "↗" : "•"}</span><div><strong>{event.label}</strong><small>{event.detail || `${event.kind} ${event.status}`}</small></div><em>{event.status}</em></div>)}{toolResults.slice(-4).reverse().map((result, index) => <details className={`agent-tool-output ${result.error ? "failed" : ""}`} key={`${result.type}-${result.startedAt || index}`}><summary><span>TOOL</span><strong>{result.type.replaceAll("_", " ")}</strong><em>{result.error ? "failed" : "output"}</em></summary><pre>{(result.error || formatToolOutput(result.result ?? result.content)).slice(0, 1800)}</pre></details>)}</div> : null}</div>;
}

function UserMessageContent({ content }: { content: string }) {
  const marker = /\n\n\[attached file: ([^\]]+)\]\n/g;
  const matches = Array.from(content.matchAll(marker));
  const firstAttachment = matches[0]?.index ?? content.length;
  const visibleText = content.slice(0, firstAttachment).trim();
  return <div className="user-content">
    {visibleText ? <div className="user-message-text">{visibleText.replace(/\n\n\[retrieved document context\][\s\S]*$/, "").trim()}</div> : null}
    {matches.map((match, index) => <div className="chat-attachment-card" key={`${match[1]}-${index}`}><span className="chat-attachment-icon"><FileText size={16} /></span><span><strong>{match[1]}</strong><small>Processed document · extracted context available to ELIAS</small></span></div>)}
  </div>;
}

function FolderIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>; }
function ListIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>; }
