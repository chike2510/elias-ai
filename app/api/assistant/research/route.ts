import { after, NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { createJob, kickJobs, listJobs } from "@/lib/assistant/jobs";
import { researchPrompt } from "@/lib/research";

export const runtime = "nodejs";

/** GET: the user's research reports (research background jobs), active first. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  try {
    const jobs = (await listJobs(auth.userId, 60)).filter((job) => job.kind === "research").slice(0, 30);
    return jsonOk({ reports: jobs });
  } catch (error) { return jsonError(reportError(error, "assistant/research", auth.userId)); }
}

/** POST { question, timezone? }: starts a research background job that ends in a cited report. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ question?: string; timezone?: string }>(request);
    const question = String(body.question || "").replace(/\s+/g, " ").trim();
    if (question.length < 4) return jsonError("Tell me what to research.", 400, "BAD_REQUEST");
    const job = await createJob(auth.userId, { title: question, prompt: researchPrompt(question), kind: "research", timezone: body.timezone, announce: true });
    after(() => kickJobs(job.id).then(() => undefined));
    return jsonOk({ report: job }, { status: 201 });
  } catch (error) { return jsonError(reportError(error, "assistant/research:create", auth.userId), 400, "RESEARCH_FAILED"); }
}
