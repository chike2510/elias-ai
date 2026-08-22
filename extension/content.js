chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "get-selection") return;
  sendResponse({ selectedText: window.getSelection?.()?.toString?.().slice(0, 40000) || "" });
});
