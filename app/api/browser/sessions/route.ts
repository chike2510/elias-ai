import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createTaskRecord } from "@/lib/taskOrchestrator";
import { updateStoredTask } from "@/lib/taskStore";
import { createBrowserSession } from "@/lib/browser/browserManager";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const identity = await getSession();
    if (!identity) return jsonError("Sign in to Elias before starting a browser session.", 401, "AUTH_REQUIRED");
    const body = await readJsonRequest<{ prompt?: unknown; url?: unknown }>(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 12000) : "Research this public page and verify the important claims.";
    const url = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : undefined;
    if (url && !/^https?:\/\//i.test(url)) return jsonError("Only public HTTP(S) URLs are supported.", 400, "INVALID_URL");
    const task = await createTaskRecord({ objective: prompt, kind: "research", taskType: "research" });
    const session = await createBrowserSession(task.id, url, identity.userId);
    const linkedTask = await updateStoredTask(task.id, (current) => { current.browserSessionId = session.id; });
    return jsonOk({ session, task: linkedTask }, { status: 201 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not create browser session."); }
}
