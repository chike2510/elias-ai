import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { rateLimitResponse, takeRateLimit } from "@/lib/rateLimit";
import { searchWeb } from "@/lib/webSearch";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to search the web.", 401, "UNAUTHORIZED");
    const limit = takeRateLimit("web-search", `user:${session.userId}`, 12, 60_000);
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
    const body = await readJsonRequest<{ query?: unknown }>(request);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return jsonError("query is required", 400, "INVALID_REQUEST");
    if (query.length > 300) return jsonError("query is too long", 413, "PAYLOAD_TOO_LARGE");
    return jsonOk({ results: await searchWeb(query) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Search failed.");
  }
}
