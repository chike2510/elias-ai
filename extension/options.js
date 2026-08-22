const token = document.querySelector("#token");
const save = document.querySelector("#save");
const status = document.querySelector("#status");
chrome.storage.local.get(["pairingToken"]).then((value) => { token.value = value.pairingToken || ""; });
save.addEventListener("click", async () => { const value = token.value.trim(); if (!value) { status.textContent = "Paste a pairing token first."; return; } await chrome.storage.local.set({ pairingToken: value }); status.textContent = "Pairing saved. Elias capture is ready."; });
