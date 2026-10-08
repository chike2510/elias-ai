import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { runTurn, type TurnEvent } from "@/lib/assistant/agent";
import { getModelChoice } from "@/lib/assistant/models";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { text?: string; conversationId?: string; timezone?: string; stream?: boolean; model?: string; repo?: string };

/**
 * Coding-agent chat. POST { text, conversationId?, repo?, timezone?, stream?, model? }.
 * Runs the turn in code mode (repo_/code_ tools, coding prompt, strong tier unless a specific model is chosen)
 * in a conversation of kind "code". `repo` (owner/repo) is passed to the model as the repo to open when the
 * chat has no working set yet. Streams Server-Sent Events like /api/assistant/chat.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  let body: Body;
  try { body = await readJsonRequest<Body>(request); } catch (error) { return jsonError(String((error as Error).message), 400, "BAD_REQUEST"); }
  const text = (body.text || "").trim();
  if (!text) return jsonError("Message is empty.", 400, "BAD_REQUEST");
  const repo = typeof body.repo === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repo.trim()) ? body.repo.trim() : "";
  const saved = await getModelChoice(auth.userId).catch(() => "auto");
  const modelChoice = typeof body.model === "string" && body.model ? body.model : saved;
  const turn = (onEvent?: (event: TurnEvent) => void) => runTurn({
    userId: auth.userId, userName: auth.userName, conversationId: body.conversationId, text: text.slice(0, 12_000), timezone: body.timezone,
    githubToken: auth.githubToken, onEvent, modelChoice, mode: "code", title: repo ? `${repo.split("/")[1]}: ${text}` : text,
    extraContext: repo ? `The user picked ${repo} in the repo picker: use it as the repo unless they say otherwise.` : undefined,
  });

  const wantsStream = body.stream === true || (request.headers.get("accept") || "").includes("text/event-stream");
  if (!wantsStream) {
    try { return jsonOk(await turn()); }
    catch (error) { return jsonError(reportError(error, "code/chat", auth.userId), 500, "CODE_FAILED"); }
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: TurnEvent | { type: "ping" }) => { if (open) { try { controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); } catch { open = false; } } };
      const ping = setInterval(() => send({ type: "ping" }), 15_000);
      try { await turn(send); }
      catch (error) { send({ type: "error", message: reportError(error, "code/chat:stream", auth.userId) }); }
      finally { clearInterval(ping); open = false; try { controller.close(); } catch { /* already closed */ } }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
