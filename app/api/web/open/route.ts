import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { rateLimitResponse, takeRateLimit } from "@/lib/rateLimit";
import { fetchUrl } from "@/lib/webSearch";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to open web sources.", 401, "UNAUTHORIZED");
    const limit = takeRateLimit("web-open", `user:${session.userId}`, 30, 60_000);
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
    const body = await readJsonRequest<{ url?: unknown }>(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return jsonError("url is required", 400, "INVALID_REQUEST");
    return jsonOk({ url, content: await fetchUrl(url) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "URL fetch failed.", 400, "INVALID_REQUEST");
  }
}
