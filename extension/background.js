const ELIAS_ORIGIN = "https://elias-ai-chi.vercel.app";
const POLL_MS = 1800;
const CONTROL_KEY = "computerUseEnabled";
let pollTimer;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "ask-elias-selection", title: "Ask Elias about this selection", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "research-elias-page", title: "Research this page with Elias", contexts: ["page"] });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
  chrome.alarms?.create("elias-browser-poll", { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup?.addListener(() => chrome.alarms?.create("elias-browser-poll", { periodInMinutes: 0.5 }));
chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === "elias-browser-poll") void pollBrowserActions(); });

chrome.commands.onCommand.addListener((command) => { if (command === "open-elias") chrome.tabs.create({ url: `${ELIAS_ORIGIN}/chat` }); });
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return;
  const prompt = info.menuItemId === "ask-elias-selection" ? "Explain and verify this selected text using current sources." : "Research this page, summarize the key claims, and verify important facts using current sources.";
  try { const capture = await captureTab(tab.id, info.selectionText || ""); await createTask(prompt, capture); } catch (error) { console.warn("Elias capture failed", error); }
});

async function authHeaders() {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  return { "Content-Type": "application/json", ...(pairingToken ? { Authorization: `Bearer ${pairingToken}` } : {}) };
}
async function captureTab(tabId, selectedText = "") {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ title: document.title, visibleText: (document.body?.innerText || "").slice(0, 80000) }) });
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url || "", title: result?.result?.title || "", visibleText: selectedText ? "" : result?.result?.visibleText || "", selectedText };
}
async function createTask(prompt, page) {
  const response = await fetch(`${ELIAS_ORIGIN}/api/extension/capture`, { method: "POST", headers: await authHeaders(), credentials: "include", body: JSON.stringify({ prompt, page, source: "browser-extension" }) });
  if (!response.ok) throw new Error(`Elias capture failed (${response.status})`);
  const payload = await response.json();
  await chrome.storage.local.set({ lastTaskId: payload.taskId });
  pollTask(payload.taskId);
  return payload;
}
async function pollTask(taskId) {
  const response = await fetch(`${ELIAS_ORIGIN}/api/tasks/${encodeURIComponent(taskId)}/events`, { headers: await authHeaders(), credentials: "include", cache: "no-store" });
  if (!response.ok) return;
  const payload = await response.json();
  await chrome.storage.local.set({ lastTask: payload });
  if (["completed", "failed", "cancelled"].includes(payload.task?.status)) {
    if (payload.task.status === "completed") chrome.notifications.create(`elias-${taskId}`, { type: "basic", title: "Elias task completed", message: payload.task.title || "Your browser task is ready." });
    return;
  }
  setTimeout(() => pollTask(taskId), POLL_MS);
}

async function waitForTab(tabId) {
  for (let index = 0; index < 20; index += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return chrome.tabs.get(tabId);
}
async function pageObservation(tabId, selector = "") {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [selector], func: (targetSelector) => {
    const root = targetSelector ? document.querySelector(targetSelector) : document.body;
    return { url: location.href, title: document.title, text: (root?.innerText || "").slice(0, 80000) };
  } });
  return result?.result || {};
}
async function executeAction(tabId, action) {
  if (action.type === "navigate") {
    if (!/^https?:/i.test(action.url || "")) throw new Error("Only HTTP(S) browser navigation is allowed.");
    await chrome.tabs.update(tabId, { url: action.url });
    await waitForTab(tabId);
    const observation = await pageObservation(tabId);
    return { ...observation, result: `Navigated to ${observation.url || action.url}.` };
  }
  if (action.type === "click") {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [action.selector], func: (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`No element matched ${selector}.`);
      element.scrollIntoView({ block: "center", behavior: "instant" });
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return { url: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 80000), result: `Clicked ${selector}.` };
    } });
    return result.result;
  }
  if (action.type === "type") {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [action.selector, action.text || ""], func: (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`No element matched ${selector}.`);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element instanceof HTMLElement)) throw new Error("Element cannot receive text.");
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set; setter?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); } else element.textContent = value;
      return { url: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 80000), result: `Entered text into ${selector}.` };
    } });
    return result.result;
  }
  if (action.type === "scroll") {
    const distance = Math.max(100, Math.min(1600, Number(action.amount) || 600));
    await chrome.scripting.executeScript({ target: { tabId }, args: [action.direction === "up" ? -distance : distance], func: (amount) => window.scrollBy({ top: amount, behavior: "instant" }) });
    return { ...(await pageObservation(tabId)), result: `Scrolled ${action.direction || "down"}.` };
  }
  if (action.type === "extract") return { ...(await pageObservation(tabId, action.selector || "")), result: "Extracted the visible page context." };
  if (action.type === "screenshot") return { ...(await pageObservation(tabId)), imageDataUrl: await chrome.tabs.captureVisibleTab((await chrome.tabs.get(tabId)).windowId, { format: "png" }), result: "Captured the active browser view." };
  throw new Error(`Unsupported browser action: ${action.type}`);
}

async function pollBrowserActions() {
  const { [CONTROL_KEY]: enabled, activeBrowserSessionId } = await chrome.storage.local.get([CONTROL_KEY, "activeBrowserSessionId"]);
  if (!enabled || !activeBrowserSessionId) return;
  try {
    const headers = await authHeaders();
    const response = await fetch(`${ELIAS_ORIGIN}/api/extension/browser/actions/${encodeURIComponent(activeBrowserSessionId)}`, { headers, cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.action) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab is available for browser control.");
    let output;
    try { output = await executeAction(tab.id, payload.action); await reportBrowserAction(activeBrowserSessionId, payload.action.id, { ok: true, ...output }); }
    catch (error) { await reportBrowserAction(activeBrowserSessionId, payload.action.id, { ok: false, result: error instanceof Error ? error.message : "Browser action failed.", url: tab.url || "" }); }
  } catch (error) { console.warn("Elias browser control polling failed", error); }
  clearTimeout(pollTimer); pollTimer = setTimeout(() => void pollBrowserActions(), POLL_MS);
}
async function reportBrowserAction(sessionId, actionId, result) {
  await fetch(`${ELIAS_ORIGIN}/api/extension/browser/actions/${encodeURIComponent(sessionId)}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ actionId, ...result }) });
}
void pollBrowserActions();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "capture-current-tab") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => { if (!tab?.id) throw new Error("No active tab"); const page = await captureTab(tab.id, message.selectedText || ""); const payload = await createTask(message.prompt || "Summarize and verify this page.", page); sendResponse({ ok: true, payload }); }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "enable-browser-control") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => { await chrome.storage.local.set({ [CONTROL_KEY]: true, activeBrowserSessionId: message.sessionId || "" }); void pollBrowserActions(); sendResponse({ ok: true, tabId: tab?.id || null }); }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "disable-browser-control") { chrome.storage.local.set({ [CONTROL_KEY]: false }).then(() => sendResponse({ ok: true })); return true; }
  if (message?.type === "get-browser-control") { chrome.storage.local.get([CONTROL_KEY, "activeBrowserSessionId"]).then((value) => sendResponse({ ok: true, enabled: Boolean(value[CONTROL_KEY]), sessionId: value.activeBrowserSessionId || "" })); return true; }
  if (message?.type === "get-last-task") chrome.storage.local.get(["lastTask"]).then((value) => sendResponse({ ok: true, payload: value.lastTask || null }));
  return true;
});
