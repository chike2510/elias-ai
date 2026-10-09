"use client";

import { AlertCircle, ArrowUp, Brain, CalendarDays, Check, Clock3, CornerUpLeft, Mail, RefreshCw, Square, Sun, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import ApprovalCard from "@/components/chat/ApprovalCard";
import { ConnectCard, MessageCard } from "@/components/chat/Cards";
import MemorySheet from "@/components/chat/MemorySheet";
import ReplyChips from "@/components/chat/ReplyChips";
import { copyText, MenuToast, MessageMenu, SelectTextSheet, useMessageMenu, type MenuTarget } from "@/components/chat/MessageMenu";
import { firstLine, parseFeedback, type Feedback, type MenuActionId } from "@/lib/messageMenu";
import { AttachMenu, AttachmentStrip, choiceName, MessageAttachments, MicButton, ModelSheet, RecordingBar, ReplyMeta, useVoice, type DraftAttachment } from "@/components/chat/ComposerTools";
import { announceConversationsChanged, api, haptic, sendChat, userTimezone, type Approval, type Card, type ChatAttachment, type ConnectCard as ConnectInfo, type MemoryChip, type StoredAttachment, type StoredMessage, type TurnEvent } from "@/lib/chatClient";
import { isImageFile, MAX_ATTACHMENT_BYTES, prepareImage, uploadDocument } from "@/lib/chatMedia";
import NotificationPrompt from "@/components/NotificationPrompt";
import { importedIdFor, migrateLegacyConversations } from "@/lib/legacyImport";
import { formatChatTimestamp } from "@/lib/chatTimestamp.mjs";

type UiMessage = {
  key: string;
  role: "user" | "assistant" | "note";
  content: string;
  cards: Card[];
  connect: ConnectInfo[];
  memories: MemoryChip[];
  approvalIds: string[];
  status?: "streaming" | "done" | "error";
  statusLine?: string;
  error?: string;
  retryText?: string;
  retryAttachments?: ChatAttachment[];
  attachments?: StoredAttachment[];
  model?: string;
  createdAt?: string;
  /** Quick replies for a choice question Elias asked, and suggested follow-up messages. */
  choices?: string[];
  followUps?: string[];
  /** Set when this turn scheduled something or started a background job: a good moment to offer notifications. */
  nudgePush?: boolean;
  /** Server message id (feedback needs it), thumbs given, and the earlier message a user message replies to. */
  id?: number;
  feedback?: Feedback | null;
  replyTo?: string;
  retryReplyTo?: string;
};

const MODEL_KEY = "elias:model";

function toStoredPreview(items: ChatAttachment[]): StoredAttachment[] {
  return items.map((item) => item.kind === "image" ? { kind: "image", name: item.name, mime: item.mime, size: item.size, thumb: item.thumb } : { kind: "file", name: item.name, mime: item.mime, size: item.size, chars: item.chars });
}

const SUGGESTIONS = [
  { label: "Plan my day", text: "Plan my day", icon: Sun, send: true },
  { label: "Check my email", text: "Check my email: anything that needs me today?", icon: Mail, send: true },
  { label: "Remind me…", text: "Remind me to ", icon: Clock3, send: false },
  { label: "What's on my calendar?", text: "What's on my calendar today?", icon: CalendarDays, send: true },
];

function fromStored(message: StoredMessage): UiMessage | null {
  const meta = message.meta || {};
  if (message.role === "event") {
    if (meta.kind !== "schedule") return null;
    return { key: `m${message.id}`, role: "note", content: message.content, cards: [], connect: [], memories: [], approvalIds: [], createdAt: message.createdAt };
  }
  return {
    key: `m${message.id}`, role: message.role, content: message.content, createdAt: message.createdAt, status: "done",
    cards: Array.isArray(meta.cards) ? meta.cards as Card[] : [],
    connect: Array.isArray(meta.connect) ? meta.connect as ConnectInfo[] : [],
    memories: Array.isArray(meta.memories) ? meta.memories as MemoryChip[] : [],
    approvalIds: Array.isArray(meta.approvals) ? meta.approvals as string[] : [],
    attachments: Array.isArray(meta.attachments) ? meta.attachments as StoredAttachment[] : undefined,
    model: typeof meta.model === "string" ? meta.model : undefined,
    choices: stringList(meta.choices),
    followUps: stringList(meta.followUps),
    id: message.id,
    feedback: parseFeedback(meta.feedback),
    replyTo: typeof meta.replyTo === "string" ? meta.replyTo : undefined,
  };
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4) : undefined;
}

function blank(role: UiMessage["role"], content = ""): UiMessage {
  return { key: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content, cards: [], connect: [], memories: [], approvalIds: [], createdAt: new Date().toISOString() };
}

/** Viewer-local time under each message, with an ISO datetime for assistive tech. */
function MessageTimestamp({ createdAt }: { createdAt: unknown }) {
  const timestamp = formatChatTimestamp(typeof createdAt === "string" ? Date.parse(createdAt) : createdAt);
  return timestamp ? <time className="el-stamp" dateTime={timestamp.dateTime}>{timestamp.label}</time> : null;
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function setUrlId(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id); else url.searchParams.delete("id");
  ["prompt", "draft", "connected", "error", "file"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

export default function ChatView() {
  const params = useSearchParams();
  const router = useRouter();
  const idParam = params.get("id");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [memory, setMemory] = useState<{ chip: MemoryChip; messageKey: string } | null>(null);
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [modelChoice, setModelChoice] = useState("auto");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [selectText, setSelectText] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menu = useMessageMenu();
  const conversationRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const bootstrapped = useRef(false);

  const loadConversation = useCallback(async (id: string, quiet = false) => {
    if (!quiet) { setLoading(true); setLoadError(null); }
    try {
      const data = await api<{ messages: StoredMessage[]; approvals: Approval[] }>(`/api/assistant/conversations/${encodeURIComponent(id)}`);
      conversationRef.current = id;
      setConversationId(id);
      setMessages(data.messages.map(fromStored).filter((item): item is UiMessage => Boolean(item)));
      setApprovals(data.approvals);
      stickToBottom.current = true;
    } catch (error) {
      if (!quiet) setLoadError((error as Error).message);
    } finally { if (!quiet) setLoading(false); }
  }, []);

  // React to ?id= (history links, new chat, back/forward). Our own replaceState keeps it in sync.
  useEffect(() => {
    if (idParam === conversationRef.current) return;
    if (!idParam) {
      if (busy) abortRef.current?.abort();
      conversationRef.current = null;
      setConversationId(null); setMessages([]); setApprovals([]); setLoadError(null); setLoading(false);
      return;
    }
    const legacy = !/^(conv|imp)_/.test(idParam);
    if (legacy) {
      // An old local chat link: wait for the one-time import, then open its server copy.
      setLoading(true);
      void migrateLegacyConversations().catch(() => 0).then(() => {
        const mapped = importedIdFor(idParam);
        if (mapped) { setUrlId(mapped); void loadConversation(mapped); }
        else { setLoading(false); setLoadError("That chat couldn't be found. It may have been on another device."); }
      });
      return;
    }
    void loadConversation(idParam);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, loadConversation]);

  // First open: query flags, seed the daily brief, run any overdue scheduled task for this user.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const search = new URLSearchParams(window.location.search);
    const error = search.get("error");
    if (error === "google_not_configured") setNotice({ tone: "warn", text: "Google isn't set up on this server yet. The owner needs to add Google OAuth keys." });
    else if (error) setNotice({ tone: "warn", text: `Google connection didn't finish: ${error.replace(/_/g, " ")}` });
    if (search.get("connected") === "google") setNotice({ tone: "ok", text: "Google connected. Ask me about your inbox or calendar." });
    const prompt = search.get("prompt");
    const draft = search.get("draft");
    if (draft) setInput(draft);
    const fileParam = search.get("file");
    if (error || search.get("connected") || prompt || draft || fileParam) setUrlId(search.get("id"));
    if (fileParam) void attachLibraryFile(fileParam, prompt);
    else if (prompt) void send(prompt);
    try { const saved = localStorage.getItem(MODEL_KEY); if (saved) setModelChoice(saved); } catch { /* private mode */ }
    void api<{ choice: string }>("/api/assistant/models?only=choice").then((data) => { setModelChoice(data.choice); try { localStorage.setItem(MODEL_KEY, data.choice); } catch { /* ignore */ } }).catch(() => undefined);
    // First run: send new users through the short onboarding (skippable; redo from You).
    if (!search.get("id") && !prompt && !draft && !error && !search.get("connected") && !fileParam) {
      void api<{ onboarding: { needed: boolean } }>("/api/assistant/onboarding").then((data) => { if (data.onboarding.needed) router.replace("/welcome"); }).catch(() => undefined);
    }
    const timezone = userTimezone();
    void api(`/api/assistant/status?timezone=${encodeURIComponent(timezone)}`).catch(() => undefined);
    void api<{ ran: Array<{ ok: boolean }> }>("/api/assistant/tick", { method: "POST", body: "{}" }).then((data) => {
      if (data.ran.length) { announceConversationsChanged(); if (conversationRef.current) void loadConversation(conversationRef.current, true); }
    }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background results (jobs, schedules) land while the app is open or in the background:
  // refresh quietly when a push arrives or the tab becomes visible again.
  useEffect(() => {
    const refresh = () => { announceConversationsChanged(); if (conversationRef.current && !abortRef.current) void loadConversation(conversationRef.current, true); };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === "elias:push") refresh();
      else if (data?.type === "elias:navigate" && typeof data.url === "string" && data.url.startsWith("/")) window.location.assign(data.url);
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => { navigator.serviceWorker?.removeEventListener("message", onMessage); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadConversation]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (thread && stickToBottom.current) thread.scrollTop = thread.scrollHeight;
  }, [messages, approvals, loading]);

  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 168)}px`;
  }, [input]);

  const patchLast = (update: (message: UiMessage) => UiMessage) => setMessages((current) => {
    const index = current.length - 1;
    if (index < 0 || current[index].role !== "assistant") return current;
    const copy = current.slice();
    copy[index] = update(copy[index]);
    return copy;
  });

  function onEvent(event: TurnEvent) {
    if (event.type === "conversation") {
      if (conversationRef.current !== event.conversationId) { conversationRef.current = event.conversationId; setConversationId(event.conversationId); setUrlId(event.conversationId); announceConversationsChanged(); }
    } else if (event.type === "status") patchLast((message) => ({ ...message, statusLine: event.label, nudgePush: message.nudgePush || event.tool === "schedule_create" || event.tool === "start_background_job" }));
    else if (event.type === "tool_done") patchLast((message) => ({ ...message, statusLine: "Thinking…" }));
    else if (event.type === "delta") patchLast((message) => ({ ...message, content: message.content + event.text, statusLine: undefined }));
    else if (event.type === "reset") patchLast((message) => ({ ...message, content: "" }));
    else if (event.type === "card") patchLast((message) => ({ ...message, cards: [...message.cards.filter((card) => card.kind !== event.card.kind), event.card] }));
    else if (event.type === "connect") patchLast((message) => ({ ...message, connect: [...message.connect, event.connect] }));
    else if (event.type === "memory") patchLast((message) => ({ ...message, memories: [...message.memories.filter((item) => item.id !== event.memory.id), event.memory] }));
    else if (event.type === "approval") { setApprovals((current) => [event.approval, ...current]); patchLast((message) => ({ ...message, approvalIds: [...message.approvalIds, event.approval.id] })); }
    else if (event.type === "done") patchLast((message) => ({ ...message, model: event.result.model, content: event.result.reply, cards: event.result.cards, connect: event.result.connect, memories: event.result.memories, approvalIds: event.result.approvals.map((item) => item.id), choices: event.result.choices, followUps: event.result.followUps, id: event.result.messageId, status: "done", statusLine: undefined }));
  }

  /** ?file=<id> from the Library: attach that file's text to the composer, or send it with ?prompt= straight away. */
  async function attachLibraryFile(fileId: string, prompt: string | null) {
    const id = `lib_${fileId}`;
    setDrafts((current) => [...current.filter((item) => item.id !== id), { id, kind: "file", name: "Library file", mime: "text/plain", size: 0, status: "working" }]);
    try {
      const { file } = await api<{ file: { name: string; mime: string; size: number; text?: string; chars: number; truncated: boolean } }>(`/api/assistant/files/${encodeURIComponent(fileId)}`);
      const text = (file.text || "").slice(0, 60_000);
      const attachment: ChatAttachment = { kind: "file", name: file.name, mime: file.mime, size: file.size, text, chars: text.length, truncated: file.truncated || (file.text || "").length > text.length };
      if (prompt) { setDrafts((current) => current.filter((item) => item.id !== id)); void send(prompt, { attachments: [attachment] }); }
      else setDrafts((current) => current.map((item) => item.id === id ? { ...item, name: file.name, mime: file.mime, size: file.size, text, chars: text.length, truncated: attachment.kind === "file" ? attachment.truncated : false, status: "ready" } : item));
    } catch (error) {
      setDrafts((current) => current.map((item) => item.id === id ? { ...item, status: "error", error: (error as Error).message } : item));
    }
  }

  /** Sends the composer (or `raw`). Drafted attachments go along when sending the composer or a voice note. */
  async function send(raw?: string, options: { attachments?: ChatAttachment[]; useDrafts?: boolean; replyTo?: string } = {}) {
    const text = (raw ?? input).trim();
    const useDrafts = !options.attachments && (options.useDrafts ?? raw === undefined);
    if (useDrafts && drafts.some((item) => item.status === "working")) { setNotice({ tone: "warn", text: "Still reading your attachment. One moment." }); return; }
    const attachments: ChatAttachment[] = options.attachments ?? (useDrafts ? drafts.filter((item) => item.status === "ready").map((item): ChatAttachment => item.kind === "image"
      ? { kind: "image", name: item.name, mime: item.mime, size: item.size, dataUrl: item.dataUrl!, thumb: item.thumb, width: item.width, height: item.height }
      : { kind: "file", name: item.name, mime: item.mime, size: item.size, text: item.text || "", chars: item.chars || 0, truncated: item.truncated }) : []);
    if ((!text && !attachments.length) || busy) return;
    // A quoted reply (long-press > Reply) rides along with the composer or a voice note.
    const replyTo = options.replyTo ?? (raw === undefined || options.useDrafts ? replyQuote || undefined : undefined);
    haptic(10);
    setInput("");
    if (replyTo) setReplyQuote(null);
    if (useDrafts) setDrafts([]);
    setNotice(null);
    setBusy(true);
    stickToBottom.current = true;
    const assistant = { ...blank("assistant"), status: "streaming" as const, statusLine: "Thinking…" };
    setMessages((current) => [...current.filter((item) => item.status !== "error"), { ...blank("user", text), attachments: attachments.length ? toStoredPreview(attachments) : undefined, replyTo }, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await sendChat({ text, conversationId: conversationRef.current || undefined, attachments, model: modelChoice, replyTo }, onEvent, controller.signal);
    } catch (error) {
      if ((error as Error).name === "AbortError") patchLast((message) => ({ ...message, status: "done", statusLine: undefined, content: message.content || "Stopped." }));
      else patchLast((message) => ({ ...message, status: "error", statusLine: undefined, error: (error as Error).message, retryText: text, retryAttachments: attachments, retryReplyTo: replyTo }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      announceConversationsChanged();
    }
  }

  function retry(message: UiMessage) {
    if (message.retryText === undefined) return;
    setMessages((current) => {
      const index = current.findIndex((item) => item.key === message.key);
      return index > 0 && current[index - 1].role === "user" ? current.slice(0, index - 1) : current.filter((item) => item.key !== message.key);
    });
    void send(message.retryText, { attachments: message.retryAttachments || [], replyTo: message.retryReplyTo });
  }

  async function addFiles(files: File[]) {
    for (const file of files) {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const image = isImageFile(file);
      const base: DraftAttachment = { id, kind: image ? "image" : "file", name: file.name || (image ? "photo.jpg" : "file"), mime: file.type || "application/octet-stream", size: file.size, status: "working" };
      if (file.size > MAX_ATTACHMENT_BYTES) { setDrafts((current) => [...current, { ...base, status: "error", error: "Over 10 MB" }]); continue; }
      const count = drafts.filter((item) => item.kind === base.kind).length;
      if (count >= 4) { setNotice({ tone: "warn", text: `Up to 4 ${image ? "images" : "files"} per message.` }); continue; }
      setDrafts((current) => [...current, base]);
      const update = (patch: Partial<DraftAttachment>) => setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
      try {
        if (image) { const prepared = await prepareImage(file); update({ ...prepared, mime: "image/jpeg", status: "ready" }); }
        else { const extracted = await uploadDocument(file); update({ text: extracted.text, chars: extracted.chars, truncated: extracted.truncated, status: "ready" }); }
      } catch (error) { update({ status: "error", error: (error as Error).message }); }
    }
    inputRef.current?.focus();
  }

  function chooseModel(choice: string) {
    setModelChoice(choice);
    try { localStorage.setItem(MODEL_KEY, choice); } catch { /* ignore */ }
    void api("/api/assistant/models", { method: "PUT", body: JSON.stringify({ model: choice }) }).catch((error) => setNotice({ tone: "warn", text: (error as Error).message }));
  }

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }

  function menuAction(action: MenuActionId, target: MenuTarget) {
    if (action === "copy") void copyText(target.content).then((ok) => showToast(ok ? "Copied" : "Couldn't copy"));
    else if (action === "select") setSelectText(target.content);
    else if (action === "reply") { setReplyQuote(target.content); inputRef.current?.focus(); }
    else if (action === "edit") { setInput(target.content); inputRef.current?.focus(); }
    else if (action === "download" && target.image) {
      const link = document.createElement("a");
      link.href = target.image.src;
      link.download = /\.\w{2,5}$/.test(target.image.name) ? target.image.name : `${target.image.name || "image"}.jpg`;
      document.body.appendChild(link); link.click(); link.remove();
    }
  }

  async function rateMessage(rating: Feedback | null, target: MenuTarget) {
    if (!target.messageId) return;
    const before = target.feedback ?? null;
    const set = (value: Feedback | null) => setMessages((current) => current.map((item) => item.key === target.key ? { ...item, feedback: value } : item));
    set(rating);
    if (rating) showToast(rating === "up" ? "Thanks for the feedback" : "Thanks. I'll do better");
    try { await api("/api/assistant/feedback", { method: "POST", body: JSON.stringify({ messageId: target.messageId, rating }) }); }
    catch (error) { set(before); setNotice({ tone: "warn", text: (error as Error).message }); }
  }

  const voice = useVoice(useCallback((text: string, autoSend: boolean) => {
    if (autoSend) void sendRef.current(text, { useDrafts: true });
    else { setInput((current) => current ? `${current.trimEnd()} ${text}` : text); inputRef.current?.focus(); }
  }, []), useCallback((message: string) => setNotice({ tone: "warn", text: message }), []));
  const sendRef = useRef(send);
  sendRef.current = send;

  const decide = useCallback(async (approval: Approval, decision: "approve" | "decline", edits?: Record<string, unknown>) => {
    setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, status: decision === "approve" ? "running" : "declined" } : item));
    try {
      await api(`/api/assistant/approvals/${approval.id}`, { method: "POST", body: JSON.stringify({ decision, edits, timezone: userTimezone() }) });
    } catch (error) {
      setNotice({ tone: "warn", text: (error as Error).message });
    }
    if (conversationRef.current) await loadConversation(conversationRef.current, true);
  }, [loadConversation]);

  const approvalsById = new Map(approvals.map((item) => [item.id, item]));
  const referenced = new Set(messages.flatMap((message) => message.approvalIds));
  const orphanPending = approvals.filter((item) => item.status === "pending" && !referenced.has(item.id));
  const empty = !loading && !loadError && messages.length === 0;
  const returnTo = conversationId ? `/chat?id=${conversationId}` : "/";
  const lastAssistantKey = messages.length && messages[messages.length - 1].role === "assistant" ? messages[messages.length - 1].key : null;

  return <AppShell chat title={conversationId ? undefined : "Elias"}>
    <main className="el-chat">
      <div className="el-thread" ref={threadRef} onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} aria-live="polite">
        <div className="el-thread-inner">
          {notice ? <div className={`el-notice ${notice.tone}`} role="status">{notice.tone === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}<span>{notice.text}</span><button type="button" className="el-icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div> : null}
          {loading ? <div className="el-chat-skeleton" aria-label="Loading chat">{[62, 38, 74, 46].map((width, index) => <div key={index} className={`el-skeleton-bubble ${index % 2 ? "user" : ""}`}><span className="el-skeleton" style={{ width: `${width}%` }} /></div>)}</div> : null}
          {loadError ? <ErrorCard text={loadError} onRetry={() => idParam && void loadConversation(idParam)} /> : null}
          {empty ? <section className="el-empty">
            <img src="/branding/elias-logo.png" alt="" className="el-empty-mark" />
            <h1>{greeting()}</h1>
            <p>What can I take off your plate?</p>
            <div className="el-chips">{SUGGESTIONS.map((item) => <button type="button" key={item.label} className="el-chip" onClick={() => { if (item.send) void send(item.text); else { setInput(item.text); inputRef.current?.focus(); } }}><item.icon size={16} /> {item.label}</button>)}</div>
          </section> : null}
          {messages.map((message) => message.role === "note" ? <p key={message.key} className="el-note"><Clock3 size={13} /> Scheduled · {message.content.slice(0, 80)}</p>
            : message.role === "user" ? <div key={message.key} className="el-row user">
              {message.replyTo ? <div className="el-reply-quote"><CornerUpLeft size={12} aria-hidden="true" /><span><span className="el-sr">Replying to: </span>{firstLine(message.replyTo, 70)}</span></div> : null}
              {message.attachments?.length ? <div className="el-msg-attach-wrap" {...menu.bind(userTarget(message, !busy))}><MessageAttachments items={message.attachments} /></div> : null}
              {message.content ? <div className="el-bubble user" {...menu.bind(userTarget(message, !busy))}>{message.content}</div> : null}
              <MessageTimestamp createdAt={message.createdAt} /></div>
            : <div key={message.key} className="el-row assistant">
              {message.status === "error" ? <ErrorCard text={message.error || "Elias couldn't answer."} onRetry={() => retry(message)} />
                : message.content ? <div className="el-bubble assistant" {...(message.status === "streaming" ? {} : menu.bind({ key: message.key, role: "assistant", content: message.content, messageId: message.id, feedback: message.feedback }))}><MarkdownMessage content={message.content} collapsible streaming={message.status === "streaming"} /></div>
                : message.status === "streaming" ? <div className="el-typing" role="status"><span className="el-dots" aria-hidden="true"><i /><i /><i /></span>{message.statusLine || "Thinking…"}</div> : null}
              {message.status === "streaming" && message.content && message.statusLine ? <div className="el-typing" role="status"><span className="el-dots" aria-hidden="true"><i /><i /><i /></span>{message.statusLine}</div> : null}
              {message.cards.map((card, index) => <MessageCard key={`${card.kind}-${index}`} card={card} />)}
              {message.connect.map((item) => <ConnectCard key={item.provider} connect={item} returnTo={returnTo} />)}
              {message.approvalIds.map((id) => approvalsById.get(id)).filter((item): item is Approval => Boolean(item)).map((approval) => <ApprovalCard key={approval.id} approval={approval} onDecide={(decision, edits) => decide(approval, decision, edits)} />)}
              {message.status !== "streaming" && message.status !== "error" ? <MessageTimestamp createdAt={message.createdAt} /> : null}
              {message.status !== "streaming" && message.status !== "error" && message.content ? <ReplyMeta content={message.content} model={message.model} /> : null}
              {message.key === lastAssistantKey && message.status === "done" && !busy && message.choices?.length ? <ReplyChips kind="choices" items={message.choices} onPick={(text) => void send(text)} /> : null}
              {message.key === lastAssistantKey && message.status === "done" && !busy && !message.choices?.length && message.followUps?.length ? <ReplyChips kind="followups" items={message.followUps.slice(0, 3)} onPick={(text) => void send(text)} /> : null}
              {message.nudgePush && message.status === "done" ? <NotificationPrompt /> : null}
              {message.memories.length ? <div className="el-memory-chips">{message.memories.map((chip) => <button type="button" key={chip.id} className="el-memory-chip" title={chip.content} onClick={() => setMemory({ chip, messageKey: message.key })}><Brain size={13} /> {message.memories.length > 1 ? chip.content.slice(0, 28) + (chip.content.length > 28 ? "…" : "") : "Saved to memory"}</button>)}</div> : null}
            </div>)}
          {orphanPending.map((approval) => <div key={approval.id} className="el-row assistant"><ApprovalCard approval={approval} onDecide={(decision, edits) => decide(approval, decision, edits)} /></div>)}
        </div>
      </div>
      <form className="el-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles([...event.dataTransfer.files]); } }}>
        {replyQuote ? <div className="el-quote-chip"><CornerUpLeft size={15} aria-hidden="true" /><span><span className="el-sr">Replying to: </span>{firstLine(replyQuote, 90)}</span><button type="button" className="el-icon-btn" aria-label="Remove quote" onClick={() => setReplyQuote(null)}><X size={16} /></button></div> : null}
        <AttachmentStrip items={drafts} onRemove={(id) => setDrafts((current) => current.filter((item) => item.id !== id))} />
        <div className="el-composer-box">
          <AttachMenu disabled={voice.mode !== "idle"} onFiles={(files) => void addFiles(files)} onOpenModels={() => setModelsOpen(true)} modelName={choiceName(modelChoice)} />
          {voice.mode !== "idle" ? <RecordingBar voice={voice} /> : <textarea ref={inputRef} value={input} rows={1} maxLength={12000} placeholder="Message Elias" aria-label="Message Elias" enterKeyHint="send"
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); void addFiles(files); } }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { event.preventDefault(); void send(); } }} />}
          {busy ? <button type="button" className="el-send stop" onClick={() => abortRef.current?.abort()} aria-label="Stop"><Square size={15} fill="currentColor" /></button>
            : voice.mode === "idle" && (input.trim() || drafts.some((item) => item.status === "ready")) ? <button type="submit" className="el-send" disabled={drafts.some((item) => item.status === "working")} aria-label="Send"><ArrowUp size={20} strokeWidth={2.2} /></button>
            : <MicButton voice={voice} />}
        </div>
      </form>
    </main>
    {menu.opened ? <MessageMenu opened={menu.opened} onClose={menu.close} onAction={menuAction} onFeedback={(rating, target) => void rateMessage(rating, target)} /> : null}
    {selectText !== null ? <SelectTextSheet text={selectText} onClose={() => setSelectText(null)} /> : null}
    <MenuToast text={toast} />
    {modelsOpen ? <ModelSheet choice={modelChoice} onChoose={chooseModel} onClose={() => setModelsOpen(false)} /> : null}
    {memory ? <MemorySheet memory={memory.chip} onClose={() => setMemory(null)} onChanged={(next) => setMessages((current) => current.map((message) => message.key !== memory.messageKey ? message : { ...message, memories: next ? message.memories.map((item) => item.id === next.id ? next : item) : message.memories.filter((item) => item.id !== memory.chip.id) }))} /> : null}
  </AppShell>;
}

function userTarget(message: UiMessage, canEdit: boolean): MenuTarget {
  const image = message.attachments?.find((item) => item.kind === "image" && item.thumb);
  return { key: message.key, role: "user", content: message.content, canEdit: canEdit && Boolean(message.content), image: image && image.kind === "image" && image.thumb ? { src: image.thumb, name: image.name } : undefined };
}

export function ErrorCard({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <section className="el-error-card" role="alert">
    <AlertCircle size={18} />
    <div><strong>That didn't go through</strong>{friendly(text).short ? <small>{friendly(text).short}</small> : null}{friendly(text).details ? <details className="el-error-details"><summary>Details</summary><small>{friendly(text).details}</small></details> : null}</div>
    {onRetry ? <button type="button" className="el-btn" onClick={onRetry}><RefreshCw size={15} /> Retry</button> : null}
  </section>;
}

/** Turns raw provider dumps into one plain sentence, keeping the raw text behind Details. */
function friendly(text: string): { short: string; details?: string } {
  if (/All agent providers failed|No tool-capable model provider/i.test(text)) {
    return { short: "Elias couldn't reach any AI model just now. Try again in a minute.", details: text };
  }
  if (text.length > 160) return { short: `${text.slice(0, 140).trim()}…`, details: text };
  return { short: text };
}
