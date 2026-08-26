import { fetchUrl } from "@/lib/webSearch";
import { getStoredTask, recordTaskEvent, requestTaskApproval } from "@/lib/taskStore";
import { getStoredBrowserSession, listStoredBrowserSessions, saveBrowserSession } from "@/lib/browser/browserStore";
import type { BrowserAction, BrowserActionRequest, BrowserActionResult, BrowserObservation, BrowserSession } from "@/lib/browser/types";

const MAX_QUEUE_TEXT = 12_000;
const MAX_OBSERVATION_TEXT = 80_000;
const APPROVAL_ACTIONS = new Set(["click", "type"]);
function clone<T>(value: T): T { return structuredClone(value); }
function now() { return Date.now(); }
function needsApproval(action: BrowserAction) { return APPROVAL_ACTIONS.has(action.type); }
function bounded(value: unknown, max: number) { return typeof value === "string" ? value.slice(0, max) : undefined; }

export async function createBrowserSession(taskId: string, initialUrl?: string, ownerId?: string) {
  const sessions = await listStoredBrowserSessions();
  if (sessions.length >= 20) { const oldest = sessions.sort((a, b) => a.updatedAt - b.updatedAt)[0]; if (oldest) await saveBrowserSession({ ...oldest, status: "closed", pendingActions: [], observations: [] }); }
  const timestamp = now();
  return saveBrowserSession({ id: `browser_${crypto.randomUUID()}`, taskId, ownerId, status: "starting", ...(initialUrl ? { currentUrl: initialUrl } : {}), createdAt: timestamp, updatedAt: timestamp, pendingActions: [], observations: [] });
}
export async function getBrowserSession(id: string) { return getStoredBrowserSession(id); }
export async function listBrowserSessions(taskId?: string) { return listStoredBrowserSessions(taskId); }

async function addObservation(session: BrowserSession, observation: Omit<BrowserObservation, "id" | "createdAt">) {
  session.observations.push({ id: `obs_${crypto.randomUUID()}`, createdAt: now(), ...observation });
  if (session.observations.length > 30) session.observations = session.observations.slice(-30);
}

export async function performBrowserAction(id: string, action: BrowserAction): Promise<BrowserActionResult> {
  const current = await getStoredBrowserSession(id);
  if (!current) throw new Error("Browser session not found.");
  if (current.status === "closed" || current.status === "failed") throw new Error("Browser session is no longer active.");
  if (action.type === "close") {
    current.status = "closed"; current.pendingActions = [];
    await saveBrowserSession(current);
    await recordTaskEvent(current.taskId, { kind: "action", label: "Closed browser session", status: "completed", detail: current.id });
    return { session: current, summary: "Browser session closed." };
  }
  if (action.type === "pause") {
    current.status = "paused";
    await saveBrowserSession(current);
    await recordTaskEvent(current.taskId, { kind: "action", label: "Paused browser session", status: "completed", detail: "Waiting for the user to resume." });
    return { session: current, summary: "Browser session paused." };
  }
  if (action.type === "extract") {
    if (!current.extractedText) throw new Error("Open a public page before extracting content.");
    return { session: current, summary: "Returned the bounded public-page text.", content: current.extractedText, sourceUrls: current.currentUrl ? [current.currentUrl] : [] };
  }
  if (action.type === "open") {
    if (!action.url || !/^https?:\/\/[^\s]+$/i.test(action.url)) throw new Error("Enter a complete public HTTP(S) URL.");
    current.status = "active"; current.currentUrl = action.url;
    try {
      const content = await fetchUrl(action.url);
      current.title = new URL(action.url).hostname; current.extractedText = content;
      await addObservation(current, { kind: "page", url: action.url, title: current.title, text: content });
      await saveBrowserSession(current);
      await recordTaskEvent(current.taskId, { kind: "tool", label: "Opened public page", status: "completed", detail: `${current.title} · ${content.length.toLocaleString()} characters`, evidence: { type: "url", value: action.url } });
      return { session: current, summary: `Opened ${current.title} and extracted bounded public text.`, content, sourceUrls: [action.url] };
    } catch (error) {
      current.lastError = error instanceof Error ? error.message : "Could not open public page.";
      current.status = "active";
      await addObservation(current, { kind: "error", url: action.url, text: current.lastError });
      await saveBrowserSession(current);
      await recordTaskEvent(current.taskId, { kind: "tool", label: "Public page open failed", status: "failed", detail: current.lastError });
      throw error;
    }
  }

  if (current.status === "paused") current.status = "active";
  const task = await getStoredTask(current.taskId);
  if (!task) throw new Error("Browser task not found.");
  const approvalRequired = needsApproval(action);
  let approvalId: string | undefined;
  if (approvalRequired) {
    const approval = await requestTaskApproval(current.taskId, "external_side_effect", `ELIAS wants to ${action.type === "click" ? "click an element" : "enter text into a website"} in the connected browser.`);
    approvalId = approval.id;
    current.status = "waiting_for_user";
  }
  const item: BrowserActionRequest = { ...clone(action), id: `browser_action_${crypto.randomUUID()}`, status: "queued", requiresApproval: approvalRequired, ...(approvalId ? { approvalId } : {}), createdAt: now(), updatedAt: now(), ...(action.text ? { text: action.text.slice(0, MAX_QUEUE_TEXT) } : {}) };
  current.pendingActions = [...current.pendingActions.filter((queued) => queued.status !== "completed" && queued.status !== "failed"), item];
  await saveBrowserSession(current);
  await recordTaskEvent(current.taskId, { kind: "action", label: approvalRequired ? "Browser action waiting for approval" : "Browser action queued", status: "started", detail: `${action.type}${action.selector ? ` · ${action.selector}` : ""}`, evidence: { type: "json", value: { actionId: item.id, type: action.type, requiresApproval: approvalRequired } } });
  return { session: current, summary: approvalRequired ? "Waiting for your approval before Elias acts in the browser." : "Browser action queued for the connected browser.", action: item };
}

export async function claimNextBrowserAction(id: string) {
  const current = await getStoredBrowserSession(id);
  if (!current || ["closed", "failed", "paused"].includes(current.status)) return undefined;
  const task = await getStoredTask(current.taskId);
  const next = current.pendingActions.find((action) => {
    if (action.status !== "queued") return false;
    if (!action.requiresApproval) return true;
    return Boolean(action.approvalId && task?.approvals.some((approval) => approval.id === action.approvalId && approval.status === "approved"));
  });
  if (!next) return undefined;
  next.status = "running"; next.updatedAt = now(); current.status = "active";
  await saveBrowserSession(current);
  return next;
}

export async function completeBrowserAction(id: string, actionId: string, input: { ok: boolean; result?: string; url?: string; title?: string; text?: string; imageDataUrl?: string }) {
  const current = await getStoredBrowserSession(id);
  if (!current) throw new Error("Browser session not found.");
  const action = current.pendingActions.find((item) => item.id === actionId);
  if (!action) throw new Error("Browser action not found.");
  action.status = input.ok ? "completed" : "failed"; action.updatedAt = now(); action.result = bounded(input.result, MAX_QUEUE_TEXT); action.error = input.ok ? undefined : bounded(input.result, MAX_QUEUE_TEXT);
  if (input.url) current.currentUrl = input.url;
  if (input.title) current.title = input.title;
  if (input.text) { current.extractedText = input.text.slice(0, MAX_OBSERVATION_TEXT); await addObservation(current, { kind: "page", url: input.url, title: input.title, text: current.extractedText, actionId }); }
  if (input.imageDataUrl) await addObservation(current, { kind: "screenshot", url: input.url, title: input.title, imageDataUrl: input.imageDataUrl.slice(0, 4_000_000), actionId });
  await addObservation(current, { kind: input.ok ? "action" : "error", url: input.url, title: input.title, text: bounded(input.result, MAX_QUEUE_TEXT), actionId });
  current.status = input.ok ? "active" : "waiting_for_user";
  await saveBrowserSession(current);
  await recordTaskEvent(current.taskId, { kind: input.ok ? "action" : "error", label: input.ok ? `Browser action completed: ${action.type}` : `Browser action failed: ${action.type}`, status: input.ok ? "completed" : "failed", detail: input.result || "Browser bridge returned an observation.", evidence: { type: input.imageDataUrl ? "url" : "json", value: { actionId, url: input.url, title: input.title, text: bounded(input.text, 2_000) } } });
  return { session: current, action };
}
