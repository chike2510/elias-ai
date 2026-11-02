import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { requireUser } from "@/lib/assistant/session";
import { resolveRun } from "@/lib/browserRun/store";
import { stopWorkerRun } from "@/lib/browserRun/runner";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** The live card's buttons: approve / deny a paused action, answer a question or code, or stop (kills the browser). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ action?: string; text?: string }>(request);
    if (body.action === "stop") {
      const run = await resolveRun(id, auth.userId, "stop");
      await stopWorkerRun(id);
      return jsonOk({ status: run?.status || "stopped" });
    }
    const resolution = body.action === "approve" ? { type: "approve" as const }
      : body.action === "deny" ? { type: "deny" as const }
      : body.action === "answer" && body.text?.trim() ? { type: "answer" as const, text: body.text.trim().slice(0, 500) }
      : null;
    if (!resolution) return jsonError("Pass action: approve, deny, answer (with text) or stop.", 400);
    const run = await resolveRun(id, auth.userId, resolution);
    if (!run) return jsonError("This run isn't waiting for you anymore.", 409);
    return jsonOk({ status: run.status });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn't send that.", 400);
  }
}
