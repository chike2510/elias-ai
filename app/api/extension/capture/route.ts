import { NextRequest, after } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createTaskRecord, runTaskLoop } from "@/lib/taskOrchestrator";
import { recordTaskEvent, snapshotStoredTask } from "@/lib/taskStore";
import { extensionTokenFromRequest } from "@/lib/extensionAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  try {
    if (!extensionTokenFromRequest(request)) return jsonError("Pair this extension with a signed-in Elias account first.", 401, "EXTENSION_AUTH_REQUIRED");
    const body = await readJsonRequest<{ prompt?: unknown; source?: unknown; page?: { url?: unknown; title?: unknown; selectedText?: unknown; visibleText?: unknown; capturedAt?: unknown } }>(request);
    const prompt = text(body.prompt, 12_000);
    const page = body.page || {};
    const url = text(page.url, 2_000);
    const title = text(page.title, 500);
    const selectedText = text(page.selectedText, 40_000);
    const visibleText = text(page.visibleText, 80_000);
    if (!prompt) return jsonError("prompt is required", 400, "INVALID_REQUEST");
    if (!url || !/^https?:\/\//i.test(url)) return jsonError("A public HTTP(S) page URL is required.", 400, "INVALID_REQUEST");
    if (!selectedText && !visibleText) return jsonError("Page text or a selection is required.", 400, "INVALID_REQUEST");
    const objective = `${prompt}\n\n[CAPTURED BROWSER CONTEXT — user-provided, not independently verified]\nURL: ${url}\nTitle: ${title || "Untitled page"}\nCaptured at: ${text(page.capturedAt, 80) || new Date().toISOString()}\n${selectedText ? `Selected text:\n${selectedText}` : `Visible page text:\n${visibleText}`}`;
    const task = await createTaskRecord({ objective, kind: "research", taskType: "research" });
    recordTaskEvent(task.id, { kind: "action", label: "Captured page context", status: "completed", detail: `${title || url} · browser extension`, evidence: { type: "url", value: url } });
    const snapshot = await snapshotStoredTask(task.id);
    after(async () => { try { await runTaskLoop(task.id, 6); } catch { /* task state records failures for polling clients */ } });
    return jsonOk({ taskId: task.id, task: snapshot?.task || task, source: body.source === "browser-extension" ? "browser-extension" : "extension" }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create captured-page task.");
  }
}
