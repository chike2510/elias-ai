import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { getBrowserSession, performBrowserAction } from "@/lib/browser/browserManager";
import type { BrowserAction } from "@/lib/browser/types";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = getBrowserSession(sessionId);
  return session ? jsonOk({ session }) : jsonError("Browser session not found.", 404, "NOT_FOUND");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const body = await readJsonRequest<BrowserAction>(request);
    if (!body || !["open", "extract", "screenshot", "pause", "close"].includes(body.type)) return jsonError("Unsupported browser action.", 400, "INVALID_ACTION");
    const result = await performBrowserAction(sessionId, body);
    return jsonOk(result);
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Browser action failed."); }
}
