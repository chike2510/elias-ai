import { NextRequest } from "next/server";
import { extensionTokenFromRequest } from "@/lib/extensionAuth";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createTaskRecord } from "@/lib/taskOrchestrator";
import { updateStoredTask } from "@/lib/taskStore";
import { createBrowserSession } from "@/lib/browser/browserManager";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const token = extensionTokenFromRequest(request);
    if (!token) return jsonError("Pair this extension with a signed-in Elias account first.", 401, "EXTENSION_AUTH_REQUIRED");
    const body = await readJsonRequest<{ prompt?: unknown; url?: unknown }>(request);
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim().slice(0, 12_000) : "Complete the requested browser task and report what changed.";
    const url = typeof body.url === "string" ? body.url.trim().slice(0, 2_000) : undefined;
    if (url && !/^https?:\/\//i.test(url)) return jsonError("Only HTTP(S) browser pages are supported.", 400, "INVALID_URL");
    const task = await createTaskRecord({ objective: prompt, kind: "research", taskType: "research" });
    const session = await createBrowserSession(task.id, url, token.sub);
    const linkedTask = await updateStoredTask(task.id, (current) => { current.browserSessionId = session.id; });
    return jsonOk({ session, task: linkedTask }, { status: 201 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not create a browser task."); }
}
