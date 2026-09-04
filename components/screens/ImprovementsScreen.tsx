"use client";

import Link from "next/link";
import { ArrowLeft, Check, ClipboardCheck, GitBranch, Github, Lightbulb, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { getImprovements, makeId, saveImprovement, type ImprovementRecord } from "@/lib/persistence";

const now = () => Date.now();

export default function ImprovementsScreen() {
  const [records, setRecords] = useState<ImprovementRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState<"feedback" | "evaluation">("feedback");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [repositories, setRepositories] = useState<Array<{ fullName: string; defaultBranch: string }>>([]);
  const [selectedRepository, setSelectedRepository] = useState("");

  async function load() { try { setRecords(await getImprovements()); const response = await fetch("/api/github/repos", { cache: "no-store" }); if (response.ok) { const payload = await response.json(); setRepositories((payload.repositories || []).map((item: { fullName: string; defaultBranch?: string }) => ({ fullName: item.fullName, defaultBranch: item.defaultBranch || "main" }))); } } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open improvement records."); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);

  const open = useMemo(() => records.filter((item) => item.status === "open"), [records]);
  const proposals = useMemo(() => records.filter((item) => item.kind === "proposal"), [records]);
  const average = useMemo(() => { const scored = records.filter((item) => typeof item.score === "number"); return scored.length ? Math.round((scored.reduce((sum, item) => sum + (item.score || 0), 0) / scored.length) * 100) : null; }, [records]);

  async function addRecord(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !detail.trim()) return;
    const timestamp = now();
    const record: ImprovementRecord = { id: makeId("improvement"), kind, title: title.trim(), detail: detail.trim(), status: "open", source: "user", evidence: [], createdAt: timestamp, updatedAt: timestamp };
    await saveImprovement(record); setRecords((current) => [record, ...current]); setTitle(""); setDetail(""); setShowForm(false);
  }

  async function propose(record: ImprovementRecord) {
    const timestamp = now();
    const proposal: ImprovementRecord = { id: makeId("proposal"), kind: "proposal", title: `Improve: ${record.title}`, detail: `Evidence-backed proposal generated from the signal “${record.title}”.\n\nProblem: ${record.detail}\n\nNext step: inspect the relevant Elias implementation, add a regression case, and prepare a small pull request.`, status: "open", source: record.id, evidence: [record.detail], targetFiles: [], branch: `elias/improve-${record.id.slice(-8)}`, createdAt: timestamp, updatedAt: timestamp };
    await saveImprovement(proposal); setRecords((current) => [proposal, ...current]);
  }

  async function updateStatus(record: ImprovementRecord, status: ImprovementRecord["status"]) {
    const updated = { ...record, status, updatedAt: now() };
    await saveImprovement(updated); setRecords((current) => current.map((item) => item.id === record.id ? updated : item));
  }

  async function prepareBranch(record: ImprovementRecord) {
    const repository = repositories.find((item) => item.fullName === selectedRepository);
    if (!repository || !record.branch) { setError("Connect GitHub and choose a repository before preparing a branch."); return; }
    if (!window.confirm(`Prepare branch “${record.branch}” in ${repository.fullName}? Elias will ask for final confirmation before GitHub is changed.`)) return;
    const [owner, repo] = repository.fullName.split("/");
    try {
      const response = await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_branch", owner, repo, branch: record.branch, base: repository.defaultBranch, confirm: "CONFIRM_GITHUB_CREATE_BRANCH" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Could not prepare the GitHub branch.");
      await updateStatus(record, "accepted");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare the GitHub branch."); }
  }

  return <AppShell title="Improvement Center"><main className="screen improvement-screen"><div className="mobile-screen-heading"><Link href="/profile" aria-label="Back to profile"><ArrowLeft size={19} /></Link><h1>improvement center</h1><span className="improvement-mark"><Sparkles size={16} /></span></div><section className="improvement-hero"><div><p className="eyebrow">ELIAS / controlled self-improvement</p><h2>Make Elias better with evidence.</h2><p>Capture failures, evaluate behavior, and prepare safe proposals. Elias never changes production silently.</p></div><ShieldCheck size={35} /></section><div className="improvement-metrics"><div className="improvement-metric"><b>{open.length}</b><span>open signals</span></div><div className="improvement-metric"><b>{proposals.length}</b><span>proposals</span></div><div className="improvement-metric"><b>{average === null ? "—" : `${average}%`}</b><span>evaluation average</span></div></div><section className="panel improvement-controls"><div className="improvement-control-copy"><strong>Improvement signals</strong><small>Record a user correction, tool failure, retrieval miss, or evaluation result.</small></div><button className="primary" onClick={() => setShowForm((value) => !value)}><Plus size={15} /> log signal</button></section>{showForm ? <form className="panel improvement-form" onSubmit={addRecord}><div className="form-grid"><label>Signal type<select value={kind} onChange={(event) => setKind(event.target.value as "feedback" | "evaluation")}><option value="feedback">User feedback</option><option value="evaluation">Evaluation result</option></select></label><label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="PDF answer missed a relevant section" /></label></div><label>Evidence and detail<textarea required rows={5} value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="What happened, what should have happened, and how can Elias reproduce it?" /></label><button className="primary" type="submit"><Check size={15} /> save evidence</button></form> : null}{error ? <p className="inline-error">{error}</p> : null}<section className="improvement-columns"><div className="panel improvement-panel"><div className="panel-head"><span><Lightbulb size={16} /><strong>Signals</strong></span><b className="panel-count">{records.filter((item) => item.kind !== "proposal").length}</b></div>{busy ? <p className="connector-help">Loading your improvement records…</p> : records.filter((item) => item.kind !== "proposal").length ? <div className="improvement-list">{records.filter((item) => item.kind !== "proposal").map((record) => <article className="improvement-row" key={record.id}><div className="improvement-row-copy"><span className={`improvement-type ${record.kind} ${record.severity || ""}`}>{record.kind}{record.source === "automatic" || record.source?.startsWith("chat-") ? " · auto" : ""}</span><strong>{record.title}</strong><p>{record.detail}</p>{record.occurrences && record.occurrences > 1 ? <small className="improvement-occurrences">Seen {record.occurrences} times · {record.severity || "warning"}</small> : null}</div><div className="improvement-row-actions">{record.status === "open" ? <button className="secondary" onClick={() => void propose(record)}><Sparkles size={13} /> propose</button> : <span className="improvement-status">{record.status}</span>}{record.status === "open" ? <button className="icon-btn" onClick={() => void updateStatus(record, "dismissed")} aria-label="Dismiss signal"><X size={14} /></button> : null}</div></article>)}</div> : <div className="improvement-empty"><ClipboardCheck size={25} /><strong>No signals yet</strong><small>When Elias misses, slows down, or needs a better tool, record the evidence here.</small></div>}</div><div className="panel improvement-panel"><div className="panel-head"><span><GitBranch size={16} /><strong>Proposals</strong></span><b className="panel-count">{proposals.length}</b></div>{repositories.length ? <select className="proposal-repo-select" value={selectedRepository} onChange={(event) => setSelectedRepository(event.target.value)}><option value="">Choose connected GitHub repository</option>{repositories.map((item) => <option key={item.fullName} value={item.fullName}>{item.fullName}</option>)}</select> : null}{proposals.length ? <div className="improvement-list">{proposals.map((record) => <article className="improvement-row" key={record.id}><div className="improvement-row-copy"><span className="improvement-type proposal">proposal</span><strong>{record.title}</strong><p>{record.detail}</p>{record.branch ? <small className="proposal-branch">{record.branch}</small> : null}</div><div className="improvement-row-actions">{record.status === "open" ? <><button className="secondary" onClick={() => void updateStatus(record, "accepted")}><Check size={13} /> approve plan</button>{record.branch ? <button className="primary" disabled={!selectedRepository} onClick={() => void prepareBranch(record)}><Github size={13} /> prepare branch</button> : null}</> : <span className="improvement-status">{record.status}</span>}</div></article>)}</div> : <div className="improvement-empty"><GitBranch size={25} /><strong>No proposals yet</strong><small>Turn an evidence-backed signal into a small, reviewable improvement plan.</small></div>}</div></section><section className="panel improvement-safety"><ShieldCheck size={18} /><div><strong>Safe by design</strong><p>Elias can analyze signals and prepare a branch proposal. GitHub writes, pull requests, and Vercel deployments still require explicit confirmation.</p></div></section></main></AppShell>;
}
