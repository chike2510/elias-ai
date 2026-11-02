import { timingSafeEqual } from "node:crypto";
import { launchBrowser } from "@/lib/assistant/browser";
import { driveRun } from "@/lib/browserRun/core";
import { handleStep } from "@/lib/browserRun/decide";
import { pageDriver, prepare, type MinimalPage } from "@/lib/browserRun/driver";
import { getRun, TERMINAL, updateRun, type BrowserRun } from "@/lib/browserRun/store";

/**
 * Starts and stops runners. With ELIAS_BROWSER_WORKER_URL + ELIAS_WORKER_SECRET the Cloudflare Worker drives the browser
 * (no time limit). Without them a Node runner drives it inside the request's after() budget, enough for short jobs.
 */

export function workerConfigured() {
  return Boolean(process.env.ELIAS_BROWSER_WORKER_URL && process.env.ELIAS_WORKER_SECRET);
}

/** Checks the Worker's Bearer secret in constant time. */
export function workerAuthorized(request: Request) {
  const secret = process.env.ELIAS_WORKER_SECRET;
  const header = request.headers.get("authorization") || "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function callWorker(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.ELIAS_BROWSER_WORKER_URL!.replace(/\/$/, "")}${path}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ELIAS_WORKER_SECRET}` }, body: JSON.stringify(body), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Browser worker ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export async function startWorkerRun(run: BrowserRun, appUrl: string) {
  await callWorker(`/runs/${encodeURIComponent(run.id)}/start`, { startUrl: run.startUrl, stepUrl: `${appUrl.replace(/\/$/, "")}/api/browser/runs/${encodeURIComponent(run.id)}/step` });
}

export async function stopWorkerRun(runId: string) {
  if (workerConfigured()) await callWorker(`/runs/${encodeURIComponent(runId)}/stop`, {}).catch(() => undefined);
}

/** Node runner: same loop as the Worker, bounded by the function's remaining time. */
export async function runInNode(runId: string, budgetMs = 270_000) {
  const run = await getRun(runId);
  if (!run || TERMINAL.includes(run.status)) return;
  const deadline = Date.now() + budgetMs;
  let handle: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    handle = await launchBrowser(run.userId, null);
    const page = handle.page as unknown as MinimalPage;
    await prepare(page, run.startUrl);
    const result = await driveRun(pageDriver(page), (input) => handleStep(runId, input), { deadline });
    const after = await getRun(runId);
    if (after && !TERMINAL.includes(after.status)) await updateRun(runId, { status: "failed", statusText: "Stopped", pending: null, error: `${result.reason} Long jobs need the browser Worker (ELIAS_BROWSER_WORKER_URL).` });
  } catch (error) {
    await updateRun(runId, { status: "failed", statusText: "Stopped", pending: null, error: error instanceof Error ? error.message.slice(0, 400) : String(error) });
  } finally {
    await handle?.browser.close().catch(() => undefined);
  }
}
