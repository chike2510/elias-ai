/**
 * The coding agent's verify loop: after code_commit pushes to an elias/* branch, code_verify waits for
 * the branch's CI run (dispatching the workflow when no run shows up), returns trimmed failure logs so
 * the agent can fix and re-commit, and finds the Vercel preview URL from GitHub deployment statuses.
 * At most MAX_ATTEMPTS failed runs per working set; then the agent stops and reports to the user.
 */
import { gh, openSet, type CodeTool, type CodeToolContext, type Session, type VerifyState } from "./github";

export const MAX_ATTEMPTS = 4;

type Run = { id: number; head_sha: string; head_branch: string; status: string; conclusion: string | null; html_url: string; event: string; name?: string; created_at?: string };
type Job = { id: number; name: string; conclusion: string | null; status: string; steps?: Array<{ name: string; conclusion: string | null; number: number }> };

let clock = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), now: () => Date.now() };
export function setVerifyClock(next: Partial<typeof clock> | null) {
  clock = next ? { ...clock, ...next } : { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), now: () => Date.now() };
}

/* ---------------- log trimming ---------------- */

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
const SIGNAL = /(error|Error|ERR!|FAIL|failed|✖|✗|×|not ok|AssertionError|TypeError|ReferenceError|SyntaxError|Cannot find|Expected|expected|Received|panic|Traceback|exit code [1-9]|Process completed with exit code)/;
const NOISE = /^(##\[group\]|##\[endgroup\]|\s*at (?:node:|async |process\.|Module\.|Object\.<anonymous> \(node:)|npm notice|\s*$)/;

/**
 * Keeps what a developer would look at: lines that signal an error plus a little context around
 * each, without ANSI codes, timestamps, group markers or node-internal stack frames. Bounded to `max` chars,
 * favouring the end of the log (where the failing step is) when it must cut.
 */
export function trimLog(raw: string, max = 3500, context = 2) {
  const lines = raw.replace(/\r/g, "").split("\n").map((line) => line.replace(ANSI, "").replace(STAMP, "").replace(/^##\[error\]/, "ERROR: ").trimEnd());
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (!SIGNAL.test(line) || NOISE.test(line)) return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep.add(k);
  });
  let picked: string[];
  if (!keep.size) picked = lines.filter((line) => !NOISE.test(line)).slice(-40);
  else {
    picked = [];
    let last = -2;
    for (const index of [...keep].sort((a, b) => a - b)) {
      if (NOISE.test(lines[index])) continue;
      if (index > last + 1 && picked.length) picked.push("…");
      picked.push(lines[index].slice(0, 300));
      last = index;
    }
  }
  // Collapse consecutive duplicates (retries, repeated stack lines).
  picked = picked.filter((line, index) => line !== picked[index - 1]);
  let text = picked.join("\n");
  if (text.length > max) text = `…(trimmed)\n${text.slice(text.length - max)}`;
  return text;
}

/* ---------------- GitHub reads ---------------- */

async function runsFor(session: Session, branch: string, sha: string) {
  const data = await gh<{ workflow_runs: Run[] }>(session.token, "GET", `/repos/${session.set.repo}/actions/runs?branch=${encodeURIComponent(branch)}&head_sha=${sha}&per_page=20`);
  return (data.workflow_runs || []).filter((run) => run.head_sha === sha);
}

/** Vercel (and other providers) report preview deploys as GitHub deployment statuses. */
export async function previewUrl(session: Session, sha: string): Promise<string | undefined> {
  try {
    const deployments = await gh<Array<{ id: number; environment?: string }>>(session.token, "GET", `/repos/${session.set.repo}/deployments?sha=${sha}&per_page=10`);
    for (const deployment of deployments || []) {
      if (/production/i.test(deployment.environment || "") && deployments.length > 1) continue;
      const statuses = await gh<Array<{ state: string; environment_url?: string; target_url?: string }>>(session.token, "GET", `/repos/${session.set.repo}/deployments/${deployment.id}/statuses?per_page=10`);
      const ok = (statuses || []).find((status) => status.state === "success" && (status.environment_url || status.target_url));
      if (ok) return ok.environment_url || ok.target_url;
    }
  } catch { /* no deployments access: not fatal */ }
  return undefined;
}

async function failureDetails(session: Session, runs: Run[]) {
  const failures: string[] = [];
  let budget = 6000;
  for (const run of runs.filter((item) => item.conclusion && !["success", "skipped", "neutral"].includes(item.conclusion))) {
    const jobs = await gh<{ jobs: Job[] }>(session.token, "GET", `/repos/${session.set.repo}/actions/runs/${run.id}/jobs?per_page=30`).catch(() => ({ jobs: [] as Job[] }));
    for (const job of jobs.jobs.filter((item) => item.conclusion === "failure" || item.conclusion === "timed_out")) {
      const steps = (job.steps || []).filter((step) => step.conclusion === "failure").map((step) => step.name);
      let log = "";
      try { log = await gh<string>(session.token, "GET", `/repos/${session.set.repo}/actions/jobs/${job.id}/logs`, undefined, "application/vnd.github.raw"); } catch (error) { log = `(log unavailable: ${error instanceof Error ? error.message : String(error)})`; }
      const trimmed = trimLog(log, Math.max(600, Math.min(3500, budget)));
      budget -= trimmed.length;
      failures.push(`${run.name || "CI"} › ${job.name}${steps.length ? ` › ${steps.join(", ")}` : ""}\n${trimmed}`);
      if (budget <= 0) return failures;
    }
  }
  return failures;
}

/* ---------------- the loop step ---------------- */

export type VerifyResult = VerifyState & { maxAttempts: number; next: string; runs?: Array<{ name?: string; conclusion: string | null; url: string }> };

/**
 * Checks CI for the working set's latest commit. Waits up to `waitMs` for runs to finish (dispatching
 * the workflow once if none appear). Failed results count toward MAX_ATTEMPTS once per commit.
 */
export async function verifySession(session: Session, options: { waitMs?: number; pollMs?: number; workflow?: string } = {}): Promise<VerifyResult> {
  const { set } = session;
  if (!set.branch || !set.commits.length) throw new Error("Nothing pushed yet: code_commit the changes first, then verify.");
  if (Object.keys(set.files).length) throw new Error(`There are ${Object.keys(set.files).length} uncommitted change(s). code_commit them first so CI tests what you changed.`);
  const sha = set.baseSha;
  const branch = set.branch;
  const waitMs = options.waitMs ?? Number(process.env.ELIAS_VERIFY_WAIT_MS || 150_000);
  const pollMs = options.pollMs ?? 5_000;
  const previous = set.verify && set.verify.sha === sha ? set.verify : null;
  const priorAttempts = set.verify ? set.verify.attempt : 0;
  if (priorAttempts >= MAX_ATTEMPTS && (!previous || previous.status === "failed")) {
    return { ...(set.verify as VerifyState), maxAttempts: MAX_ATTEMPTS, next: `CI has failed ${MAX_ATTEMPTS} times. Stop editing and tell the user what is still failing and what you tried; ask how they want to proceed.` };
  }
  const deadline = clock.now() + waitMs;
  let runs = await runsFor(session, branch, sha);
  let dispatched = false;
  while (clock.now() < deadline && (!runs.length || runs.some((run) => run.status !== "completed"))) {
    if (!runs.length && !dispatched && clock.now() > deadline - waitMs + 20_000) {
      // Push events usually start CI within seconds; if nothing shows up, dispatch the workflow on the branch.
      dispatched = await gh(session.token, "POST", `/repos/${set.repo}/actions/workflows/${options.workflow || process.env.ELIAS_CI_WORKFLOW || "ci.yml"}/dispatches`, { ref: branch }).then(() => true, () => true);
    }
    await clock.sleep(pollMs);
    runs = await runsFor(session, branch, sha);
  }
  const preview = await previewUrl(session, sha);
  const at = new Date(clock.now()).toISOString();
  const runList = runs.map((run) => ({ name: run.name, conclusion: run.conclusion, url: run.html_url }));
  let state: VerifyState;
  let next: string;
  if (!runs.length) {
    state = { status: "error", attempt: priorAttempts, sha, summary: "No CI run started for this commit.", previewUrl: preview, at };
    next = "No CI ran. Check the repo has a workflow that runs on push to elias/** or workflow_dispatch; tell the user if it doesn't.";
  } else if (runs.some((run) => run.status !== "completed")) {
    state = { status: "running", attempt: priorAttempts, sha, summary: "CI is still running.", runUrl: runs[0].html_url, previewUrl: preview, at };
    next = "CI is still running. Call code_verify again in a moment (it doesn't count as an attempt).";
  } else if (runs.every((run) => run.conclusion === "success" || run.conclusion === "skipped" || run.conclusion === "neutral")) {
    state = { status: "passed", attempt: 0, sha, summary: `CI passed (${runs.length} run${runs.length === 1 ? "" : "s"}).`, runUrl: runs[0].html_url, previewUrl: preview, at };
    next = preview ? "Green. Share the preview link, then offer to open a PR (code_open_pr)." : "Green. Offer to open a PR (code_open_pr).";
  } else {
    const attempt = previous?.status === "failed" ? previous.attempt : priorAttempts + 1;
    const failures = await failureDetails(session, runs);
    state = { status: "failed", attempt, sha, summary: `CI failed (attempt ${attempt} of ${MAX_ATTEMPTS}).`, runUrl: runs.find((run) => run.conclusion !== "success")?.html_url, previewUrl: preview, failures, at };
    next = attempt >= MAX_ATTEMPTS
      ? `That was attempt ${MAX_ATTEMPTS} of ${MAX_ATTEMPTS}. Stop editing and tell the user what still fails and what you tried.`
      : "Read the failure, repo_read the files involved, fix with code_edit/code_patch, code_commit, then code_verify again.";
  }
  set.verify = state;
  set.updatedAt = at;
  await session.store.save(set);
  return { ...state, maxAttempts: MAX_ATTEMPTS, next, runs: runList };
}

export const VERIFY_TOOLS: Record<string, CodeTool> = {
  code_verify: {
    schema: { name: "code_verify", description: `Check CI for this chat's latest pushed commit: waits for the run, returns pass/fail with trimmed failure logs and the Vercel preview URL. Fix and re-verify on failure, at most ${MAX_ATTEMPTS} failed attempts.`, parameters: { type: "object", properties: { repo: { type: "string", description: "owner/repo (optional)" } }, required: [] } },
    run: async (args, ctx: CodeToolContext) => verifySession(await openSet(ctx, typeof args.repo === "string" && args.repo ? args.repo : undefined)),
  },
};
