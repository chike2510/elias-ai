import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createTaskRecord } from "@/lib/taskOrchestrator";
import { createBrowserSession } from "@/lib/browser/browserManager";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRequest<{ prompt?: unknown; url?: unknown }>(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 12000) : "Research this public page and verify the important claims.";
    const url = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : undefined;
    if (url && !/^https?:\/\//i.test(url)) return jsonError("Only public HTTP(S) URLs are supported.", 400, "INVALID_URL");
    const task = await createTaskRecord({ objective: prompt, kind: "research", taskType: "research" });
    const session = createBrowserSession(task.id, url);
    return jsonOk({ session, task }, { status: 201 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not create browser session."); }
}
