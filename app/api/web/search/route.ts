import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { searchWeb } from "@/lib/webSearch";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRequest<{ query?: unknown }>(request);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return jsonError("query is required", 400, "INVALID_REQUEST");
    if (query.length > 300) return jsonError("query is too long", 413, "PAYLOAD_TOO_LARGE");
    return jsonOk({ results: await searchWeb(query) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Search failed.");
  }
}
