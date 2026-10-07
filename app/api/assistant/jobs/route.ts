import { after, NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { createJob, kickJobs, listJobs } from "@/lib/assistant/jobs";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try { return jsonOk({ jobs: await listJobs(auth.userId) }); }
  catch (error) { return jsonError(reportError(error, "assistant/jobs", auth.userId)); }
}

/** POST { prompt, title?, kind?: research|task, conversationId?, timezone? } hands a job to the background. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ prompt?: string; title?: string; kind?: string; conversationId?: string; timezone?: string }>(request);
    const job = await createJob(auth.userId, { prompt: String(body.prompt || ""), title: body.title, kind: body.kind, conversationId: body.conversationId, timezone: body.timezone, announce: true });
    after(() => kickJobs(job.id).then(() => undefined));
    return jsonOk({ job }, { status: 201 });
  } catch (error) { return jsonError(reportError(error, "assistant/jobs:create", auth.userId), 400, "JOB_FAILED"); }
}
