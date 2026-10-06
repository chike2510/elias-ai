import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { decideApproval } from "@/lib/assistant/agent";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

/** POST { decision: approve|decline, edits?: { to, cc, subject, body } | { summary, start, end, location, attendees } } */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ decision?: string; timezone?: string; edits?: Record<string, unknown> }>(request);
    if (body.decision !== "approve" && body.decision !== "decline") return jsonError("decision must be approve or decline.", 400, "BAD_REQUEST");
    return jsonOk(await decideApproval({ userId: auth.userId, userName: auth.userName, approvalId: id, decision: body.decision, timezone: body.timezone, githubToken: auth.githubToken, edits: body.edits && typeof body.edits === "object" ? body.edits : undefined }));
  } catch (error) { return jsonError(reportError(error, "assistant/approvals/id", auth.userId), 400, "APPROVAL_FAILED"); }
}
