import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { setMessageFeedback } from "@/lib/assistant/feedback";

export const runtime = "nodejs";

/** POST { messageId, rating: "up" | "down" | null, reason? }: thumbs on an assistant reply (signed-in owner only). */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  let body: { messageId?: unknown; rating?: unknown; reason?: unknown };
  try { body = await readJsonRequest(request); } catch (error) { return jsonError(String((error as Error).message), 400, "BAD_REQUEST"); }
  const messageId = Number(body.messageId);
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : body.rating === null ? null : "bad";
  if (!Number.isSafeInteger(messageId) || messageId <= 0 || rating === "bad") return jsonError("Send a messageId and a rating of up, down or null.", 400, "BAD_REQUEST");
  try {
    const feedback = await setMessageFeedback(auth.userId, messageId, rating, typeof body.reason === "string" ? body.reason : undefined);
    if (feedback === undefined) return jsonError("That message wasn't found.", 404, "NOT_FOUND");
    return jsonOk({ feedback });
  } catch (error) { return jsonError(reportError(error, "assistant/feedback", auth.userId)); }
}
