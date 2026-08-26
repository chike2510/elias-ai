const ELIAS = "https://elias-ai-chi.vercel.app";
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const toggle = document.querySelector("#toggle-control");
const detail = document.querySelector("#control-detail");
const dot = document.querySelector("#control-dot");
const approval = document.querySelector("#approval");
let timer;
let activeSessionId = "";

async function authHeaders() {
  const { pairingToken } = await chrome.storage.local.get(["pairingToken"]);
  if (!pairingToken) throw new Error("Pair the extension from the Elias extension settings first.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${pairingToken}` };
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("The active tab must be an HTTP(S) page.");
  return tab;
}
async function startTask() {
  send.disabled = true; status.textContent = "Creating a browser task…";
  try {
    const tab = await activeTab();
    const response = await fetch(`${ELIAS}/api/extension/browser/sessions`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ prompt: prompt.value.trim(), url: tab.url }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not create browser task.");
    activeSessionId = payload.session.id;
    await chrome.storage.local.set({ activeBrowserSessionId: activeSessionId, computerUseEnabled: true });
    status.textContent = "Browser task created. Elias will pause before sensitive actions.";
    render(payload.task);
    updateControl(true);
    watchTask(payload.task.id);
  } catch (error) { status.textContent = error.message || "Could not create browser task."; }
  send.disabled = false;
}
async function watchTask(taskId) {
  clearTimeout(timer);
  try { const response = await fetch(`${ELIAS}/api/tasks/${encodeURIComponent(taskId)}/events`, { headers: await authHeaders(), cache: "no-store" }); if (response.ok) render((await response.json()).task); } catch { /* retain last state */ }
  timer = setTimeout(() => watchTask(taskId), 1800);
}
async function loadControl() {
  const value = await chrome.storage.local.get(["computerUseEnabled", "activeBrowserSessionId"]);
  activeSessionId = value.activeBrowserSessionId || "";
  updateControl(Boolean(value.computerUseEnabled && activeSessionId));
}
function updateControl(enabled) { toggle.textContent = enabled ? "Pause browser control" : "Enable on this task"; dot.className = `dot ${enabled ? "live" : ""}`; detail.textContent = enabled ? "Elias may act after approval." : "Actions are paused."; }
async function toggleControl() { const enabled = toggle.textContent.startsWith("Pause"); await chrome.storage.local.set({ computerUseEnabled: !enabled }); updateControl(!enabled); status.textContent = !enabled ? "Browser control enabled." : "Browser control paused."; }
function render(task) {
  if (!task) return;
  progress.hidden = false;
  document.querySelector("#title").textContent = task.title || "Elias browser task";
  const plan = Array.isArray(task.plan) ? task.plan : [];
  const completed = plan.filter((step) => step.status === "completed").length;
  document.querySelector("#meter").style.width = `${plan.length ? completed / plan.length * 100 : 0}%`;
  document.querySelector("#count").textContent = `${completed}/${plan.length} steps · ${task.status}`;
  document.querySelector("#steps").innerHTML = plan.map((step) => `<article class="step ${escapeHtml(step.status)}"><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.description || step.status)}</small></article>`).join("");
  const pending = (task.approvals || []).find((item) => item.status === "pending");
  if (pending) { approval.hidden = false; approval.textContent = `Approval needed: ${pending.question}`; } else approval.hidden = true;
  if (["completed", "failed", "cancelled"].includes(task.status)) { clearTimeout(timer); status.textContent = task.status === "completed" ? "Task completed." : `Task ${task.status}.`; }
}
function escapeHtml(value) { return String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }
send.addEventListener("click", () => void startTask());
toggle.addEventListener("click", () => void toggleControl());
void loadControl();
