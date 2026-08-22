# Elias Browser Extension

This Manifest V3 companion lets a user capture the active page or a selected passage and create a research task in Elias. The main Elias web app remains the execution authority: models, connectors, source verification, approvals, artifacts, and task state stay server-side.

## Local installation

1. Open `chrome://extensions` in Chrome or Chromium.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `extension/` directory.
5. Open the extension popup or side panel on a public page.
6. Enter an instruction and choose **Capture page and send**.

The extension calls `https://elias-ai-chi.vercel.app/api/extension/capture`, then polls `/api/tasks/:taskId/events` until the task reaches a terminal state.

## Security model

The content script reads only an explicit user selection. The popup and side panel read the active page only after the user clicks capture. Password fields, hidden inputs, and page credentials are not collected. Captured page text is labeled as user-provided context and must be independently verified by Elias before being treated as evidence.

The extension does not contain model, GitHub, Vercel, or search credentials. External writes must remain behind Elias approval steps. For production hardening, configure a short-lived pairing token and require it as `Authorization: Bearer <extension-token>` on the capture and event endpoints before publishing the extension broadly.

## Shared Goal Progress Card

The extension uses the task record and event snapshot returned by Elias. The web app and extension therefore display the same task ID, plan steps, status, approvals, errors, and terminal result. Closing the extension does not cancel a task.

## Files

- `manifest.json`: Manifest V3 permissions and entry points.
- `background.js`: Context menus, capture orchestration, notifications, and task polling.
- `content.js`: Explicit selection capture.
- `popup.html`, `popup.css`, `popup.js`: Quick capture popup.
- `sidepanel.html`, `sidepanel.css`, `sidepanel.js`: Persistent task monitor.
