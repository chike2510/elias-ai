import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { fetchUrl } from "@/lib/webSearch";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRequest<{ url?: unknown }>(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return jsonError("url is required", 400, "INVALID_REQUEST");
    return jsonOk({ url, content: await fetchUrl(url) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "URL fetch failed.");
  }
}
