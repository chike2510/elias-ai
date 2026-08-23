import { fetchUrl } from "@/lib/webSearch";
import { recordTaskEvent } from "@/lib/taskStore";
import type { BrowserAction, BrowserActionResult, BrowserSession } from "@/lib/browser/types";

const MAX_SESSIONS = 20;

type BrowserState = { sessions: Map<string, BrowserSession> };
declare global { var __eliasBrowserState: BrowserState | undefined; }
function state() { return globalThis.__eliasBrowserState ||= { sessions: new Map() }; }
function clone<T>(value: T): T { return structuredClone(value); }
function save(session: BrowserSession) { session.updatedAt = Date.now(); state().sessions.set(session.id, clone(session)); return clone(session); }

export function createBrowserSession(taskId: string, initialUrl?: string) {
  if (state().sessions.size >= MAX_SESSIONS) state().sessions.delete(state().sessions.keys().next().value as string);
  const now = Date.now();
  return save({ id: `browser_${crypto.randomUUID()}`, taskId, status: "starting", ...(initialUrl ? { currentUrl: initialUrl } : {}), createdAt: now, updatedAt: now });
}
export function getBrowserSession(id: string) { const value = state().sessions.get(id); return value ? clone(value) : undefined; }

export async function performBrowserAction(id: string, action: BrowserAction): Promise<BrowserActionResult> {
  const current = getBrowserSession(id);
  if (!current) throw new Error("Browser session not found.");
  if (current.status === "closed" || current.status === "failed") throw new Error("Browser session is no longer active.");
  if (action.type === "close") {
    const session = save({ ...current, status: "closed" });
    recordTaskEvent(current.taskId, { kind: "action", label: "Closed Elias browser session", status: "completed", detail: session.id });
    return { session, summary: "Browser session closed." };
  }
  if (action.type === "pause") {
    const session = save({ ...current, status: "paused" });
    recordTaskEvent(current.taskId, { kind: "action", label: "Paused Elias browser session", status: "completed", detail: "Waiting for the user to resume." });
    return { session, summary: "Browser session paused." };
  }
  if (action.type === "screenshot") throw new Error("Interactive screenshots require a persistent browser worker; public-page browsing is available now.");
  if (action.type === "extract") {
    if (!current.extractedText) throw new Error("Open a public page before extracting content.");
    return { session: current, summary: "Returned the bounded public-page text.", content: current.extractedText, sourceUrls: current.currentUrl ? [current.currentUrl] : [] };
  }
  const session = save({ ...current, status: "active", currentUrl: action.url });
  try {
    const content = await fetchUrl(action.url);
    const updated = save({ ...session, status: "active", title: new URL(action.url).hostname, extractedText: content });
    recordTaskEvent(current.taskId, { kind: "tool", label: "Opened public page", status: "completed", detail: `${updated.title} · ${content.length.toLocaleString()} characters`, evidence: { type: "url", value: action.url } });
    return { session: updated, summary: `Opened ${updated.title} and extracted bounded public text.`, content, sourceUrls: [action.url] };
  } catch (error) {
    const failed = save({ ...session, status: "active", lastError: error instanceof Error ? error.message : "Could not open public page." });
    recordTaskEvent(current.taskId, { kind: "tool", label: "Public page open failed", status: "failed", detail: failed.lastError });
    throw error;
  }
}
