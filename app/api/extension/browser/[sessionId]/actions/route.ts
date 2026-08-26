import { NextRequest, after } from "next/server";
import { extensionTokenFromRequest } from "@/lib/extensionAuth";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { claimNextBrowserAction, completeBrowserAction, getBrowserSession } from "@/lib/browser/browserManager";
import { runTaskLoop } from "@/lib/taskOrchestrator";

export const runtime = "nodejs";

async function owned(request: NextRequest, sessionId: string) {
  const token = extensionTokenFromRequest(request);
  const session = await getBrowserSession(sessionId);
  if (!token || !session || (session.ownerId && session.ownerId !== token.sub)) return null;
  return session;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await owned(request, sessionId);
  if (!session) return jsonError("Browser session not found or extension is not paired.", 404, "NOT_FOUND");
  const action = await claimNextBrowserAction(sessionId);
  const latest = await getBrowserSession(sessionId);
  return jsonOk({ session: latest, action: action || null });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    if (!(await owned(request, sessionId))) return jsonError("Browser session not found or extension is not paired.", 404, "NOT_FOUND");
    const body = await readJsonRequest<{ actionId?: unknown; ok?: unknown; result?: unknown; url?: unknown; title?: unknown; text?: unknown; imageDataUrl?: unknown }>(request);
    if (typeof body.actionId !== "string" || typeof body.ok !== "boolean") return jsonError("actionId and ok are required.", 400, "INVALID_REQUEST");
    const result = await completeBrowserAction(sessionId, body.actionId, { ok: body.ok, result: typeof body.result === "string" ? body.result : undefined, url: typeof body.url === "string" ? body.url : undefined, title: typeof body.title === "string" ? body.title : undefined, text: typeof body.text === "string" ? body.text : undefined, imageDataUrl: typeof body.imageDataUrl === "string" ? body.imageDataUrl : undefined });
    after(async () => { try { await runTaskLoop(result.session.taskId, 1); } catch { /* task event history records the browser result */ } });
    return jsonOk(result);
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Browser action result failed."); }
}
