import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { getBrowserSession, performBrowserAction } from "@/lib/browser/browserManager";
import type { BrowserAction } from "@/lib/browser/types";

export const runtime = "nodejs";

async function owned(request: NextRequest, sessionId: string) {
  const identity = await getSession();
  const session = await getBrowserSession(sessionId);
  if (!session || !identity || (session.ownerId && session.ownerId !== identity.userId)) return null;
  return session;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await owned(request, sessionId);
  return session ? jsonOk({ session }) : jsonError("Browser session not found.", 404, "NOT_FOUND");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    if (!(await owned(request, sessionId))) return jsonError("Browser session not found.", 404, "NOT_FOUND");
    const body = await readJsonRequest<BrowserAction>(request);
    if (!body || !["open", "navigate", "click", "type", "scroll", "screenshot", "pause", "close", "extract"].includes(body.type)) return jsonError("Unsupported browser action.", 400, "INVALID_ACTION");
    const result = await performBrowserAction(sessionId, body);
    return jsonOk(result);
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Browser action failed."); }
}
