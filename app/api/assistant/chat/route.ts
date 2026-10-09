import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { runTurn, type TurnEvent } from "@/lib/assistant/agent";
import { ensureDailyBrief } from "@/lib/assistant/brief";
import { sanitizeAttachments } from "@/lib/assistant/modelRouter";
import { getModelChoice } from "@/lib/assistant/models";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { text?: string; conversationId?: string; timezone?: string; stream?: boolean; attachments?: unknown; model?: string; replyTo?: string };

/**
 * POST { text, conversationId?, timezone?, stream?, attachments?, model? }.
 * attachments: images as downscaled data URLs ({ kind: "image", dataUrl, thumb }) and documents already
 * extracted by /api/assistant/attachments ({ kind: "file", name, text }). model: "auto" | "fast" | "strong" |
 * "<provider>/<model>"; when absent the user's saved choice is used. replyTo: text of an earlier message being replied to.
 * With stream:true (or Accept: text/event-stream) the reply streams as Server-Sent Events:
 * conversation, status, tool_done, card, connect, approval, memory, delta, reset, done, error.
 * Without it, the finished turn comes back as JSON (the non-streaming fallback).
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  let body: Body;
  try { body = await readJsonRequest<Body>(request); } catch (error) { return jsonError(String((error as Error).message), 400, "BAD_REQUEST"); }
  const { attachments, error: attachmentError } = sanitizeAttachments(body.attachments);
  if (attachmentError) return jsonError(attachmentError, 400, "BAD_ATTACHMENT");
  const text = (body.text || "").trim() || (attachments.length ? (attachments.some((item) => item.kind === "image") ? "What's in this?" : "Have a look at this.") : "");
  if (!text) return jsonError("Message is empty.", 400, "BAD_REQUEST");
  void ensureDailyBrief(auth.userId, body.timezone).catch(() => undefined);
  const modelChoice = typeof body.model === "string" && body.model ? body.model : await getModelChoice(auth.userId).catch(() => "auto");
  const turn = (onEvent?: (event: TurnEvent) => void) => runTurn({ userId: auth.userId, userName: auth.userName, conversationId: body.conversationId, text: text.slice(0, 12_000), timezone: body.timezone, githubToken: auth.githubToken, onEvent, attachments, modelChoice, replyTo: typeof body.replyTo === "string" ? body.replyTo : undefined });

  const wantsStream = body.stream === true || (request.headers.get("accept") || "").includes("text/event-stream");
  if (!wantsStream) {
    try { return jsonOk(await turn()); }
    catch (error) { return jsonError(reportError(error, "assistant/chat", auth.userId), 500, "ASSISTANT_FAILED"); }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: TurnEvent | { type: "ping" }) => { if (open) { try { controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); } catch { open = false; } } };
      const ping = setInterval(() => send({ type: "ping" }), 15_000);
      try { await turn(send); }
      catch (error) { send({ type: "error", message: reportError(error, "assistant/chat:stream", auth.userId) }); }
      finally { clearInterval(ping); open = false; try { controller.close(); } catch { /* already closed */ } }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
