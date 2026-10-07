import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { cancelJob, getJob } from "@/lib/assistant/jobs";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const job = await getJob(auth.userId, id);
    return job ? jsonOk({ job }) : jsonError("Job not found.", 404, "NOT_FOUND");
  } catch (error) { return jsonError(reportError(error, "assistant/jobs/id", auth.userId)); }
}

/** DELETE cancels the job (it stops before its next slice; a slice in flight is discarded). */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const job = await cancelJob(auth.userId, id);
    return job ? jsonOk({ job }) : jsonError("That job has already finished.", 409, "NOT_ACTIVE");
  } catch (error) { return jsonError(reportError(error, "assistant/jobs/id:cancel", auth.userId)); }
}
