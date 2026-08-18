"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowUpRight, BarChart3, CheckCircle2, GitCommitHorizontal, Github, GitPullRequest, LoaderCircle, LockKeyhole, MessageSquare, Plus, RefreshCw, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { recordAutomaticSignal } from "@/lib/persistence";

type Workspace = { repository: { fullName: string; name: string; description: string; private: boolean; url: string; defaultBranch: string; language: string; stars: number; openIssues: number }; commits: Array<{ sha: string; url: string; message: string; author: string; date?: string }> };
type Intelligence = { repository: string; branch: string; language: string; treeSize: number; sourceFiles: number; routeFiles: number; testFiles: number; truncated: boolean; files: Array<{ path: string; lines: number; chars: number }>; dependencies: string[]; architecture?: { layerCounts: Record<string, number>; entrypoints: string[]; configFiles: string[]; modules: Array<{ path: string; role: string; lines: number; imports: string[]; resolvedImports?: Array<{ target: string; resolvedPath: string }> }>; dependencyEdges: Array<{ from: string; to: string; import?: string }>; reverseDependents?: Record<string, string[]>; graphTruncated: boolean }; findings: Array<{ id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; evidence: string[]; path?: string }>; generatedAt: string };
type ImpactReport = { changedFiles: string[]; affectedFiles: Array<{ path: string; distance: number; reason: string; role: string }>; impactedEntrypoints: string[]; impactedTests: string[]; changedConfig: boolean; riskLevel: "low" | "medium" | "high"; summary: string; graphCoverage: { mappedModules: number; resolvedEdges: number }; generatedAt: string };
type ModelReview = { summary: string; riskLevel: "low" | "medium" | "high" | "critical"; findings: Array<{ id: string; severity: "critical" | "high" | "medium" | "low"; title: string; detail: string; evidence: Array<{ path: string; line?: number; quote?: string }>; recommendation: string; confidence: number }>; reviewedFiles: string[]; diffIncluded: boolean; provider: string; model: string; branch: string; generatedAt: string };
type WriteAction = "create_branch" | "commit_file" | "create_pull_request" | "create_issue" | "create_review_comment";

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
  const [pullNumber, setPullNumber] = useState("");
  const [commitId, setCommitId] = useState("");
  const [commentPath, setCommentPath] = useState("");
  const [commentLine, setCommentLine] = useState("");
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [reviewDiff, setReviewDiff] = useState("");
  const [modelReview, setModelReview] = useState<ModelReview | null>(null);
  const [modelReviewBusy, setModelReviewBusy] = useState(false);
  const [impactReport, setImpactReport] = useState<ImpactReport | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);

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
    if (action === "create_issue") { setTitle(""); setBody(""); }
    if (action === "create_review_comment") { setPullNumber(""); setCommitId(""); setCommentPath(""); setCommentLine(""); setBody(""); }
  }

  async function runImpactReport() {
    if (!intelligence || (!selectedPaths.length && !reviewDiff.trim())) return;
    setImpactBusy(true); setReviewError("");
    try {
      const response = await fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/impact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: selectedPaths, diff: reviewDiff, architecture: intelligence.architecture }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Impact report failed.");
      setImpactReport(payload.impact);
      void recordAutomaticSignal({ kind: "evaluation", title: `Impact report for ${owner}/${repo}`, detail: payload.impact.summary, severity: payload.impact.riskLevel === "high" ? "warning" : "info", source: "github-impact-analysis", evidence: payload.impact.affectedFiles.slice(0, 8).map((item: { path: string; distance: number }) => `${item.path} · distance ${item.distance}`) }).catch(() => undefined);
    } catch (reason) { setReviewError(reason instanceof Error ? reason.message : "Impact report failed."); }
    finally { setImpactBusy(false); }
  }

  async function runModelReview() {
    if (!intelligence || (!selectedPaths.length && !reviewDiff.trim())) return;
    setModelReviewBusy(true); setReviewError("");
    try {
      const response = await fetch(`/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: selectedPaths, diff: reviewDiff, branch: intelligence.branch, architecture: intelligence.architecture }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Model-assisted review failed.");
      setModelReview(payload.review);
      void recordAutomaticSignal({ kind: "evaluation", title: `Model-assisted review for ${owner}/${repo}`, detail: payload.review.summary || `Model review returned ${payload.review.findings?.length || 0} finding(s).`, severity: payload.review.riskLevel === "critical" || payload.review.riskLevel === "high" ? "critical" : "warning", source: "github-model-review", evidence: (payload.review.findings || []).slice(0, 4).flatMap((finding: { evidence?: Array<{ path?: string; line?: number }> }) => (finding.evidence || []).map((item) => `${item.path || "unknown"}${item.line ? `:${item.line}` : ""}`)) }).catch(() => undefined);
    } catch (reason) { setReviewError(reason instanceof Error ? reason.message : "Model-assisted review failed."); }
    finally { setModelReviewBusy(false); }
  }

  function prepareFinding(finding: Intelligence["findings"][number] | ModelReview["findings"][number]) {
    openAction("create_branch");
    setBranch(`elias/review-${finding.id.slice(-12)}`);
  }

  function prepareIssue(finding: Intelligence["findings"][number] | ModelReview["findings"][number]) {
    openAction("create_issue");
    setTitle(`[Elias review] ${finding.title}`);
    setBody(`${finding.detail}\n\nEvidence:\n${"evidence" in finding ? finding.evidence.map((item) => typeof item === "string" ? item : `${item.path}${item.line ? `:${item.line}` : ""}`).join("\n") : "Repository review finding"}\n\nPrepared by Elias; review before merging.`);
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
      if (writeAction === "create_issue") Object.assign(payload, { title, body });
      if (writeAction === "create_review_comment") Object.assign(payload, { pullNumber: Number(pullNumber), commitId, path: commentPath, line: Number(commentLine), body });
      const response = await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "GitHub action failed.");
      setNotice(result.message || "GitHub action completed.");
      void recordAutomaticSignal({ kind: "evaluation", title: `Confirmed GitHub action: ${writeAction}`, detail: result.message || "A user-confirmed GitHub action completed.", severity: "info", source: "github-action-audit", evidence: [`${owner}/${repo}`, writeAction] }).catch(() => undefined);
      setWriteAction(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "GitHub action failed."); }
    finally { setBusy(false); }
  }

  return <AppShell title={repo}><main className="screen repository-workspace-screen">
    <div className="mobile-screen-heading"><Link href="/connectors/github" aria-label="Back to GitHub"><ArrowLeft size={19} /></Link><h1>{repo}</h1><a className="icon-btn" href={`https://github.com/${owner}/${repo}`} target="_blank" rel="noreferrer" aria-label="Open on GitHub"><ArrowUpRight size={17} /></a></div>
    {error && !data ? <section className="panel repo-workspace-error"><Github size={22} /><strong>{error}</strong><Link className="secondary" href="/connectors/github">Back to GitHub repositories</Link></section> : !data ? <div className="repo-loading"><LoaderCircle className="spin" size={18} /> Loading Elias workspace…</div> : <>
      <section className="repo-workspace-hero"><span className="repo-workspace-icon"><Github size={27} /></span><div><p className="eyebrow">ELIAS / repository workspace</p><h2>{data.repository.fullName}</h2><p>{data.repository.description}</p></div><span className="repo-visibility">{data.repository.private ? <LockKeyhole size={12} /> : null}{data.repository.private ? "Private" : "Public"}</span></section>
      <div className="repo-metrics"><div><b>{data.repository.defaultBranch}</b><span>default branch</span></div><div><b>{data.repository.openIssues}</b><span>open issues</span></div><div><b>{data.repository.stars}</b><span>stars</span></div></div>
      <section className="workspace-actions"><button className="primary" onClick={() => window.location.href = `/chat?prompt=${encodeURIComponent(`Help me understand the GitHub repository ${data.repository.fullName}. Use its recent activity and connected repository context.`)}`}><Sparkles size={15} /> Ask Elias about this repo</button><button className="secondary" onClick={() => openAction("create_branch")}><Plus size={15} /> New branch</button><button className="secondary" onClick={() => openAction("commit_file")}><GitCommitHorizontal size={15} /> Commit file</button><button className="secondary" onClick={() => openAction("create_pull_request")}><GitPullRequest size={15} /> Open pull request</button><button className="secondary"><MessageSquare size={15} /> Issues</button><button className="secondary" onClick={() => openAction("create_review_comment")}><MessageSquare size={15} /> Comment on PR</button><button className="secondary" onClick={() => void runCodeReview()} disabled={reviewBusy}>{reviewBusy ? <LoaderCircle className="spin" size={15} /> : <BarChart3 size={15} />} {reviewBusy ? "Reviewing…" : "Code intelligence"}</button></section>
      {reviewError ? <p className="connector-help upload-error">{reviewError}</p> : null}
      {intelligence ? <section className="panel repo-intelligence-panel"><div className="panel-head"><span><BarChart3 size={16} /><strong>Repository intelligence</strong></span><button className="icon-btn" onClick={() => void runCodeReview()} aria-label="Refresh code review"><RefreshCw size={14} /></button></div><div className="repo-intelligence-metrics"><div><b>{intelligence.treeSize}</b><span>tracked files</span></div><div><b>{intelligence.sourceFiles}</b><span>source files</span></div><div><b>{intelligence.testFiles}</b><span>test files</span></div><div><b>{intelligence.routeFiles}</b><span>routes / APIs</span></div></div><div className="repo-intelligence-meta"><span>Branch: <b>{intelligence.branch}</b></span><span>Language: <b>{intelligence.language}</b></span><span>Dependencies mapped: <b>{intelligence.dependencies.length}</b></span></div>{intelligence.architecture ? <section className="architecture-map"><div className="architecture-map-head"><div><strong>Architecture map</strong><small>Dependency-aware project context for Elias planning and review.</small></div><span>{intelligence.architecture.modules.length} mapped modules</span></div><div className="architecture-layers">{Object.entries(intelligence.architecture.layerCounts).map(([layer, count]) => <div key={layer}><b>{count}</b><span>{layer}</span></div>)}</div><div className="architecture-files"><strong>Entrypoints</strong><div>{intelligence.architecture.entrypoints.slice(0, 8).map((path) => <code key={path}>{path}</code>)}</div></div><div className="architecture-files"><strong>Configuration surface</strong><div>{intelligence.architecture.configFiles.slice(0, 8).map((path) => <code key={path}>{path}</code>)}</div></div><small className="review-generated">{intelligence.architecture.dependencyEdges.length} local dependency edges mapped{intelligence.architecture.graphTruncated ? " · map truncated for performance" : ""}</small></section> : null}<div className="model-review-controls"><div className="review-controls-head"><strong>Model-assisted review</strong><small>Choose up to 8 files and optionally paste a diff. Source content is bounded and sent only for this review.</small></div><div className="review-file-picker">{intelligence.files.filter((file) => /\.(ts|tsx|js|jsx|py|go|java|rb|rs|php|json|yml|yaml)$/.test(file.path)).slice(0, 24).map((file) => <label key={file.path}><input type="checkbox" checked={selectedPaths.includes(file.path)} onChange={(event) => setSelectedPaths((current) => event.target.checked ? [...current, file.path].slice(-8) : current.filter((path) => path !== file.path))} /><span>{file.path}</span></label>)}</div><textarea className="review-diff-input" value={reviewDiff} onChange={(event) => setReviewDiff(event.target.value)} rows={5} placeholder="Optional: paste a unified diff for the change you want reviewed…" /><div className="review-control-actions"><button className="primary" disabled={modelReviewBusy || (!selectedPaths.length && !reviewDiff.trim())} onClick={() => void runModelReview()}>{modelReviewBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} {modelReviewBusy ? "Reviewing with model…" : "Run model-assisted review"}</button><button className="secondary" disabled={impactBusy || (!selectedPaths.length && !reviewDiff.trim())} onClick={() => void runImpactReport()}>{impactBusy ? <LoaderCircle className="spin" size={14} /> : <BarChart3 size={14} />} {impactBusy ? "Mapping impact…" : "Generate impact report"}</button></div></div>{impactReport ? <section className="impact-report"><div className="impact-report-head"><div><strong>Impact report: {impactReport.riskLevel} risk</strong><small>{impactReport.changedFiles.length} changed file(s) · {impactReport.affectedFiles.length} resolved affected file(s)</small></div><span>{impactReport.graphCoverage.resolvedEdges} edges</span></div><p>{impactReport.summary}</p><div className="impact-metrics"><div><b>{impactReport.impactedEntrypoints.length}</b><span>entrypoints</span></div><div><b>{impactReport.impactedTests.length}</b><span>tests</span></div><div><b>{impactReport.changedConfig ? "yes" : "no"}</b><span>config touched</span></div></div>{impactReport.affectedFiles.length ? <div className="impact-file-list">{impactReport.affectedFiles.slice(0, 18).map((item) => <div key={`${item.path}-${item.distance}`}><code>{item.path}</code><span>{item.role} · {item.reason}</span></div>)}</div> : <small className="review-generated">No resolved reverse dependents were found for the selected context.</small>}</section> : null}<div className="review-findings-head"><strong>Automated review findings</strong><span>{intelligence.findings.length} finding{intelligence.findings.length === 1 ? "" : "s"}</span></div>{intelligence.findings.length ? <div className="review-findings">{intelligence.findings.map((finding) => <article className={`review-finding ${finding.severity}`} key={finding.id}><span className="review-severity">{finding.severity === "critical" ? <AlertTriangle size={13} /> : finding.severity === "warning" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} {finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p><small>{finding.evidence.slice(0, 4).join(" · ")}{finding.path ? ` · ${finding.path}` : ""}</small><button className="secondary review-action" onClick={() => prepareFinding(finding)}><GitPullRequest size={12} /> prepare fix branch</button><button className="secondary review-action" onClick={() => prepareIssue(finding)}>create issue</button></div></article>)}</div> : <div className="review-clean"><CheckCircle2 size={18} /> No deterministic review findings detected in the analyzed files.</div>}<small className="review-generated">Generated {new Date(intelligence.generatedAt).toLocaleString()} · Read-only analysis until you approve a GitHub action.</small>{modelReview ? <section className="model-review-result"><div className="model-review-result-head"><div><strong>Model review: {modelReview.riskLevel} risk</strong><small>{modelReview.provider} / {modelReview.model} · {modelReview.reviewedFiles.length} files{modelReview.diffIncluded ? " + diff" : ""}</small></div><span>{Math.round(modelReview.findings.reduce((sum, finding) => sum + finding.confidence, 0) / Math.max(1, modelReview.findings.length) * 100)}% confidence</span></div><p className="model-review-summary">{modelReview.summary}</p>{modelReview.findings.length ? <div className="review-findings">{modelReview.findings.map((finding) => <article className={`review-finding ${finding.severity}`} key={finding.id}><span className="review-severity">{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p><small>{finding.evidence.map((evidence) => `${evidence.path}${evidence.line ? `:${evidence.line}` : ""}`).join(" · ")}</small><p className="review-recommendation">Recommendation: {finding.recommendation}</p><button className="secondary review-action" onClick={() => prepareFinding(finding)}><GitPullRequest size={12} /> prepare fix branch</button><button className="secondary review-action" onClick={() => prepareIssue(finding)}>create issue</button></div></article>)}</div> : <div className="review-clean"><CheckCircle2 size={18} /> No supported model findings for the selected context.</div>}</section> : null}</section> : null}
      {writeAction ? <section className="panel repo-write-panel"><div className="panel-head"><span><GitPullRequest size={16} /><strong>{writeAction === "create_branch" ? "Create a branch" : writeAction === "commit_file" ? "Commit a file" : writeAction === "create_pull_request" ? "Open a pull request" : writeAction === "create_issue" ? "Create a GitHub issue" : "Post a review comment"}</strong></span><button className="icon-btn" onClick={() => setWriteAction(null)} aria-label="Close write panel">×</button></div><p className="connector-help">This action changes the connected repository. Elias will ask for a final confirmation immediately before sending it to GitHub.</p><form onSubmit={submit} className="repo-write-form">{writeAction === "create_branch" ? <><label>New branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-change" /></label><label>From branch<input required value={base} onChange={(event) => setBase(event.target.value)} /></label></> : writeAction === "commit_file" ? <><label>Target branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} placeholder={base} /></label><label>File path<input required value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/example.ts" /></label><label>Commit message<input required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Update from Elias" /></label><label>File content<textarea required value={content} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="Paste the complete file content" /></label></> : writeAction === "create_issue" ? <><label>Issue title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Describe the review finding" /></label><label>Issue body<textarea required value={body} onChange={(event) => setBody(event.target.value)} rows={8} placeholder="Include evidence and a recommendation" /></label></> : writeAction === "create_review_comment" ? <><label>Pull request number<input required type="number" min="1" value={pullNumber} onChange={(event) => setPullNumber(event.target.value)} placeholder="42" /></label><label>Commit ID<input required value={commitId} onChange={(event) => setCommitId(event.target.value)} placeholder="Full commit SHA" /></label><label>File path<input required value={commentPath} onChange={(event) => setCommentPath(event.target.value)} placeholder="src/example.ts" /></label><label>Line number<input required type="number" min="1" value={commentLine} onChange={(event) => setCommentLine(event.target.value)} placeholder="42" /></label><label>Comment<textarea required value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="Explain the evidence-backed review comment" /></label></> : <><label>Head branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-change" /></label><label>Base branch<input required value={base} onChange={(event) => setBase(event.target.value)} /></label><label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Describe the proposed change" /></label><label>Body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="Explain what changed and why" /></label></>}<div className="repo-write-actions"><button type="button" className="secondary" onClick={() => setWriteAction(null)}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <GitPullRequest size={15} />} {busy ? "Working…" : "Review and confirm"}</button></div></form></section> : null}
      {notice ? <p className="connector-success">{notice}</p> : null}{error ? <p className="connector-help upload-error">{error}</p> : null}
      <section className="panel"><div className="panel-head"><span><GitCommitHorizontal size={16} /><strong>Recent repository activity</strong></span><span>{data.repository.language}</span></div><div className="repo-commit-list">{data.commits.map((commit) => <a href={commit.url} target="_blank" rel="noreferrer" className="repo-commit-row" key={commit.sha}><GitCommitHorizontal size={14} /><span><strong>{commit.message}</strong><small>{commit.author}{commit.date ? ` · ${new Date(commit.date).toLocaleDateString()}` : ""}</small></span><ArrowUpRight size={14} /></a>)}</div></section><div className="workspace-footnote">You are working inside Elias. Write actions always require a final confirmation before GitHub is changed.</div>
    </>}</main></AppShell>;
}
