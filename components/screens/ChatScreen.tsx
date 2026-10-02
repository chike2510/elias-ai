"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowUp, Check, CheckCircle2, ChevronRight, Copy, FileClock, FileText, FolderPlus, Globe2, Link2, ListChecks, LoaderCircle, Mic, Paperclip, Plus, Puzzle, Sparkles, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import StepTracker, { type Step } from "@/components/StepTracker";
import ArtifactCard from "@/components/artifacts/ArtifactCard";
import ArtifactPreviewSheet from "@/components/artifacts/ArtifactPreviewSheet";
import GoalProgressCard from "@/components/GoalProgressCard";
import StructuredChatResponse from "@/components/StructuredChatResponse";
import { readApiResponse } from "@/lib/clientApi";
import { selectSuggestedReply } from "@/lib/chatResponse";
import { formatChatTimestamp } from "@/lib/chatTimestamp.mjs";
import { cacheTaskSnapshot, listCachedTaskSnapshots } from "@/lib/clientTask";
import { inferChatTask as inferTask, shouldHandoffToTask } from "@/lib/chatTaskRouting";
import { buildSelectedDocumentContext } from "@/lib/clientDocumentContext";
import { continueTaskSteps, selectActiveTaskSnapshot, taskArtifactSyncKey, upsertRecentTaskSnapshot } from "@/lib/clientTaskRunner";
import { syncTaskArtifactToLibrary } from "@/lib/taskArtifactLibrary";
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

type ChatResponseData = { content?: string; provider?: string; model?: string; fallbackProviders?: string[]; recommendation?: string; reasons?: string[]; risks?: string[]; suggestedReplies?: string[]; runtime?: { webEvidence?: { status: string; resultCount: number; fetchedSourceCount: number; sourceUrls: string[]; errors: string[] }; groundingWarning?: boolean } };
type ChatResponseEnvelope = ChatResponseData & { result?: ChatResponseData };
type ModelOption = { id: string; provider: string; label: string; detail: string; configured?: boolean; capabilities?: string[] };
type VercelMcpStatus = { configured?: boolean; connected?: boolean; message?: string; tools?: Array<{ name: string; description?: string }> };
type Attachment = { name: string; context?: string; status?: "uploading" | "ready" | "error"; progress?: number; error?: string; documentId?: string; source?: File };

const FALLBACK_MODEL_OPTIONS: ModelOption[] = [{ id: "auto", provider: "auto", label: "Auto", detail: "Best model for the task", configured: true }];

function normalizeConversation(value: ConversationRecord): ConversationRecord {
  const messages = Array.isArray(value.messages) ? value.messages.filter((message) => message && typeof message.content === "string" && !/^I turned this into a live task inside this conversation\./.test(message.content.trim())).map((message) => ({ ...message, role: (message.role === "assistant" || message.role === "system" ? message.role : "user") as ConversationMessage["role"], content: message.content })) : [];
  return { ...value, id: value.id || makeId("chat"), title: value.title || "Conversation", messages };
}

function MessageTimestamp({ createdAt }: { createdAt: unknown }) {
  const timestamp = formatChatTimestamp(createdAt);
  return timestamp ? <time className="chat-message-timestamp" dateTime={timestamp.dateTime}>{timestamp.label}</time> : null;
}

function inlineArtifactHref(taskId: string, artifact: TaskRecord["artifacts"][number]) {
  if (artifact.content !== undefined) {
    if (artifact.encoding === "base64") return `data:${artifact.type};base64,${artifact.content}`;
    return `data:${artifact.type},${encodeURIComponent(artifact.content)}`;
  }
  return `/api/tasks/${encodeURIComponent(taskId)}/artifact/${encodeURIComponent(artifact.id)}`;
}

function trackerIconForStep(title: string): Step["icon"] {
  const value = title.toLowerCase();
  if (/search|research|read|source|evidence|inspect|discover/.test(value)) return "search";
  if (/file|artifact|document|pdf|docx|slide|deliver|package|export|create/.test(value)) return "file";
  if (/check|verify|review|validate|test|sanity|confirm/.test(value)) return "check";
  return "edit";
}

function trackerStatusForTask(status: TaskRecord["status"]): "in-progress" | "complete" | "interrupted" {
  if (status === "completed") return "complete";
  if (status === "failed" || status === "cancelled") return "interrupted";
  return "in-progress";
}

function trackerStepsForTask(task: TaskRecord): Step[] {
  return task.plan.map((step) => ({ id: step.id, label: step.title, icon: trackerIconForStep(`${step.title} ${step.description}`), status: step.status === "completed" ? "complete" : step.status === "failed" ? "error" : "pending" }));
}

function browserActionLabel(value: string) {
  const action = value.toLowerCase().replaceAll("_", " ");
  if (action.includes("navigate") || action.includes("open")) return "Opening browser";
  if (action.includes("extract") || action.includes("read")) return "Reading the page";
  if (action.includes("screenshot")) return "Capturing the browser view";
  if (action.includes("scroll")) return "Scrolling the page";
  if (action.includes("click")) return "Waiting for click approval";
  if (action.includes("type")) return "Waiting for input approval";
  return "Working in the browser";
}

function browserActivityForTask(task: TaskRecord) {
  const browserEvents = task.events.filter((event) => /browser|page|web source/i.test(`${event.label} ${event.detail}`));
  const browserResults = task.toolResults.filter((result) => result.type.startsWith("browser_"));
  const latest = browserEvents.at(-1);
  const latestResult = browserResults.at(-1);
  if (!latest && !latestResult && !task.browserSessionId) return null;
  const rawAction = latest?.label || latestResult?.type || "browser";
  const failed = task.status === "failed" || latest?.status === "failed" || Boolean(latestResult?.error);
  const waiting = task.status === "waiting_approval" || /approval|waiting_for_user/i.test(`${latest?.label} ${latest?.detail}`);
  const complete = task.status === "completed" || latest?.status === "completed";
  const label = failed ? "Browser work failed" : waiting ? "Waiting for your approval" : complete ? "Browser work complete" : browserActionLabel(rawAction);
  const detail = latest?.detail && latest.detail !== "Awaiting execution." && latest.detail !== "Evidence recorded."
    ? latest.detail
    : latestResult?.error || (typeof latestResult?.result === "string" ? latestResult.result : latestResult?.url) || "Browser activity stays attached to this conversation.";
  return { label, detail: String(detail).replace(/\s+/g, " ").slice(0, 220), failed, waiting, complete };
}

export default function ChatScreen() {
  const params = useSearchParams();
  const requestedId = params.get("id");
  const requestedPrompt = params.get("prompt");
  const requestedDraft = params.get("draft");
  const requestedDocumentId = params.get("documentId");
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [history, setHistory] = useState<ConversationRecord[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerNotice, setProviderNotice] = useState("");
  const [modelCatalogNotice, setModelCatalogNotice] = useState("");
  const [taskMode, setTaskMode] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [activeDocumentIds, setActiveDocumentIds] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<TaskRecord | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [artifactPreview, setArtifactPreview] = useState<TaskRecord["artifacts"][number] | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const taskBusyRef = useRef(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [vercelStatus, setVercelStatus] = useState<VercelMcpStatus | null>(null);
  const [recentArtifacts, setRecentArtifacts] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [librarySyncNotice, setLibrarySyncNotice] = useState<{ taskId: string; message: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
  const librarySyncInFlight = useRef(new Set<string>());
  const librarySynced = useRef(new Set<string>());
  const librarySyncFailed = useRef(new Set<string>());
  const autoSubmittedPromptRef = useRef<string | null>(null);
  const activeTaskSnapshotRef = useRef<TaskRecord | null>(null);

  function updateActiveTaskSnapshot(incoming: TaskRecord, expectedTaskId?: string, force = false) {
    const previous = activeTaskSnapshotRef.current;
    const next = selectActiveTaskSnapshot(previous, incoming, expectedTaskId, force);
    if (next === previous) return previous;
    activeTaskSnapshotRef.current = next;
    setActiveTask(next);
    return next;
  }

  useEffect(() => {
    void getConversations().then(setHistory).catch(() => setHistory([]));
    void getArtifacts().then((items) => setRecentArtifacts(items.slice(0, 4).map(({ id, name, type }) => ({ id, name, type })))).catch(() => setRecentArtifacts([]));
    void fetch("/api/tasks", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ tasks?: TaskRecord[] }> : Promise.reject(new Error("tasks unavailable"))).then((data) => {
      const cached = listCachedTaskSnapshots();
      setRecentTasks([...cached, ...(data.tasks || [])].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4));
    }).catch(() => setRecentTasks(listCachedTaskSnapshots().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4)));
    void fetch("/api/models").then((response) => response.ok ? response.json() as Promise<{ models?: ModelOption[]; diagnostics?: Record<string, { configured?: boolean; ok?: boolean; modelCount?: number; error?: string }> }> : Promise.reject(new Error("models unavailable"))).then((data) => {
      if (Array.isArray(data.models) && data.models.length) setModelOptions(data.models);
      const huggingface = data.diagnostics?.huggingface;
      if (huggingface?.ok && huggingface.modelCount) setModelCatalogNotice(`Hugging Face · ${huggingface.modelCount} live chat models loaded`);
      else if (huggingface?.configured && huggingface.error) setModelCatalogNotice("Hugging Face chat catalog unavailable; Auto cannot route until HF_TOKEN with Inference Providers permission is available.");
      else if (!huggingface?.configured) setModelCatalogNotice("Hugging Face Auto chat needs HF_TOKEN with Inference Providers permission.");
    }).catch(() => setModelCatalogNotice("Model catalog unavailable; Hugging Face Auto chat cannot route until its live chat catalog is reachable."));
    let active = true;
    async function load() {
      activeTaskSnapshotRef.current = null;
      setActiveTask(null);
      setTaskMode(false);
      setActiveDocumentIds(requestedDocumentId ? [requestedDocumentId] : []);
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
      const now = Date.now();
      setConversation({ id: requestedId || makeId("chat"), title: "New conversation", createdAt: now, updatedAt: now, messages: [] });
      if (requestedPrompt || requestedDraft) setInput(requestedPrompt || requestedDraft || "");
    }
    void load();
    return () => { active = false; };
  }, [requestedId, requestedPrompt, requestedDraft, requestedDocumentId]);

  useEffect(() => {
    if (!conversation?.id) return;
    const activeTaskIdAtRequest = activeTaskSnapshotRef.current?.id ?? null;
    let active = true;
    void fetch(`/api/tasks?conversationId=${encodeURIComponent(conversation.id)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ tasks?: TaskRecord[] }> : Promise.reject(new Error("task lookup failed")))
      .then((data) => {
        if (!active || activeTaskSnapshotRef.current?.id !== activeTaskIdAtRequest) return;
        const latest = data.tasks?.[0];
        if (!latest) return;
        const accepted = updateActiveTaskSnapshot(latest);
        if (accepted?.id === latest.id) cacheTaskSnapshot(accepted);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [conversation?.id]);

  useEffect(() => {
    if (!requestedPrompt || !conversation || conversation.messages.length || busy) return;
    if (autoSubmittedPromptRef.current === `${conversation.id}:${requestedPrompt}`) return;
    autoSubmittedPromptRef.current = `${conversation.id}:${requestedPrompt}`;
    setInput("");
    void sendMessage(requestedPrompt);
  }, [conversation, requestedPrompt, busy]);

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
        const accepted = updateActiveTaskSnapshot(latest, activeTask.id);
        setRecentTasks((current) => upsertRecentTaskSnapshot(current, latest));
        if (accepted?.id === latest.id) cacheTaskSnapshot(accepted);
        const currentTask = accepted?.id === latest.id ? accepted : latest;
        if (["completed", "failed", "cancelled"].includes(currentTask.status) && timer !== undefined) window.clearInterval(timer);
      } catch { /* keep the inline task state while the network recovers */ }
    };
    void poll();
    timer = window.setInterval(() => { void poll(); }, 1200);
    return () => { stopped = true; if (timer !== undefined) window.clearInterval(timer); };
  }, [activeTask?.id]);

  useEffect(() => {
    if (!activeTask) return;
    for (const artifact of activeTask.artifacts) {
      const key = taskArtifactSyncKey(activeTask.id, artifact);
      if (librarySynced.current.has(key) || librarySyncFailed.current.has(key) || librarySyncInFlight.current.has(key)) continue;
      librarySyncInFlight.current.add(key);
      void syncTaskArtifactToLibrary(activeTask, artifact, {
        save: async (record) => {
          const latestTask = activeTaskSnapshotRef.current;
          const latestArtifact = latestTask?.id === activeTask.id ? latestTask.artifacts.find((item) => item.id === artifact.id) : undefined;
          if (latestArtifact && taskArtifactSyncKey(activeTask.id, latestArtifact) !== key) return;
          await saveArtifact(record);
        },
      })
        .then(async () => {
          librarySynced.current.add(key);
          setLibrarySyncNotice((current) => current?.taskId === activeTask.id ? null : current);
          const items = await getArtifacts();
          setRecentArtifacts(items.slice(0, 4).map(({ id, name, type }) => ({ id, name, type })));
        })
        .catch(() => {
          librarySyncFailed.current.add(key);
          setLibrarySyncNotice({ taskId: activeTask.id, message: "This file is still available in the chat, but could not be added to the Library. Refresh Chat to retry." });
        })
        .finally(() => librarySyncInFlight.current.delete(key));
    }
  }, [activeTask?.id, activeTask?.conversationId, activeTask?.artifacts]);

  async function persist(next: ConversationRecord) {
    setConversation(next);
    try {
      await saveConversation(next);
    } catch {
      // Chat must remain usable when browser storage is blocked, unavailable, or corrupted.
      // The conversation remains in React state for the current session.
    }
    window.dispatchEvent(new Event("elias:conversation-updated"));
  }

  async function sendMessage(value: string, retry = false) {
    const text = value.trim();
    if (!text || busy || sendInFlightRef.current || !conversation) return;
    sendInFlightRef.current = true;

    const base = retry
      ? { ...conversation, messages: conversation.messages.filter((message) => message.status !== "error") }
      : conversation;
    let retrievedContext = "";
    if (!retry && activeDocumentIds.length) {
      try {
        const artifacts = await getArtifacts();
        const result = await buildSelectedDocumentContext(artifacts, activeDocumentIds, text);
        if (result.noMatches) {
          void recordAutomaticSignal({ kind: "evaluation", title: "Document retrieval returned no matching content", detail: `No relevant content was available across ${activeDocumentIds.length} selected document${activeDocumentIds.length === 1 ? "" : "s"}.`, severity: "warning", source: "chat-retrieval" }).catch(() => undefined);
        }
        if (result.context) retrievedContext = `\n\n[retrieved document context]\n${result.context}`;
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
      const wantsImage = /\b(generate|create|make|draw|render|design)\b.{0,40}\b(photo|image|picture|illustration|poster|thumbnail)\b|\b(photo|image|picture)\b.{0,40}\b(generate|create|make|draw|render)\b|^\s*(generate|create|make)\s+(for me|something|an? image|a photo)\b/i.test(text);
      if (wantsImage && !attachments.length) {
        const generationResponse = await fetch("/api/generation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, type: "image", ...(selectedModel.startsWith("huggingface:") ? { provider: "huggingface", model: selectedModel.slice("huggingface:".length) } : {}) }),
          signal: controller.signal,
        });
        const generationData = await readApiResponse<{ task?: TaskRecord; artifact?: { name?: string; type?: string; provider?: string; model?: string }; error?: { message?: string } }>(generationResponse);
        if (!generationData.task || !generationData.artifact?.name) throw new Error(generationData.error?.message || "Image generation could not be completed.");
        const generatedTask = updateActiveTaskSnapshot(generationData.task, undefined, true);
        if (generatedTask?.id === generationData.task.id) cacheTaskSnapshot(generatedTask);
        const generatedMessage: ConversationMessage = {
          id: makeId("msg"),
          role: "assistant",
          content: `I generated **${generationData.artifact.name}** from your prompt. It is ready in this task and in your Library.`,
          provider: generationData.artifact.provider === "pollinations" ? "pollinations" : "huggingface",
          model: generationData.artifact.model,
          status: "complete",
          createdAt: Date.now(),
        };
        await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, generatedMessage] });
        return;
      }

      if (shouldHandoffToTask(text, attachments.length > 0)) {
        setTaskMode(true);
        const handoffBudget = Math.max(0, 20_000 - text.length - 2);
        const handoffObjective = text.length >= 20_000 ? text.slice(0, 20_000) : `${text}\n\n${documentContext.slice(0, handoffBudget)}`;
        const taskResponse = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective: handoffObjective,
            conversationId: optimistic.id,
            ...(selectedModel !== "auto" ? { preferredProvider: selectedModel.split(":")[0], preferredModel: selectedModel.split(":").slice(1).join(":") } : {}),
          }),
          signal: controller.signal,
        });
        const taskData = await readApiResponse<{ task: TaskRecord }>(taskResponse);
        const createdTask = updateActiveTaskSnapshot(taskData.task, undefined, true);
        if (createdTask?.id === taskData.task.id) cacheTaskSnapshot(createdTask);
        await persist({ ...optimistic, updatedAt: Date.now(), messages: optimistic.messages });
        setRecentTasks((current) => upsertRecentTaskSnapshot(current, taskData.task));
        if (createdTask?.id === taskData.task.id) void continueTask(createdTask);
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
      const data = await readApiResponse<ChatResponseEnvelope>(response);
      const reply = data.result || data;
      if (Array.isArray(reply.fallbackProviders) && reply.fallbackProviders.length) setProviderNotice(`Auto routing used ${reply.provider || "another provider"} after ${reply.fallbackProviders.join(", ")} was unavailable.`);
      else setProviderNotice("");
      const content = typeof reply.content === "string" && reply.content.trim() ? reply.content : "I received your message but could not form a response.";
      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content,
        provider: reply.provider,
        model: reply.model,
        status: "complete",
        recommendation: typeof reply.recommendation === "string" ? reply.recommendation : undefined,
        reasons: Array.isArray(reply.reasons) ? reply.reasons.filter((item): item is string => typeof item === "string").slice(0, 4) : undefined,
        risks: Array.isArray(reply.risks) ? reply.risks.filter((item): item is string => typeof item === "string").slice(0, 3) : undefined,
        suggestedReplies: Array.isArray(reply.suggestedReplies) ? reply.suggestedReplies.filter((item): item is string => typeof item === "string").slice(0, 3) : undefined,
        webEvidence: (reply.runtime || data.runtime)?.webEvidence,
        createdAt: Date.now(),
      };
      await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistant] });
    } catch (error) {
      if (controller.signal.aborted) return;
      void recordAutomaticSignal({ kind: "evaluation", title: "Chat or task request failed", detail: error instanceof Error ? error.message : "ELIAS failed to respond.", severity: "critical", source: selectedModel === "auto" ? "chat-auto" : `chat-${selectedModel}` }).catch(() => undefined);
      const assistant: ConversationMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: "Couldn't send",
        status: "error",
        createdAt: Date.now(),
      };
      await persist({ ...optimistic, updatedAt: Date.now(), messages: [...optimistic.messages, assistant] });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      sendInFlightRef.current = false;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  async function continueTask(taskToContinue: TaskRecord | null = activeTask) {
    if (!taskToContinue || taskBusyRef.current || ["completed", "cancelled", "waiting_approval"].includes(taskToContinue.status)) return;
    taskBusyRef.current = true;
    setTaskBusy(true);
    try {
      // One model/tool step per request keeps execution reliable on Vercel.
      // Keep stepping in the browser so every progress snapshot is visible.
      const current = await continueTaskSteps(taskToContinue, {
        advance: async (task) => {
          const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxSteps: 1 }) });
          const data = await readApiResponse<{ task: TaskRecord }>(response);
          return data.task;
        },
        onUpdate: (task) => {
          const accepted = updateActiveTaskSnapshot(task, taskToContinue.id);
          setRecentTasks((tasks) => upsertRecentTaskSnapshot(tasks, task));
          if (accepted?.id === task.id) cacheTaskSnapshot(accepted);
        },
      });
      const accepted = updateActiveTaskSnapshot(current, taskToContinue.id);
      setRecentTasks((tasks) => upsertRecentTaskSnapshot(tasks, current));
      if (accepted?.id === current.id) cacheTaskSnapshot(accepted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task execution failed.";
      const current = activeTaskSnapshotRef.current;
      if (current?.id === taskToContinue.id) updateActiveTaskSnapshot({ ...current, error: message }, taskToContinue.id);
    } finally { taskBusyRef.current = false; setTaskBusy(false); }
  }

  async function resolveTaskApproval(approvalId: string, decision: "approve" | "reject") {
    if (!activeTask || taskBusy) return;
    setTaskBusy(true);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(activeTask.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: decision, value: approvalId }) });
      const data = await readApiResponse<{ task: TaskRecord }>(response);
      const accepted = updateActiveTaskSnapshot(data.task, activeTask.id);
      setRecentTasks((tasks) => upsertRecentTaskSnapshot(tasks, data.task));
      if (accepted?.id === data.task.id) cacheTaskSnapshot(accepted);
      if (decision === "approve" && accepted?.id === data.task.id) window.setTimeout(() => void continueTask(accepted), 0);
    } catch (error) {
      const current = activeTaskSnapshotRef.current;
      if (current?.id === activeTask.id) updateActiveTaskSnapshot({ ...current, error: error instanceof Error ? error.message : "Approval update failed." }, activeTask.id);
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
  const selectedModelOption = modelOptions.find((option) => option.id === selectedModel) || FALLBACK_MODEL_OPTIONS[0];
  const pendingTaskApproval = activeTask?.approvals.find((approval) => approval.status === "pending");

  return (
    <AppShell title="Chat">
      <main className={`screen chat-screen chat-route-screen ${messages.length === 0 && !activeTask ? (input.trim() ? "fresh-chat-has-draft" : "fresh-chat-empty") : ""}`}>
        <header className="chat-workbench-header">
          <div className="chat-workbench-heading"><span>ELIAS <i>/</i> WORKSPACE</span><strong>{conversation?.title || "New conversation"}</strong></div>
          <div className="chat-workbench-header-actions"><span className="chat-workbench-model">{selectedModelOption?.label || "Auto"} <small>· task-aware</small></span><Link href="/tasks"><ListChecks size={14} /> Tasks</Link><Link href="/files"><FileText size={14} /> Library</Link></div>
        </header>
        <div className="chat-workbench-grid">
          <section className="chat-room" aria-label="Conversation">
          <div className="chat-body">
          {messages.length === 0 && !activeTask ? <section className="chat-welcome-stage" aria-labelledby="chat-welcome-title">
            <div className="chat-welcome-kicker"><span /> YOUR PERSONAL ASSISTANT</div>
            <h2 id="chat-welcome-title">What would you like to get done?</h2>
            <p>Ask a quick question, research live sources, work with a file or connected project, or create a downloadable deliverable. Multi-step work stays in this conversation, with progress and approvals here and finished files in your Library.</p>
            <div className="chat-welcome-paths" aria-label="Start with an example">
              <button type="button" onClick={() => setInput("Research the latest best practices for this topic and cite the strongest sources.")}><Globe2 size={17} /><span><strong>Research</strong><small>Find and compare sources</small></span><ChevronRight size={15} /></button>
              <button type="button" onClick={() => setInput("Review this project, identify the highest-risk issues, and propose a prioritized fix plan.")}><WandSparkles size={17} /><span><strong>Review or build</strong><small>Turn a project into a plan</small></span><ChevronRight size={15} /></button>
              <button type="button" onClick={() => setInput("Create a downloadable PDF report with a clear recommendation and supporting evidence.")}><FileText size={17} /><span><strong>Create a file</strong><small>Preview and download it in your Library</small></span><ChevronRight size={15} /></button>
            </div>
            <div className="chat-welcome-footnote"><CheckCircle2 size={14} /><span>You stay in control: review the plan, evidence, approvals, and files as work progresses.</span></div>
          </section> : null}
          {activeTask?.artifacts.length ? <div className="chat-artifact-pill"><FileText size={13} /> {activeTask.artifacts.length} Artifact{activeTask.artifacts.length === 1 ? "" : "s"}</div> : null}

          {messages.map((message) => <article key={message.id} className={`chat-message ${message.role} ${message.status === "error" ? "error" : ""}`}>
            <div className="chat-avatar">{message.role === "assistant" ? <img src="/branding/elias-logo.png" alt="ELIAS" /> : "you"}</div>
            <div className="chat-message-body">
              <span className="chat-role">{message.role === "assistant" ? `ELIAS${message.provider ? ` · ${message.provider.toLowerCase() === "huggingface" ? "HUGGING FACE" : message.provider.toUpperCase()}` : ""}` : "you"}</span>
              {message.role === "assistant" && message.model ? <small className="chat-model-attribution">model · {message.model}</small> : null}
              {message.status === "error" ? <div className="chat-error-line" role="alert"><span className="chat-error-dot" aria-hidden="true" />Couldn't send — {lastUser ? <button type="button" onClick={() => void sendMessage(lastUser.content, true)}>retry</button> : <span>retry</span>}</div> : message.role === "assistant" ? <StructuredChatResponse content={message.content} taskId={activeTask?.id} recommendation={message.recommendation} reasons={message.reasons} risks={message.risks} suggestedReplies={message.suggestedReplies} busy={busy} onSelectReply={(index) => { const selected = selectSuggestedReply(message.suggestedReplies, index); if (selected) void sendMessage(selected); }} /> : <UserMessageContent content={message.content} />}
              {message.role === "assistant" && message.status !== "error" && message.webEvidence ? <small className={`web-evidence-status ${message.webEvidence.status === "searched" ? "verified" : "warning"}`}>web search · {message.webEvidence.status === "searched" ? `${message.webEvidence.resultCount} results · ${message.webEvidence.fetchedSourceCount} sources fetched` : message.webEvidence.status.replaceAll("_", " ")}</small> : null}
              <MessageTimestamp createdAt={message.createdAt} />
              <div className="message-actions"><button type="button" aria-label={`Copy ${message.role} message`} onClick={() => { void navigator.clipboard?.writeText(message.content); setCopied(message.id); window.setTimeout(() => setCopied(null), 1400); }}>{copied === message.id ? <Check size={13} /> : <Copy size={13} />} {copied === message.id ? "Copied" : "Copy"}</button></div>
              {message.role === "assistant" && message.status !== "error" && message.content.length > 1200 && /\b(tsx|jsx|html|css|javascript|typescript|python|java|sql)\b/i.test(message.content) ? <Link href={`/agent?fromChat=${encodeURIComponent(conversation?.id ?? "")}`} className="chat-agent-action"><WandSparkles size={14} /> continue in coding workspace</Link> : null}
            </div>
          </article>)}

          {busy ? <div className="chat-message assistant"><div className="chat-avatar"><LoaderCircle size={14} className="spin" /></div><div className="chat-message-body"><span className="chat-role">ELIAS</span>{taskMode && activeTask ? <LiveExecutionFeed task={activeTask} /> : taskMode ? <div className="chat-content typing-line">setting up the task…</div> : <div className="chat-content typing-line">thinking…</div>}</div></div> : null}
          {activeTask ? <section className="chat-execution-stack" aria-live="polite">
            {librarySyncNotice?.taskId === activeTask.id ? <div className="provider-fallback-notice chat-library-sync-notice" role="status">{librarySyncNotice.message}</div> : null}
            {browserActivityForTask(activeTask) ? <BrowserActivityCard task={activeTask} /> : null}
            <StepTracker summary={activeTask.events.at(-1)?.detail || activeTask.events.at(-1)?.label || activeTask.title || "Elias is working through the request."} steps={trackerStepsForTask(activeTask)} status={trackerStatusForTask(activeTask.status)} />
            {pendingTaskApproval ? <article className="chat-inline-approval"><div><span>APPROVAL NEEDED</span><strong>{pendingTaskApproval.question}</strong><small>Work is paused until you decide.</small></div><div className="chat-inline-approval-actions"><button type="button" disabled={taskBusy} onClick={() => void resolveTaskApproval(pendingTaskApproval.id, "approve")}>{taskBusy ? "Saving…" : "Approve & continue"}</button><button type="button" disabled={taskBusy} onClick={() => void resolveTaskApproval(pendingTaskApproval.id, "reject")}>Decline</button></div></article> : null}
            <article className="chat-message assistant task-timeline-message">
              <div className="chat-avatar"><img src="/branding/elias-logo.png" alt="ELIAS" /></div>
              <div className="chat-message-body">
                <span className="chat-role">ELIAS · WORKING</span>
                <details className="task-timeline-card">
                  <summary><span><strong>{activeTask.title || "Active task"}</strong><small>{activeTask.status.replaceAll("_", " ")} · {activeTask.plan.filter((step) => step.status === "completed").length}/{activeTask.plan.length || 0} steps</small></span><ChevronRight size={16} /></summary>
                  <GoalProgressCard task={activeTask} compact />
                  <LiveExecutionFeed task={activeTask} />
                  {activeTask.artifacts.length ? <div className="chat-inline-artifacts">{activeTask.artifacts.slice(-4).reverse().map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} href={inlineArtifactHref(activeTask.id, artifact)} compact taskLabel="This task" onPreview={() => setArtifactPreview(artifact)} onDownload={() => { const anchor = document.createElement("a"); anchor.href = inlineArtifactHref(activeTask.id, artifact); anchor.download = artifact.name; anchor.click(); }} />)}</div> : null}
                  <div className="task-timeline-meta" role={activeTask.error ? "alert" : undefined}>{activeTask.error || activeTask.events.at(-1)?.detail || "Task state updates appear here as Elias works."}</div>
                  {!['completed','cancelled','waiting_approval'].includes(activeTask.status) ? <button type="button" className="primary task-timeline-continue" disabled={taskBusy} onClick={() => void continueTask()}>{taskBusy ? "Working…" : "Continue task"}</button> : null}
                </details>
              </div>
            </article>
            <Link className="chat-open-task" href={`/tasks?id=${encodeURIComponent(activeTask.id)}`}><ListChecks size={14} /> Open full task workspace <ChevronRight size={14} /></Link>
            {activeTask.artifacts.length ? <Link className="chat-open-task" href="/files"><FileText size={14} /> View generated files in Library <ChevronRight size={14} /></Link> : null}
          </section> : null}
          <div ref={bottomRef} />
        </div>

        <div className="chat-bottom-region">
          {attachments.length ? <div className="attachment-strip">{attachments.map((file, index) => <span className={`attachment-status ${file.status === "error" ? "attachment-error" : file.status === "ready" ? "attachment-ready" : ""}`} key={`${file.name}-${index}`}><span className="attachment-status-main"><FileText size={13} /><strong>{file.name}</strong><small>{file.status === "uploading" ? `Processing ${file.progress || 0}%` : file.status === "error" ? (file.error || "Failed") : "Ready"}</small></span>{file.status === "uploading" ? <i className="attachment-progress"><b style={{ width: `${file.progress || 0}%` }} /></i> : null}{file.status === "error" ? <button type="button" className="attachment-retry" onClick={() => { if (file.source) void addFiles([file.source]); }}>Retry</button> : null}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={12} /></button></span>)}</div> : null}
          {activeDocumentIds.length ? <aside className="chat-context-panel"><div className="context-heading"><strong>Context</strong><span>{activeDocumentIds.length} document{activeDocumentIds.length === 1 ? "" : "s"} active</span></div><Link href="/files" className="secondary context-manage">Open Library</Link></aside> : null}
          {vercelStatus ? <div className={`chat-connector-status ${vercelStatus.connected ? "connected" : "checking"}`}><span>{vercelStatus.message || (vercelStatus.connected ? "Vercel connected" : "Vercel connector unavailable")}</span>{vercelStatus.tools?.length ? <small>{vercelStatus.tools.length} tools available</small> : null}<button type="button" aria-label="Dismiss connector status" onClick={() => setVercelStatus(null)}><X size={13} /></button></div> : null}
          {providerNotice ? <div className="provider-fallback-notice" role="status">{providerNotice}</div> : null}<div className="chat-composer">
            <textarea className="chat-composer-input" value={input} onChange={(event) => setInput(event.target.value)} rows={1} placeholder="Message ELIAS…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } }} />
            <input ref={uploadRef} hidden type="file" multiple accept=".zip,.ts,.tsx,.js,.jsx,.html,.css,.md,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); void addFiles(files); event.currentTarget.value = ""; }} />
            <div className="chat-composer-bar"><div className="composer-left"><div className="composer-plus-wrap"><button type="button" className="composer-plus" aria-label="Add to chat" aria-expanded={plusOpen} onClick={() => { setPlusOpen((open) => !open); setModelPickerOpen(false); }}><Plus size={19} /></button>{plusOpen ? <div className="chat-plus-popover" role="dialog" aria-label="Add to chat"><div className="chat-plus-popover-head"><div><span className="eyebrow">CONTEXT</span><strong>Add to chat</strong><small>Bring in the source, skill, or model you need.</small></div><button type="button" className="chat-plus-close" onClick={() => setPlusOpen(false)} aria-label="Close Add to chat"><X size={16} /></button></div><div className="chat-plus-grid"><AddChatAction icon={<Paperclip size={17} />} label="Files" onClick={() => { uploadRef.current?.click(); setPlusOpen(false); }} /><Link href="/files" className="add-chat-action" onClick={() => setPlusOpen(false)}><FileClock size={17} /><span>Library</span></Link><Link href="/projects" className="add-chat-action" onClick={() => setPlusOpen(false)}><FolderPlus size={17} /><span>Project</span></Link><Link href="/skills" className="add-chat-action" onClick={() => setPlusOpen(false)}><Puzzle size={17} /><span>Skills</span></Link><Link href="/connectors" className="add-chat-action" onClick={() => setPlusOpen(false)}><Link2 size={17} /><span>Connectors</span></Link><AddChatAction icon={<ListChecks size={17} />} label="Plan" onClick={() => { setInput("Create a clear plan for this request before taking action."); setPlusOpen(false); }} /><AddChatAction icon={<WandSparkles size={17} />} label="Create" onClick={() => { setInput("Create a useful deliverable for "); setPlusOpen(false); }} /><AddChatAction icon={<Sparkles size={17} />} label="Web search" onClick={() => { setInput("Search the web for "); setPlusOpen(false); }} /></div><div className="chat-plus-model"><div className="chat-plus-model-head"><span>Model</span><button type="button" className="chat-model-trigger" aria-expanded={modelPickerOpen} onClick={() => setModelPickerOpen((open) => !open)}><span className="composer-model-mark">{selectedModelOption?.label.slice(0, 1) || "A"}</span><span><strong>{selectedModelOption?.label || "Auto"}</strong><small>{selectedModelOption?.detail || "Best model for the task"}</small></span><ChevronRight size={14} /></button></div>{modelCatalogNotice ? <small className="chat-model-catalog-notice" role="status">{modelCatalogNotice}</small> : null}{modelPickerOpen ? <div className="chat-model-options" role="listbox" aria-label="Choose a model">{modelOptions.map((option) => <button type="button" role="option" aria-selected={selectedModel === option.id} className={`chat-model-option ${selectedModel === option.id ? "selected" : ""}`} key={option.id} onClick={() => { setSelectedModel(option.id); setModelPickerOpen(false); }}><span className="composer-model-mark">{option.label.slice(0, 1)}</span><span><strong>{option.label}</strong><small>{option.detail}</small></span>{selectedModel === option.id ? <Check size={14} /> : null}</button>)}</div> : null}</div>{recentArtifacts.length ? <div className="chat-plus-recent"><div className="chat-plus-section-label">Recent files</div>{recentArtifacts.slice(0, 3).map((artifact) => <button type="button" key={artifact.id} className="chat-plus-recent-row" onClick={() => { setActiveDocumentIds((current) => current.includes(artifact.id) ? current : [...current, artifact.id]); setInput(`Use the recent file ${artifact.name} as context for this conversation.`); setPlusOpen(false); }}><FileText size={15} /><span><strong>{artifact.name}</strong><small>{artifact.type || "file"}</small></span><ChevronRight size={14} /></button>)}</div> : null}<div className="chat-plus-footer"><button type="button" className="chat-plus-footer-action" onClick={() => void connectVercel()}><Link2 size={15} /><span>Check Vercel MCP</span></button><Link href="/tasks" className="chat-plus-footer-action" onClick={() => setPlusOpen(false)}><ListChecks size={15} /><span>Open task board</span></Link></div></div> : null}</div><button type="button" className="chat-model-pill" onClick={() => { setPlusOpen(true); setModelPickerOpen(true); }} aria-label="Choose model">{selectedModelOption?.label || "Auto"}<ChevronRight size={12} /></button><Link href="/studio?mode=voice" className="composer-utility" title="Voice" aria-label="Voice"><Mic size={17} /></Link></div>{busy ? <button className="chat-send stop-button" type="button" onClick={stop} title="Stop generation"><X size={18} /></button> : <button className="chat-send" type="button" disabled={!input.trim()} onClick={() => void sendMessage(input)}><ArrowUp size={18} /></button>}</div>
          </div>
        </div>
          </section>
          <aside className="chat-work-rail" aria-label="Your work">
            <div className="chat-rail-title"><span className="eyebrow">YOUR WORK</span><Link href="/tasks">Task board <ChevronRight size={13} /></Link></div>
            <section className="chat-rail-section"><div className="chat-rail-section-heading"><strong>Recent tasks</strong><span>{recentTasks.length}</span></div>{recentTasks.length ? <div className="chat-rail-task-list">{recentTasks.map((task) => { const completed = task.plan.filter((step) => step.status === "completed").length; const progress = task.plan.length ? Math.round((completed / task.plan.length) * 100) : 0; return <Link className="chat-rail-task" key={task.id} href={`/tasks?id=${encodeURIComponent(task.id)}`}><span className={`chat-rail-task-dot ${task.status}`} /><span className="chat-rail-task-copy"><strong>{task.title || "Untitled task"}</strong><small>{task.status === "waiting_approval" ? "Approval needed" : task.status.replaceAll("_", " ")} · {completed}/{task.plan.length} steps</small><i role="progressbar" aria-label={`${task.title || "Task"} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><b style={{ width: `${progress}%` }} /></i></span><ChevronRight size={13} /></Link>; })}</div> : <p className="chat-rail-empty">Tasks you start will appear here with their latest status and progress.</p>}</section>
            <section className="chat-rail-guide"><span className="chat-rail-guide-mark"><ListChecks size={15} /></span><strong>Work stays reviewable</strong><p>Open any task to inspect its plan, activity, evidence, approvals, files, and saved checkpoints.</p><Link href="/tasks">Explore task workspace <ChevronRight size={13} /></Link></section>
            <section className="chat-rail-section chat-rail-files"><div className="chat-rail-section-heading"><strong>Recent files</strong><Link href="/files">Library</Link></div>{recentArtifacts.length ? recentArtifacts.slice(0, 3).map((artifact) => <Link className="chat-rail-file" key={artifact.id} href="/files"><FileText size={14} /><span><strong>{artifact.name}</strong><small>{artifact.type || "File"}</small></span></Link>) : <p className="chat-rail-empty">Generated files will be available in your Library.</p>}</section>
          </aside>
        </div>
        <ArtifactPreviewSheet artifact={artifactPreview} href={artifactPreview ? inlineArtifactHref(artifactPreview.taskId, artifactPreview) : undefined} onClose={() => setArtifactPreview(null)} onDownload={artifactPreview ? () => { const anchor = document.createElement("a"); anchor.href = inlineArtifactHref(artifactPreview.taskId, artifactPreview); anchor.download = artifactPreview.name; anchor.click(); } : undefined} />
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

function BrowserActivityCard({ task }: { task: TaskRecord }) {
  const activity = browserActivityForTask(task);
  if (!activity) return null;
  const icon = activity.failed ? <AlertCircle size={15} /> : activity.complete ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} className="spin" />;
  return <section className={`browser-activity-card ${activity.failed ? "failed" : activity.waiting ? "waiting" : activity.complete ? "complete" : "active"}`}><div className="browser-activity-icon">{icon}</div><div className="browser-activity-copy"><strong>{activity.label}</strong><span>{activity.detail}</span><small><Globe2 size={11} /> Browser activity · {task.browserSessionId ? "session linked" : "task linked"}</small></div><span className="browser-activity-live">{activity.failed ? "Error" : activity.complete ? "Done" : activity.waiting ? "Approval" : "Live"}</span></section>;
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
