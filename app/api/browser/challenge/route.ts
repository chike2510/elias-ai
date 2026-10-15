import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { requireUser } from "@/lib/assistant/session";
import { answerChallenge, challengeStatus, type ChallengeAction } from "@/lib/assistant/challenge";

export const runtime = "nodejs";

const ACTIONS: ChallengeAction[] = ["approved", "resend", "code", "cancel"];

/** The sign-in challenge card's buttons. The code is never echoed back or logged. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "approve");
  if ("error" in auth) return auth.error;
  try {
    const body = await readJsonRequest<{ id?: string; action?: string; code?: string }>(request);
    const action = ACTIONS.find((item) => item === body.action);
    if (!body.id || !action) return jsonError("Pass id and a valid action.", 400);
    return jsonOk(await answerChallenge(auth.userId, body.id, action, body.code));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn't send that.", 400);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("Pass id.", 400);
  try { return jsonOk(await challengeStatus(auth.userId, id)); }
  catch { return jsonError("Couldn't read the sign-in step.", 400); }
}
