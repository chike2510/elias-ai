import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { errorMessage, requireUser } from "@/lib/assistant/session";
import { decideApproval } from "@/lib/assistant/agent";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    const body = await readJsonRequest<{ decision?: string; timezone?: string }>(request);
    if (body.decision !== "approve" && body.decision !== "decline") return jsonError("decision must be approve or decline.", 400, "BAD_REQUEST");
    return jsonOk(await decideApproval({ userId: auth.userId, userName: auth.userName, approvalId: id, decision: body.decision, timezone: body.timezone, githubToken: auth.githubToken }));
  } catch (error) { return jsonError(errorMessage(error), 400, "APPROVAL_FAILED"); }
}
