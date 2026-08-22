const ELIAS_ORIGIN = "https://elias-ai-chi.vercel.app";
const POLL_MS = 1800;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "ask-elias-selection", title: "Ask Elias about this selection", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "research-elias-page", title: "Research this page with Elias", contexts: ["page"] });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-elias") chrome.tabs.create({ url: `${ELIAS_ORIGIN}/chat` });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return;
  const prompt = info.menuItemId === "ask-elias-selection" ? "Explain and verify this selected text using current sources." : "Research this page, summarize the key claims, and verify important facts using current sources.";
  const capture = await captureTab(tab.id, info.selectionText || "");
  await createTask(prompt, capture);
});

async function captureTab(tabId, selectedText = "") {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ title: document.title, visibleText: (document.body?.innerText || "").slice(0, 80000) }) });
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url || "", title: result?.result?.title || "", visibleText: selectedText ? "" : result?.result?.visibleText || "", selectedText };
}

async function createTask(prompt, page) {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  const response = await fetch(`${ELIAS_ORIGIN}/api/extension/capture`, { method: "POST", headers: { "Content-Type": "application/json", ...(pairingToken ? { Authorization: `Bearer ${pairingToken}` } : {}) }, credentials: "include", body: JSON.stringify({ prompt, page, source: "browser-extension" }) });
  if (!response.ok) throw new Error(`Elias capture failed (${response.status})`);
  const payload = await response.json();
  await chrome.storage.local.set({ lastTaskId: payload.taskId });
  pollTask(payload.taskId);
  return payload;
}

async function pollTask(taskId) {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  const response = await fetch(`${ELIAS_ORIGIN}/api/tasks/${encodeURIComponent(taskId)}/events`, { headers: pairingToken ? { Authorization: `Bearer ${pairingToken}` } : {}, credentials: "include", cache: "no-store" });
  if (!response.ok) return;
  const payload = await response.json();
  await chrome.storage.local.set({ lastTask: payload });
  if (["completed", "failed", "cancelled"].includes(payload.task?.status)) {
    if (payload.task.status === "completed") chrome.notifications.create(`elias-${taskId}`, { type: "basic", title: "Elias task completed", message: payload.task.title || "Your browser task is ready." });
    return;
  }
  setTimeout(() => pollTask(taskId), POLL_MS);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "capture-current-tab") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) throw new Error("No active tab");
      const page = await captureTab(tab.id, message.selectedText || "");
      const payload = await createTask(message.prompt || "Summarize and verify this page.", page);
      sendResponse({ ok: true, payload });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "get-last-task") chrome.storage.local.get(["lastTask"]).then((value) => sendResponse({ ok: true, payload: value.lastTask || null }));
  return true;
});
