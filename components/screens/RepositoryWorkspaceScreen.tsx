"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowUpRight, BarChart3, CheckCircle2, GitCommitHorizontal, Github, GitPullRequest, LoaderCircle, LockKeyhole, MessageSquare, Plus, RefreshCw, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type Workspace = { repository: { fullName: string; name: string; description: string; private: boolean; url: string; defaultBranch: string; language: string; stars: number; openIssues: number }; commits: Array<{ sha: string; url: string; message: string; author: string; date?: string }> };
type Intelligence = { repository: string; branch: string; language: string; treeSize: number; sourceFiles: number; routeFiles: number; testFiles: number; truncated: boolean; files: Array<{ path: string; lines: number; chars: number }>; dependencies: string[]; findings: Array<{ id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; evidence: string[]; path?: string }>; generatedAt: string };
type WriteAction = "create_branch" | "commit_file" | "create_pull_request";

export default function RepositoryWorkspaceScreen({ owner, repo }: { owner: string; repo: string }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [writeAction, setWriteAction] = useState<WriteAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("main");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");

  useEffect(() => {
    void fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { cache: "no-store" })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.message || "Could not load repository."); setData(payload); setBase(payload.repository.defaultBranch || "main"); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load repository."));
  }, [owner, repo]);

  async function runCodeReview() {
    setReviewBusy(true); setReviewError("");
    try {
      const response = await fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/intelligence`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Could not analyze this repository.");
      setIntelligence(payload.intelligence);
    } catch (reason) { setReviewError(reason instanceof Error ? reason.message : "Could not analyze this repository."); }
    finally { setReviewBusy(false); }
  }

  function openAction(action: WriteAction) {
    setNotice(""); setError(""); setWriteAction(action);
    if (action === "create_branch") setBranch("");
    if (action === "commit_file") { setPath(""); setContent(""); setMessage(""); }
    if (action === "create_pull_request") { setBranch(""); setTitle(""); setBody(""); }
  }

  function prepareFinding(finding: Intelligence["findings"][number]) {
    openAction("create_branch");
    setBranch(`elias/review-${finding.id.slice(-12)}`);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!writeAction) return;
    const confirmation = `CONFIRM_GITHUB_${writeAction.toUpperCase()}`;
    const explanation = writeAction === "create_branch" ? `Create branch “${branch}” from “${base}”?` : writeAction === "commit_file" ? `Commit “${path}” to “${branch || base}”?` : `Open a pull request from “${branch}” into “${base}”?`;
    if (!window.confirm(`${explanation}\n\nThis is a real GitHub write action. Elias will use your connected GitHub token.`)) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const payload: Record<string, string> = { action: writeAction, owner, repo, confirm: confirmation };
      if (writeAction === "create_branch") Object.assign(payload, { branch, base });
      if (writeAction === "commit_file") Object.assign(payload, { branch: branch || base, path, content, message });
      if (writeAction === "create_pull_request") Object.assign(payload, { head: branch, base, title, body });
      const response = await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "GitHub action failed.");
      setNotice(result.message || "GitHub action completed."); setWriteAction(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "GitHub action failed."); }
    finally { setBusy(false); }
  }

  return <AppShell title={repo}><main className="screen repository-workspace-screen">
    <div className="mobile-screen-heading"><Link href="/connectors/github" aria-label="Back to GitHub"><ArrowLeft size={19} /></Link><h1>{repo}</h1><a className="icon-btn" href={`https://github.com/${owner}/${repo}`} target="_blank" rel="noreferrer" aria-label="Open on GitHub"><ArrowUpRight size={17} /></a></div>
    {error && !data ? <section className="panel repo-workspace-error"><Github size={22} /><strong>{error}</strong><Link className="secondary" href="/connectors/github">Back to GitHub repositories</Link></section> : !data ? <div className="repo-loading"><LoaderCircle className="spin" size={18} /> Loading Elias workspace…</div> : <>
      <section className="repo-workspace-hero"><span className="repo-workspace-icon"><Github size={27} /></span><div><p className="eyebrow">ELIAS / repository workspace</p><h2>{data.repository.fullName}</h2><p>{data.repository.description}</p></div><span className="repo-visibility">{data.repository.private ? <LockKeyhole size={12} /> : null}{data.repository.private ? "Private" : "Public"}</span></section>
      <div className="repo-metrics"><div><b>{data.repository.defaultBranch}</b><span>default branch</span></div><div><b>{data.repository.openIssues}</b><span>open issues</span></div><div><b>{data.repository.stars}</b><span>stars</span></div></div>
      <section className="workspace-actions"><button className="primary" onClick={() => window.location.href = `/chat?prompt=${encodeURIComponent(`Help me understand the GitHub repository ${data.repository.fullName}. Use its recent activity and connected repository context.`)}`}><Sparkles size={15} /> Ask Elias about this repo</button><button className="secondary" onClick={() => openAction("create_branch")}><Plus size={15} /> New branch</button><button className="secondary" onClick={() => openAction("commit_file")}><GitCommitHorizontal size={15} /> Commit file</button><button className="secondary" onClick={() => openAction("create_pull_request")}><GitPullRequest size={15} /> Open pull request</button><button className="secondary"><MessageSquare size={15} /> Issues</button><button className="secondary" onClick={() => void runCodeReview()} disabled={reviewBusy}>{reviewBusy ? <LoaderCircle className="spin" size={15} /> : <BarChart3 size={15} />} {reviewBusy ? "Reviewing…" : "Code intelligence"}</button></section>
      {reviewError ? <p className="connector-help upload-error">{reviewError}</p> : null}
      {intelligence ? <section className="panel repo-intelligence-panel"><div className="panel-head"><span><BarChart3 size={16} /><strong>Repository intelligence</strong></span><button className="icon-btn" onClick={() => void runCodeReview()} aria-label="Refresh code review"><RefreshCw size={14} /></button></div><div className="repo-intelligence-metrics"><div><b>{intelligence.treeSize}</b><span>tracked files</span></div><div><b>{intelligence.sourceFiles}</b><span>source files</span></div><div><b>{intelligence.testFiles}</b><span>test files</span></div><div><b>{intelligence.routeFiles}</b><span>routes / APIs</span></div></div><div className="repo-intelligence-meta"><span>Branch: <b>{intelligence.branch}</b></span><span>Language: <b>{intelligence.language}</b></span><span>Dependencies mapped: <b>{intelligence.dependencies.length}</b></span></div><div className="review-findings-head"><strong>Automated review findings</strong><span>{intelligence.findings.length} finding{intelligence.findings.length === 1 ? "" : "s"}</span></div>{intelligence.findings.length ? <div className="review-findings">{intelligence.findings.map((finding) => <article className={`review-finding ${finding.severity}`} key={finding.id}><span className="review-severity">{finding.severity === "critical" ? <AlertTriangle size={13} /> : finding.severity === "warning" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} {finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p><small>{finding.evidence.slice(0, 4).join(" · ")}{finding.path ? ` · ${finding.path}` : ""}</small><button className="secondary review-action" onClick={() => prepareFinding(finding)}><GitPullRequest size={12} /> prepare fix branch</button></div></article>)}</div> : <div className="review-clean"><CheckCircle2 size={18} /> No deterministic review findings detected in the analyzed files.</div>}<small className="review-generated">Generated {new Date(intelligence.generatedAt).toLocaleString()} · Read-only analysis until you approve a GitHub action.</small></section> : null}
      {writeAction ? <section className="panel repo-write-panel"><div className="panel-head"><span><GitPullRequest size={16} /><strong>{writeAction === "create_branch" ? "Create a branch" : writeAction === "commit_file" ? "Commit a file" : "Open a pull request"}</strong></span><button className="icon-btn" onClick={() => setWriteAction(null)} aria-label="Close write panel">×</button></div><p className="connector-help">This action changes the connected repository. Elias will ask for a final confirmation immediately before sending it to GitHub.</p><form onSubmit={submit} className="repo-write-form">{writeAction === "create_branch" ? <><label>New branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-change" /></label><label>From branch<input required value={base} onChange={(event) => setBase(event.target.value)} /></label></> : writeAction === "commit_file" ? <><label>Target branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} placeholder={base} /></label><label>File path<input required value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/example.ts" /></label><label>Commit message<input required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Update from Elias" /></label><label>File content<textarea required value={content} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="Paste the complete file content" /></label></> : <><label>Head branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-change" /></label><label>Base branch<input required value={base} onChange={(event) => setBase(event.target.value)} /></label><label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Describe the proposed change" /></label><label>Body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="Explain what changed and why" /></label></>}<div className="repo-write-actions"><button type="button" className="secondary" onClick={() => setWriteAction(null)}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <GitPullRequest size={15} />} {busy ? "Working…" : "Review and confirm"}</button></div></form></section> : null}
      {notice ? <p className="connector-success">{notice}</p> : null}{error ? <p className="connector-help upload-error">{error}</p> : null}
      <section className="panel"><div className="panel-head"><span><GitCommitHorizontal size={16} /><strong>Recent repository activity</strong></span><span>{data.repository.language}</span></div><div className="repo-commit-list">{data.commits.map((commit) => <a href={commit.url} target="_blank" rel="noreferrer" className="repo-commit-row" key={commit.sha}><GitCommitHorizontal size={14} /><span><strong>{commit.message}</strong><small>{commit.author}{commit.date ? ` · ${new Date(commit.date).toLocaleDateString()}` : ""}</small></span><ArrowUpRight size={14} /></a>)}</div></section><div className="workspace-footnote">You are working inside Elias. Write actions always require a final confirmation before GitHub is changed.</div>
    </>}</main></AppShell>;
}
