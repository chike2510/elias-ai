const prompt = document.querySelector("#prompt");
const capture = document.querySelector("#capture");
const status = document.querySelector("#status");
const open = document.querySelector("#open");

capture.addEventListener("click", () => {
  capture.disabled = true;
  status.textContent = "Capturing the current page…";
  chrome.runtime.sendMessage({ type: "capture-current-tab", prompt: prompt.value.trim() || "Summarize and verify this page using current sources." }, (response) => {
    capture.disabled = false;
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = response?.error || chrome.runtime.lastError?.message || "Capture failed.";
      return;
    }
    status.textContent = `Task created: ${response.payload.taskId}`;
  });
});

open.addEventListener("click", () => chrome.tabs.create({ url: "https://elias-ai-chi.vercel.app/chat" }));
