import { NextRequest } from "next/server";
import { requireUser } from "@/lib/assistant/session";
import { getRun, latestStep, TERMINAL } from "@/lib/browserRun/store";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * The live card watches a run here over SSE: one `run` event whenever the status changes, carrying the newest JPEG frame
 * when there is a new step. Closes when the run ends, or after ~4.5 minutes (EventSource reconnects by itself).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const first = await getRun(id, auth.userId);
  if (!first) return new Response("Not found", { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastSig = "";
      let lastFrameStep = -1;
      const until = Date.now() + 270_000;
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        while (!request.signal.aborted && Date.now() < until) {
          const run = await getRun(id, auth.userId);
          if (!run) break;
          const sig = `${run.updatedAt}|${run.status}|${run.step}`;
          if (sig !== lastSig) {
            lastSig = sig;
            const step = await latestStep(id, true);
            const fresh = step && step.step !== lastFrameStep;
            if (fresh) lastFrameStep = step.step;
            send("run", {
              id: run.id, status: run.status, statusText: run.statusText, step: run.step, maxSteps: run.maxSteps,
              url: step?.url || run.startUrl, title: step?.title || "", click: step?.click || null,
              frame: fresh && step?.frame ? `data:image/jpeg;base64,${step.frame}` : undefined,
              pending: run.pending ? (run.pending.type === "approval" ? { type: "approval", summary: run.pending.summary } : { type: "input", kind: run.pending.kind, question: run.pending.question }) : null,
              answered: Boolean(run.resolution), summary: run.summary, error: run.error,
            });
            if (TERMINAL.includes(run.status)) break;
          } else controller.enqueue(encoder.encode(": ping\n\n"));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch { /* the client reconnects */ }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
