const ELIAS = "https://elias-ai-chi.vercel.app";
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
let timer;

send.addEventListener("click", async () => {
  send.disabled = true;
  status.textContent = "Capturing the active page…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("The active tab is not a public web page.");
    const [executed] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, visibleText: (document.body?.innerText || "").slice(0, 80000) }) });
    const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
    const response = await fetch(`${ELIAS}/api/extension/capture`, { method: "POST", headers: { "Content-Type": "application/json", ...(pairingToken ? { Authorization: `Bearer ${pairingToken}` } : {}) }, credentials: "include", body: JSON.stringify({ prompt: prompt.value.trim() || "Summarize and verify this page using current sources.", source: "browser-extension", page: { url: tab.url, title: executed?.result?.title || "", visibleText: executed?.result?.visibleText || "", capturedAt: new Date().toISOString() } }) });
    if (!response.ok) throw new Error(`Elias capture failed (${response.status})`);
    const payload = await response.json();
    status.textContent = "Task created. Elias is working…";
    render(payload.task);
    watch(payload.taskId);
  } catch (error) { status.textContent = error.message || "Capture failed."; }
  send.disabled = false;
});

async function watch(taskId) {
  clearTimeout(timer);
  try { const { pairingToken } = await chrome.storage.local.get(["pairingToken"]); const response = await fetch(`${ELIAS}/api/tasks/${encodeURIComponent(taskId)}/events`, { headers: pairingToken ? { Authorization: `Bearer ${pairingToken}` } : {}, credentials: "include", cache: "no-store" }); if (response.ok) render((await response.json()).task); } catch { /* retain last snapshot */ }
  timer = setTimeout(() => watch(taskId), 1800);
}

function render(task) {
  if (!task) return;
  progress.hidden = false;
  document.querySelector("#title").textContent = task.title || "Elias task";
  const plan = Array.isArray(task.plan) ? task.plan : [];
  const completed = plan.filter((step) => step.status === "completed").length;
  document.querySelector("#meter").style.width = `${plan.length ? completed / plan.length * 100 : 0}%`;
  document.querySelector("#count").textContent = `${completed}/${plan.length} steps · ${task.status}`;
  document.querySelector("#steps").innerHTML = plan.map((step) => `<article class="step ${step.status}"><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.description || step.status)}</small></article>`).join("");
  if (["completed", "failed", "cancelled"].includes(task.status)) { clearTimeout(timer); status.textContent = task.status === "completed" ? "Task completed." : `Task ${task.status}.`; }
}
function escapeHtml(value) { return String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }
