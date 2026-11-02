import { DurableObject } from "cloudflare:workers";
import { launch, type Browser } from "@cloudflare/playwright";
import { driveRun, type StepInput, type StepReply } from "../../../lib/browserRun/core";
import { pageDriver, prepare, type MinimalPage } from "../../../lib/browserRun/driver";

/**
 * Elias browser runner. Holds one Cloudflare Browser Run session per run inside a Durable Object, so sign-ins and form
 * state survive across steps and the loop can take minutes. It only drives the browser: every observation goes to
 * Elias (stepUrl, Bearer ELIAS_WORKER_SECRET), which decides the next action and applies the safety rails.
 */

type Env = { BROWSER: Fetcher; RUNS: DurableObjectNamespace<BrowserRun>; ELIAS_WORKER_SECRET: string };
type Job = { runId: string; startUrl: string; stepUrl: string };

// An alarm may run for 15 minutes of wall time; leave room to report back.
const RUN_BUDGET_MS = 14 * 60_000;

function authorized(request: Request, env: Env) {
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.ELIAS_WORKER_SECRET || ""}`;
  if (!env.ELIAS_WORKER_SECRET || header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export class BrowserRun extends DurableObject<Env> {
  private browser: Browser | null = null;
  private stopped = false;

  async fetch(request: Request) {
    const action = new URL(request.url).pathname.split("/").pop();
    if (action === "start") {
      const job = await request.json<Job>();
      if (!/^https?:\/\//.test(job.startUrl) || !/^https?:\/\//.test(job.stepUrl)) return Response.json({ error: "bad job" }, { status: 400 });
      if (await this.ctx.storage.get("job")) return Response.json({ ok: true, already: true });
      await this.ctx.storage.put("job", job);
      await this.ctx.storage.setAlarm(Date.now());
      return Response.json({ ok: true });
    }
    if (action === "stop") {
      this.stopped = true;
      await this.ctx.storage.put("stopped", true);
      await this.browser?.close().catch(() => undefined);
      this.browser = null;
      return Response.json({ ok: true });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async step(job: Job, input: StepInput): Promise<StepReply> {
    if (this.stopped || await this.ctx.storage.get("stopped")) return { kind: "stop", reason: "Stopped." };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(job.stepUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.env.ELIAS_WORKER_SECRET}` }, body: JSON.stringify(input) });
        if (response.status === 401) return { kind: "stop", reason: "Elias rejected the worker secret." };
        if (response.ok) return await response.json<StepReply>();
      } catch { /* retry */ }
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    return { kind: "stop", reason: "Couldn't reach Elias." };
  }

  async alarm() {
    const job = await this.ctx.storage.get<Job>("job");
    if (!job || await this.ctx.storage.get("ran")) return;
    // Never re-run a job from scratch on an alarm retry: a half-filled form must not be submitted twice.
    await this.ctx.storage.put("ran", true);
    let fatal = "";
    try {
      this.browser = await launch(this.env.BROWSER, { keep_alive: 600_000 });
      const page = await this.browser.newPage() as unknown as MinimalPage;
      await prepare(page, job.startUrl);
      const result = await driveRun(pageDriver(page), (input) => this.step(job, input), { deadline: Date.now() + RUN_BUDGET_MS });
      if (/time limit|call cap/i.test(result.reason)) fatal = result.reason;
    } catch (error) {
      fatal = this.stopped ? "" : error instanceof Error ? error.message.slice(0, 300) : String(error);
    } finally {
      await this.browser?.close().catch(() => undefined);
      this.browser = null;
    }
    if (fatal) await this.step(job, { fatal }).catch(() => undefined);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (request.method !== "POST" || !authorized(request, env)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const match = url.pathname.match(/^\/runs\/([A-Za-z0-9_-]{4,80})\/(start|stop)$/);
    if (!match) return Response.json({ error: "not found" }, { status: 404 });
    const stub = env.RUNS.get(env.RUNS.idFromName(match[1]));
    return stub.fetch(new Request(`https://run/${match[2]}`, { method: "POST", body: request.body, headers: { "content-type": "application/json" } }));
  },
} satisfies ExportedHandler<Env>;
