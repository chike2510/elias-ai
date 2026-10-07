"use client";

/** Client side of the unified chat: typed API calls, SSE streaming with a JSON fallback, haptics. */
import type { Approval, StoredMessage, TurnEvent, TurnResult } from "@/lib/assistant/agent";
import type { Card, ConnectCard, MemoryChip } from "@/lib/assistant/cards";

export type { Approval, Card, ConnectCard, MemoryChip, StoredMessage, TurnEvent, TurnResult };
export type ConversationSummary = { id: string; title: string; kind: string; source: string; updatedAt: string; pendingApprovals: number; preview: string };
export type Status = { database: boolean; providers: string[]; google: { configured: boolean; connected: boolean; email: string | null }; browser: { configured: boolean }; github: { connected: boolean }; scheduler: { configured: boolean }; errorTracking: boolean; settings: { timezone: string | null; city: string | null } | null };

export const CONVERSATIONS_CHANGED = "elias:conversations-changed";

export function userTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos"; } catch { return "Africa/Lagos"; }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0, "OFFLINE");
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string; code?: string } } | null;
  if (!response.ok || !data?.ok) throw new ApiError(data?.error?.message || `Something went wrong (HTTP ${response.status}).`, response.status, data?.error?.code);
  return data as T;
}

export function haptic(ms = 10) {
  try { if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms); } catch { /* unsupported */ }
}

export function announceConversationsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
}

/**
 * Sends a message and streams the turn. Falls back to the plain JSON endpoint when the
 * response can't be streamed (old browsers, proxies that buffer), emitting the same events.
 */
export async function sendChat(input: { text: string; conversationId?: string }, onEvent: (event: TurnEvent) => void, signal?: AbortSignal): Promise<TurnResult> {
  const body = JSON.stringify({ text: input.text, conversationId: input.conversationId, timezone: userTimezone(), stream: true });
  let response: Response;
  try {
    response = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body, signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0, "OFFLINE");
  }
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("event-stream") || !response.body?.getReader) {
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
      throw new ApiError(data?.error?.message || `Elias couldn't answer (HTTP ${response.status}).`, response.status, data?.error?.code);
    }
    const data = await response.json().catch(() => null) as (TurnResult & { ok?: boolean }) | null;
    if (!data?.ok) return sendChatJson(input, onEvent);
    replayResult(data, onEvent);
    return data;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TurnResult | null = null;
  let failure: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = chunk.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      let event: TurnEvent | { type: "ping" };
      try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (event.type === "ping") continue;
      if (event.type === "done") result = event.result;
      if (event.type === "error") failure = event.message;
      onEvent(event);
    }
  }
  if (failure) throw new ApiError(failure, 500, "ASSISTANT_FAILED");
  if (!result) throw new ApiError("The reply was cut off. Try again.", 0, "STREAM_CUT");
  return result;
}

/** Non-streaming fallback. */
export async function sendChatJson(input: { text: string; conversationId?: string }, onEvent: (event: TurnEvent) => void) {
  const data = await api<TurnResult>("/api/assistant/chat", { method: "POST", body: JSON.stringify({ text: input.text, conversationId: input.conversationId, timezone: userTimezone() }) });
  replayResult(data, onEvent);
  return data;
}

function replayResult(result: TurnResult, onEvent: (event: TurnEvent) => void) {
  onEvent({ type: "conversation", conversationId: result.conversationId });
  for (const approval of result.approvals || []) onEvent({ type: "approval", approval });
  onEvent({ type: "delta", text: result.reply });
  onEvent({ type: "done", result });
}
