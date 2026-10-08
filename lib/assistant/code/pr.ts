/**
 * Pull requests for the coding agent. Both tools wait for the user's approval:
 * code_open_pr opens a PR from this chat's elias/ branch to its base, and code_merge_pr squash-merges it,
 * refusing while CI is red or still running (checked when asking and again right before merging).
 */
import { gh, GithubError, openSet, type CodeTool, type CodeToolContext, type Session } from "./github";

type CheckRun = { name: string; status: string; conclusion: string | null; html_url?: string };
type ActionsRun = { name?: string; status: string; conclusion: string | null; html_url: string; head_sha: string };

const str = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const GOOD = new Set(["success", "skipped", "neutral"]);

/** CI state of a commit from check runs (falls back to Actions runs). */
export async function ciState(session: Session, sha: string): Promise<{ state: "green" | "red" | "pending" | "none"; failing: string[]; pending: string[]; url?: string }> {
  let checks: Array<{ name: string; status: string; conclusion: string | null; url?: string }> = [];
  try {
    const data = await gh<{ check_runs: CheckRun[] }>(session.token, "GET", `/repos/${session.set.repo}/commits/${sha}/check-runs?per_page=50`);
    checks = (data.check_runs || []).map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url }));
  } catch { /* fall back to Actions */ }
  if (!checks.length) {
    const data = await gh<{ workflow_runs: ActionsRun[] }>(session.token, "GET", `/repos/${session.set.repo}/actions/runs?head_sha=${sha}&per_page=20`).catch(() => ({ workflow_runs: [] as ActionsRun[] }));
    checks = (data.workflow_runs || []).filter((run) => run.head_sha === sha).map((run) => ({ name: run.name || "CI", status: run.status, conclusion: run.conclusion, url: run.html_url }));
  }
  if (!checks.length) return { state: "none", failing: [], pending: [] };
  const failing = checks.filter((run) => run.status === "completed" && !GOOD.has(run.conclusion || "")).map((run) => run.name);
  const pending = checks.filter((run) => run.status !== "completed").map((run) => run.name);
  return { state: failing.length ? "red" : pending.length ? "pending" : "green", failing, pending, url: checks.find((run) => failing.includes(run.name))?.url || checks[0].url };
}

function prBody(session: Session, extra: string) {
  const { set } = session;
  const lines = [extra.trim(), "", "**Commits**", ...set.commits.map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.message}`)];
  if (set.verify) lines.push("", `**CI:** ${set.verify.status}${set.verify.previewUrl ? ` · [preview](${set.verify.previewUrl})` : ""}`);
  lines.push("", "_Opened by Elias._");
  return lines.join("\n").trim();
}

async function prNumberFor(session: Session, args: Record<string, unknown>) {
  const number = Number(args.number) || session.set.prNumber;
  if (!number) throw new Error("No PR for this chat yet. Open one with code_open_pr, or pass number.");
  return number;
}

async function mergeGate(ctx: CodeToolContext, args: Record<string, unknown>) {
  const session = await openSet(ctx, str(args.repo) || undefined);
  const number = await prNumberFor(session, args);
  const pull = await gh<{ number: number; title: string; state: string; merged?: boolean; html_url: string; head: { ref: string; sha: string }; base: { ref: string }; mergeable?: boolean | null; mergeable_state?: string }>(session.token, "GET", `/repos/${session.set.repo}/pulls/${number}`);
  if (pull.merged) throw new Error(`PR #${number} is already merged.`);
  if (pull.state !== "open") throw new Error(`PR #${number} is ${pull.state}.`);
  const ci = await ciState(session, pull.head.sha);
  if (ci.state === "red") throw new Error(`Refusing to merge PR #${number}: CI is red (${ci.failing.join(", ")}). Fix it first (code_verify shows the failure).`);
  if (ci.state === "pending") throw new Error(`Not merging PR #${number} yet: CI is still running (${ci.pending.join(", ")}). Check again with code_verify.`);
  if (pull.mergeable === false || pull.mergeable_state === "dirty") throw new Error(`PR #${number} has merge conflicts with ${pull.base.ref}; resolve them first.`);
  return { session, pull, ci };
}

export const PR_TOOLS: Record<string, CodeTool> = {
  code_open_pr: {
    schema: { name: "code_open_pr", description: "Open a pull request from this chat's elias/ branch into its base branch. Waits for the user's approval (they can edit the title and body).", parameters: { type: "object", properties: { repo: { type: "string", description: "owner/repo (optional)" }, title: { type: "string", description: "PR title" }, body: { type: "string", description: "What changed and why, how it was tested" }, draft: { type: "boolean" } }, required: ["title"] } },
    needsApproval: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const { set } = session;
      if (!set.branch || !set.commits.length) throw new Error("Nothing pushed yet: code_commit first.");
      if (Object.keys(set.files).length) throw new Error("There are uncommitted changes: code_commit them first so the PR includes them.");
      if (set.prNumber) throw new Error(`PR #${set.prNumber} is already open for this branch: https://github.com/${set.repo}/pull/${set.prNumber}`);
      const ci = set.verify && set.verify.sha === set.baseSha ? set.verify.status : "not checked";
      return `Open a pull request in ${set.repo}: ${set.branch} → ${set.baseBranch}\nTitle: ${str(args.title)}\nCommits: ${set.commits.length} · CI: ${ci}\n\n${str(args.body).slice(0, 1200)}`;
    },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const { set } = session;
      if (!set.branch || !set.commits.length) throw new Error("Nothing pushed yet: code_commit first.");
      const owner = set.repo.split("/")[0];
      let pull: { number: number; html_url: string };
      try {
        pull = await gh(session.token, "POST", `/repos/${set.repo}/pulls`, { title: str(args.title, set.commits[set.commits.length - 1].message), head: set.branch, base: set.baseBranch, body: prBody(session, str(args.body)), draft: Boolean(args.draft) });
      } catch (error) {
        if (!(error instanceof GithubError && error.status === 422 && /already exists/i.test(error.message))) throw error;
        const existing = await gh<Array<{ number: number; html_url: string }>>(session.token, "GET", `/repos/${set.repo}/pulls?head=${owner}:${encodeURIComponent(set.branch)}&state=open`);
        if (!existing[0]) throw error;
        pull = existing[0];
      }
      set.prNumber = pull.number;
      set.updatedAt = new Date().toISOString();
      await session.store.save(set);
      return { ok: true, number: pull.number, url: pull.html_url, branch: set.branch, base: set.baseBranch, next: "Share the link. Merging needs CI green and the user's approval (code_merge_pr)." };
    },
  },
  code_merge_pr: {
    schema: { name: "code_merge_pr", description: "Squash-merge this chat's PR (or `number`). Refused while CI is red or running; otherwise waits for the user's approval.", parameters: { type: "object", properties: { repo: { type: "string", description: "owner/repo (optional)" }, number: { type: "number", description: "PR number (default: this chat's PR)" } }, required: [] } },
    needsApproval: async (args, ctx) => {
      const { session, pull, ci } = await mergeGate(ctx, args);
      return `Squash-merge PR #${pull.number} "${pull.title}" into ${pull.base.ref} (${session.set.repo})\nCI: ${ci.state === "none" ? "no checks reported" : "green"}\n${pull.html_url}`;
    },
    run: async (args, ctx) => {
      if (!ctx.approved) throw new Error("Merging needs the user's approval.");
      const { session, pull } = await mergeGate(ctx, args); // re-check: CI may have changed since the card was shown
      const merged = await gh<{ sha: string; merged: boolean; message?: string }>(session.token, "PUT", `/repos/${session.set.repo}/pulls/${pull.number}/merge`, { merge_method: "squash", commit_title: `${pull.title} (#${pull.number})`, sha: pull.head.sha });
      if (!merged.merged) throw new Error(merged.message || "GitHub didn't merge it.");
      // Start fresh from the updated base for the next change in this chat.
      const { set } = session;
      if (!Number(args.number) || Number(args.number) === set.prNumber) {
        const head = await gh<{ commit: { sha: string } }>(session.token, "GET", `/repos/${set.repo}/branches/${encodeURIComponent(set.baseBranch).replace(/%2F/g, "/")}`);
        Object.assign(set, { baseSha: head.commit.sha, branch: null, branchCreated: false, commits: [], prNumber: null, verify: null, files: {}, updatedAt: new Date().toISOString() });
        await session.store.save(set);
      }
      return { ok: true, number: pull.number, mergedSha: merged.sha, base: pull.base.ref, url: pull.html_url };
    },
  },
};
