"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, GitPullRequest, LoaderCircle, LockKeyhole } from "lucide-react";
import type { TaskRecord } from "@/lib/task";
import { repositoryTaskChanges, summarizeRepositoryValidations } from "@/lib/githubRepositoryTask";

type WriteAction = "commit_files" | "create_pull_request";
type Props = { task: TaskRecord };

export default function RepositoryTaskChanges({ task }: Props) {
  const repository = task.repository;
  const changes = useMemo(() => repositoryTaskChanges({ workspace: task.workspace, checkpoints: task.checkpoints }), [task.workspace, task.checkpoints]);
  const suggestedBranch = `elias/task-${task.id.replace(/^task_/, "").slice(0, 12)}`;
  const [branch, setBranch] = useState(suggestedBranch);
  const [commitMessage, setCommitMessage] = useState(`ELIAS: ${task.title}`.slice(0, 120));
  const [committedBranch, setCommittedBranch] = useState("");
  const [prTitle, setPrTitle] = useState(`ELIAS: ${task.title}`.slice(0, 250));
  const [prBody, setPrBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pullUrl, setPullUrl] = useState("");
  if (!repository) return null;

  const fileCount = changes.length;
  const combinedSize = changes.reduce((sum, item) => sum + (item.status === "deleted" ? 0 : item.content.length), 0);
  const canCommit = task.status === "completed" && fileCount > 0 && fileCount <= 50 && combinedSize <= 5_000_000;
  const validations = task.toolResults.filter((result) => result.type === "run_validation");

  async function propose(action: WriteAction, payload: Record<string, unknown>, confirmation: string) {
    const preparedResponse = await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, action, phase: "prepare" }) });
    const prepared = await preparedResponse.json() as { proposalId?: string; expiresAt?: number; message?: string };
    if (!preparedResponse.ok || !prepared.proposalId) throw new Error(prepared.message || "Could not prepare the GitHub write proposal.");
    const remaining = Math.max(1, Math.ceil(((prepared.expiresAt || Date.now()) - Date.now()) / 60_000));
    if (!window.confirm(`${confirmation}\n\nThis will change ${repository!.fullName} on GitHub. The short-lived approval is bound to the exact submitted files and fields and expires in ${remaining} minute(s).`)) return null;
    const response = await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, action, phase: "execute", proposalId: prepared.proposalId, confirm: `CONFIRM_GITHUB_${action.toUpperCase()}` }) });
    const result = await response.json() as { message?: string; url?: string; branch?: string; commitSha?: string };
    if (!response.ok) throw new Error(result.message || "GitHub did not accept the approved proposal.");
    return result;
  }

  async function commitChanges() {
    if (!repository || !canCommit || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = {
        owner: repository.owner,
        repo: repository.repo,
        branch: branch.trim(),
        base: repository.branch,
        baseSha: repository.commitSha,
        message: commitMessage.trim(),
        files: changes.map((change) => change.status === "deleted" ? { path: change.path, delete: true } : { path: change.path, content: change.content }),
      };
      const result = await propose("commit_files", payload, `Create a new branch “${payload.branch}” from “${payload.base}” at commit ${repository.commitSha}.\n\nCommit message:\n${payload.message}\n\nExact repository changes (${changes.length}):\n${changes.map((item) => `• ${item.status}: ${item.path}`).join("\n")}\n\nReview the before/after text shown above before approving.`);
      if (!result) { setNotice("GitHub commit was not approved. No repository change was made."); return; }
      setCommittedBranch(payload.branch);
      setNotice(result.message || `Changes committed to ${payload.branch}.`);
      setPrBody(`Task: ${task.objective}\n\nRepository snapshot: ${repository.fullName}@${repository.commitSha}\n\nChanged files:\n${changes.map((item) => `- ${item.status}: ${item.path}`).join("\n")}\n\nValidation status:\n${summarizeRepositoryValidations(validations)}\n\nCreated by ELIAS. Please review the diff and checks before merging.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "GitHub commit failed."); }
    finally { setBusy(false); }
  }

  async function openPullRequest() {
    if (!repository || !committedBranch || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = { owner: repository.owner, repo: repository.repo, head: committedBranch, base: repository.branch, title: prTitle.trim(), body: prBody.trim() };
      const result = await propose("create_pull_request", payload, `Open a pull request in ${repository.fullName} from “${payload.head}” into “${payload.base}” with the exact title and body below:\n\nTITLE\n${payload.title}\n\nBODY\n${payload.body}`);
      if (!result) { setNotice("Pull request creation was not approved. The confirmed feature-branch commit remains available for review."); return; }
      setPullUrl(result.url || "");
      setNotice(result.message || "Pull request opened.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Pull request creation failed."); }
    finally { setBusy(false); }
  }

  return <section className="panel repo-task-changes" aria-labelledby="repo-task-changes-title">
    <div className="panel-head"><span><GitPullRequest size={16} /><strong id="repo-task-changes-title">Repository changes</strong></span><span>{repository.fullName} · {repository.branch}</span></div>
    <p className="connector-help">The task works in an isolated snapshot. Nothing is written to GitHub unless you approve the exact commit proposal below.</p>
    {!fileCount ? <p className="repo-task-empty">No repository files differ from the initial snapshot yet.</p> : <>
      <div className="repo-task-change-list">{changes.map((change) => <details className="repo-task-change" key={change.path}><summary><span className={`repo-change-state ${change.status}`}>{change.status}</span><code>{change.path}</code></summary><div className="repo-task-file-panes"><div><strong>Before</strong><pre>{change.before ?? "(file did not exist)"}</pre></div><div><strong>After</strong><pre>{change.status === "deleted" ? "(file will be deleted)" : change.content}</pre></div></div></details>)}</div>
      <small className="repo-task-change-summary">{fileCount} file change{fileCount === 1 ? "" : "s"} · {Math.ceil(combinedSize / 1024)} KB proposed · base branch {repository.branch}</small>
      {task.status === "completed" ? <>
        <div className="repo-task-publish-grid"><label>New branch<input value={branch} onChange={(event) => setBranch(event.target.value)} maxLength={100} /></label><label>Commit message<input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={200} /></label></div>
        {!canCommit ? <p className="connector-help">GitHub proposals support up to 50 changed files and 5 MB of text. Reduce the change set before committing.</p> : null}
        {!committedBranch ? <button type="button" className="primary repo-task-publish-button" disabled={!canCommit || busy || !branch.trim() || !commitMessage.trim()} onClick={() => void commitChanges()}>{busy ? <LoaderCircle className="spin" size={15} /> : <LockKeyhole size={15} />} {busy ? "Preparing approved commit…" : "Review & commit to a new branch"}</button> : <>
          <div className="repo-task-committed"><CheckCircle2 size={15} /> Committed to <code>{committedBranch}</code>. The base branch was not changed.</div>
          <label className="repo-task-pr-field">Pull request title<input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} maxLength={250} /></label>
          <label className="repo-task-pr-field">Pull request description<textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} rows={8} /></label>
          {!pullUrl ? <button type="button" className="primary repo-task-publish-button" disabled={busy || !prTitle.trim() || !prBody.trim()} onClick={() => void openPullRequest()}>{busy ? <LoaderCircle className="spin" size={15} /> : <GitPullRequest size={15} />} {busy ? "Preparing approved pull request…" : "Review & open pull request"}</button> : <a className="secondary repo-task-pr-link" href={pullUrl} target="_blank" rel="noreferrer">View pull request</a>}
        </>}
      </> : <p className="connector-help">Finish the task and review its results before preparing a GitHub write proposal.</p>}
    </>}
    {notice ? <p className="connector-success" role="status">{notice}</p> : null}
    {error ? <p className="connector-help upload-error" role="alert">{error}</p> : null}
  </section>;
}
