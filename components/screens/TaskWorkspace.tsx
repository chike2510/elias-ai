"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, Download, ExternalLink, FileArchive, LoaderCircle, LockKeyhole, MoreHorizontal, Pause, Play, RotateCcw, Send, Share2, ShieldCheck, Square, Undo2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import GradientBackdrop from "@/components/GradientBackdrop";
import StepTracker, { type Step } from "@/components/StepTracker";
import { readApiResponse } from "@/lib/clientApi";
import { cacheTaskSnapshot, getCachedTaskSnapshot, listCachedTaskSnapshots } from "@/lib/clientTask";
import type { PermissionLevel, TaskArtifactRef, TaskRecord, TaskStatus } from "@/lib/task";

type StopAfterStep = "pause" | "cancel";

function time(value: number) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function statusLabel(status: TaskStatus | string) {
  const labels: Record<string, string> = {
    queued: "Ready to start", planning: "Planning", running: "In progress", waiting_approval: "Approval needed",
    paused: "Paused", completed: "Completed", failed: "Needs attention", cancelled: "Cancelled",
  };
  return labels[status] || status.replaceAll("_", " ");
}
function statusDetail(status: TaskStatus) {
  const details: Record<TaskStatus, string> = {
    queued: "The task is ready. Start it when you’re ready for Elias to begin.",
    planning: "Elias is organizing the next steps for this task.",
    running: "Elias is working through the current step.",
    waiting_approval: "Work is paused until you review the permission request below.",
    paused: "This task is paused. Resume it whenever you’re ready.",
    completed: "All planned steps are complete. Review the activity and deliverables below.",
    failed: "A step stopped before completion. Review the error and activity, then retry the task.",
    cancelled: "This task was cancelled and will not continue.",
  };
  return details[status];
}
function permissionLabel(permission: PermissionLevel) {
  const labels: Record<PermissionLevel, string> = {
    read: "read task files", write: "modify files in the task workspace", artifact: "create a downloadable artifact",
    network: "access public web sources", execute: "run validation commands", external_side_effect: "perform an external action",
  };
  return labels[permission];
}
function artifactHref(taskId: string, artifact: TaskArtifactRef) {
  return `/api/tasks/${encodeURIComponent(taskId)}/artifact/${encodeURIComponent(artifact.id)}`;
}
function trackerIconForStep(title: string): Step["icon"] {
  const value = title.toLowerCase();
  if (/search|research|read|source|evidence|inspect|discover/.test(value)) return "search";
  if (/file|artifact|document|pdf|docx|slide|deliver|package|export|create/.test(value)) return "file";
  if (/check|verify|review|validate|test|sanity|confirm/.test(value)) return "check";
  return "edit";
}
function trackerStatusForTask(status: TaskStatus): "ready" | "in-progress" | "complete" | "interrupted" | "waiting" | "paused" {
  if (status === "completed") return "complete";
  if (status === "waiting_approval") return "waiting";
  if (status === "paused") return "paused";
  if (status === "failed" || status === "cancelled") return "interrupted";
  if (status === "queued") return "ready";
  return "in-progress";
}
function stepStatusLabel(status: TaskRecord["plan"][number]["status"]) {
  if (status === "completed") return "Complete";
  if (status === "active") return "In progress";
  if (status === "failed") return "Needs attention";
  if (status === "skipped") return "Skipped";
  return "Not started";
}

export default function TaskWorkspace() {
  const params = useSearchParams();
  const requestedId = params.get("id");
  const requestedPrompt = params.get("prompt");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [recent, setRecent] = useState<TaskRecord[]>([]);
  const [objective, setObjective] = useState(requestedPrompt || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedArtifact, setCopiedArtifact] = useState("");
  const stopAfterStep = useRef<StopAfterStep | null>(null);

  async function loadRecent() {
    try {
      const data = await readApiResponse<{ tasks?: TaskRecord[] }>(await fetch("/api/tasks", { cache: "no-store" }));
      const serverTasks = data.tasks || [];
      const cachedTasks = listCachedTaskSnapshots();
      setRecent([...cachedTasks, ...serverTasks].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch { setRecent(listCachedTaskSnapshots()); }
  }

  async function loadTask(id: string) {
    const cached = getCachedTaskSnapshot(id);
    if (cached) { setTask(cached); setObjective(cached.objective); setError(""); }
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(id)}`, { cache: "no-store" }));
      setTask(data.task); cacheTaskSnapshot(data.task); setObjective(data.task.objective); setError("");
    } catch (caught) {
      if (cached) return;
      setError(caught instanceof Error ? caught.message : "Task could not be loaded.");
    }
  }

  useEffect(() => { void loadRecent(); if (requestedId) void loadTask(requestedId); else setTask(null); }, [requestedId, requestedPrompt]);

  async function create() {
    const value = objective.trim();
    if (!value || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: value }) }));
      setTask(data.task); cacheTaskSnapshot(data.task); window.history.replaceState({}, "", `/tasks?id=${encodeURIComponent(data.task.id)}`); setRecent((current) => [data.task, ...current.filter((item) => item.id !== data.task.id)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task could not be created."); }
    finally { setBusy(false); }
  }

  async function run(taskToRun: TaskRecord | null = task) {
    if (!taskToRun || busy || !["queued", "planning", "running", "paused", "failed"].includes(taskToRun.status)) return;
    stopAfterStep.current = null;
    setBusy(true); setError(""); setNotice("");
    try {
      let current = taskToRun;
      for (let count = 0; count < 12; count += 1) {
        const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(current.id)}/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxSteps: 1, task: current }) }));
        current = data.task; setTask(current); cacheTaskSnapshot(current);
        const requestedStop = stopAfterStep.current;
        if (requestedStop) {
          stopAfterStep.current = null;
          const stopped = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(current.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: requestedStop }) }));
          current = stopped.task; setTask(current); cacheTaskSnapshot(current);
          setNotice(requestedStop === "pause" ? "Paused after the current step finished." : "Cancelled after the current step finished.");
          break;
        }
        if (!["queued", "planning", "running"].includes(current.status)) break;
      }
      await loadRecent();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task execution failed. Check the latest activity and try again."); }
    finally { stopAfterStep.current = null; setBusy(false); }
  }

  async function action(value: "pause" | "cancel" | "approve" | "reject" | "restore_checkpoint", target?: string) {
    if (!task) return;
    if (value === "restore_checkpoint") {
      const checkpoint = task.checkpoints.find((item) => item.id === target);
      if (!checkpoint || !window.confirm(`Restore “${checkpoint.label}”? This replaces the task workspace with the files saved at that checkpoint.`)) return;
    }
    if (busy) {
      if (value === "pause" || value === "cancel") {
        stopAfterStep.current = value;
        setError("");
        setNotice(value === "pause" ? "Pause requested. The current step will finish first." : "Cancellation requested. The current step will finish first.");
      }
      return;
    }

    let taskToContinue: TaskRecord | null = null;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value, value: target }) }));
      setTask(data.task); cacheTaskSnapshot(data.task);
      if (value === "approve") taskToContinue = data.task;
      if (value === "reject") setNotice("Permission declined. The task is paused; you can review the request and decide what to do next.");
      if (value === "restore_checkpoint") setNotice("Checkpoint restored. The task is paused and ready to resume.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task action failed."); }
    finally { setBusy(false); }
    if (taskToContinue) void run(taskToContinue);
  }

  async function shareArtifact(artifact: TaskArtifactRef) {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(new URL(artifactHref(task.id, artifact), window.location.origin).toString());
      setCopiedArtifact(artifact.id);
      window.setTimeout(() => setCopiedArtifact((current) => current === artifact.id ? "" : current), 2200);
    } catch { setError("Could not copy the artifact link. Use Download instead."); }
  }

  const completed = task?.plan.filter((step) => step.status === "completed").length || 0;
  const total = task?.plan.length || 0;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const pendingApproval = task?.approvals.find((approval) => approval.status === "pending");
  const history = recent.filter((item) => item.id !== task?.id).slice(0, 6);
  const canRun = Boolean(task && ["queued", "planning", "running", "paused", "failed"].includes(task.status));
  const controlLocked = Boolean(task && ["completed", "cancelled"].includes(task.status));

  return <AppShell title="Tasks">
    <main className="screen task-workspace-screen workspace-destination">
      <header className="screen-header task-workspace-header task-mock-header">
        <Link className="task-back" href="/" aria-label="Back to home"><ArrowLeft size={20} /></Link><div className="screen-header-copy"><span className="eyebrow">WORKSPACE</span><h1>Tasks</h1><p className="screen-description">Plans, approvals, and deliverables stay together.</p></div>
        <button type="button" className="secondary task-filter" onClick={() => { window.history.pushState({}, "", "/tasks"); setTask(null); setObjective(""); setError(""); setNotice(""); }}>All tasks <ChevronRight size={15} /></button><button type="button" className="task-more" aria-label="More task options"><MoreHorizontal size={20} /></button>
      </header>

      {!task ? <section className="task-start-guide panel quiet-card"><GradientBackdrop intensity="bold" className="task-start-guide-gradient" /><div className="task-start-mark"><img src="/branding/elias-logo.png" alt="ELIAS" /></div><span className="eyebrow">NEW TASK</span><h2>What do you want done?</h2><p>Describe the outcome. Elias will create a visible plan before you continue.</p><label className="task-start-label" htmlFor="task-start-input">Your request</label><textarea id="task-start-input" className="task-start-input" value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} maxLength={20000} placeholder="Describe what you need…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void create(); } }} /><div className="task-start-helper">You can review progress, activity, permission requests, and files from this task.</div><button type="button" className="primary task-start-button" disabled={!objective.trim() || busy} onClick={() => void create()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} {busy ? "Creating task" : "Create task plan"}</button><div className="task-examples"><span>Try an example</span><button type="button" onClick={() => setObjective("Audit this project, explain the highest-risk issues, and create a prioritized fix plan.")}>Audit a project <ChevronRight size={14} /></button><button type="button" onClick={() => setObjective("Research the current best practices for Next.js App Router caching and cite primary sources.")}>Research with evidence <ChevronRight size={14} /></button><button type="button" onClick={() => setObjective("Create a technical architecture document for a reliable autonomous coding agent.")}>Create a deliverable <ChevronRight size={14} /></button></div></section> : <>
        <section className="task-focus-card panel quiet-card">
          <div className="task-focus-head"><div className="task-focus-heading-copy"><h2>{task.title || "Untitled task"}</h2><small>{task.kind} · {task.workspace.length} workspace file{task.workspace.length === 1 ? "" : "s"}</small></div><span className={`task-state-pill ${task.status}`}>{task.status === "completed" ? <Check size={13} /> : task.status === "waiting_approval" ? <ShieldCheck size={13} /> : task.status === "paused" ? <Pause size={13} /> : task.status === "failed" ? <AlertCircle size={13} /> : null}{statusLabel(task.status)}</span></div>
          <p className="task-status-description">{statusDetail(task.status)}</p>
          <details className="task-objective-details"><summary>Original request</summary><p>{task.objective}</p></details>
          {task.error ? <div className="task-failure-panel" role="alert"><CircleAlert size={17} /><div><strong>This task needs attention</strong><p>{task.error}</p>{canRun ? <button type="button" className="secondary" disabled={busy} onClick={() => void run()}><RotateCcw size={14} /> Retry task</button> : null}</div></div> : null}
          {task.artifacts[0] ? <section className="task-main-artifact"><div className="task-main-artifact-head"><FileArchive size={16} /><strong>Ready to download</strong></div><div className="task-main-artifact-preview"><FileArchive size={28} /><div><strong>{task.artifacts[0].name}</strong><small>{task.artifacts[0].type || "Generated file"}{task.artifacts[0].size ? ` · ${Math.max(1, Math.round(task.artifacts[0].size / 1024))} KB` : ""}</small>{task.artifacts[0].preview ? <p>{task.artifacts[0].preview.slice(0, 320)}{task.artifacts[0].preview.length > 320 ? "…" : ""}</p> : null}</div></div><div className="task-main-artifact-actions"><a className="primary" href={artifactHref(task.id, task.artifacts[0])} download={task.artifacts[0].name}><Download size={14} /> Download</a><button className="secondary" type="button" onClick={() => void shareArtifact(task.artifacts[0])}><Share2 size={14} /> {copiedArtifact === task.artifacts[0].id ? "Link copied" : "Copy link"}</button></div><span className="task-copy-status" aria-live="polite">{copiedArtifact === task.artifacts[0].id ? "Artifact link copied to clipboard." : ""}</span></section> : null}
          <StepTracker summary={task.events.at(-1)?.detail || task.events.at(-1)?.label || task.title || "Task created and ready to start."} steps={task.plan.map((step) => ({ id: step.id, label: step.title, icon: trackerIconForStep(`${step.title} ${step.description}`), status: step.status === "completed" ? "complete" : step.status === "failed" ? "error" : step.status === "active" ? "active" : "pending" }))} status={trackerStatusForTask(task.status)} />
          <div className="task-focus-progress-label"><strong>{completed} of {total} steps complete</strong><span>{progress}%</span></div>
          <div className="task-progress task-focus-meter" role="progressbar" aria-label="Task plan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
          <div className="task-mock-timeline" aria-label="Task plan">{task.plan.map((step, index) => { const active = step.status === "active"; const complete = step.status === "completed"; const failed = step.status === "failed"; const evidenceCount = step.evidenceEventIds?.length || 0; return <article className={`task-mock-step ${complete ? "completed" : active ? "active" : failed ? "failed" : "pending"}`} key={step.id}><span className="task-mock-marker">{complete ? <Check size={14} /> : failed ? <AlertCircle size={14} /> : active ? <Clock3 size={14} /> : index + 1}</span><div className="task-mock-copy"><strong>{index + 1}. {step.title}</strong><small>{step.description}</small><span className={`task-plan-status ${active ? "active" : failed ? "failed" : complete ? "complete" : ""}`}>{stepStatusLabel(step.status)}{evidenceCount ? <a href="#task-activity"> · {evidenceCount} activity item{evidenceCount === 1 ? "" : "s"}</a> : null}</span></div><time>{active || complete || failed ? time(step.updatedAt) : "—"}</time></article>; })}</div>
          <div className="task-focus-actions"><button type="button" className="primary" disabled={busy || !canRun || Boolean(pendingApproval)} onClick={() => void run()}>{busy ? <LoaderCircle size={15} className="spin" /> : task.status === "failed" ? <RotateCcw size={15} /> : task.status === "completed" ? <CheckCircle2 size={15} /> : task.status === "cancelled" ? <Square size={13} /> : <Play size={15} />}{busy ? "Working" : task.status === "completed" ? "Task complete" : task.status === "cancelled" ? "Task cancelled" : task.status === "failed" ? "Retry task" : task.status === "paused" ? "Resume task" : task.status === "queued" ? "Start task" : task.status === "waiting_approval" ? "Waiting for approval" : "Continue task"}</button><Link className="secondary" href={`/agent?task=${encodeURIComponent(task.id)}`}>Open workspace</Link></div>
        </section>

        {pendingApproval ? <section className="approval-card" aria-labelledby="approval-title"><div><LockKeyhole size={17} /><div><strong id="approval-title">Elias needs your approval</strong><p>{pendingApproval.question}</p><small>Allowing this request lets Elias {permissionLabel(pendingApproval.permission)} for this task.</small></div></div><div className="approval-actions"><button type="button" className="primary" disabled={busy} onClick={() => void action("approve", pendingApproval.id)}><Check size={14} /> Allow &amp; continue</button><button type="button" className="secondary" disabled={busy} onClick={() => void action("reject", pendingApproval.id)}>Decline</button></div></section> : null}
        <section className="task-evidence-card panel quiet-card" id="task-activity"><div className="workbench-section-head"><div><span className="eyebrow">ACTIVITY &amp; EVIDENCE</span><h2>What happened</h2></div><span className="activity-count">{task.events.length}</span></div><div className="evidence-list">{task.events.length ? [...task.events].reverse().map((event) => <article className={`evidence-item ${event.status}`} key={event.id}><span className="evidence-line" /><div><div className="evidence-meta"><strong>{event.label}</strong><time>{time(event.createdAt)}</time></div>{event.detail ? <p>{event.detail}</p> : null}{event.evidence ? <details className="evidence-payload"><summary>View recorded evidence</summary><pre>{typeof event.evidence.value === "string" ? event.evidence.value : JSON.stringify(event.evidence.value, null, 2)}</pre></details> : null}</div></article>) : <div className="task-empty"><img src="/branding/elias-logo.png" alt="" /><strong>No activity yet</strong><small>Start the task to see each recorded operation and evidence item here.</small></div>}</div></section>
        <section className="task-delivery panel quiet-card"><div className="workbench-section-head"><div><span className="eyebrow">OUTPUT</span><h2>Files &amp; checkpoints</h2></div><FileArchive size={17} /></div><div className="delivery-grid"><div><strong>{task.artifacts.length ? `${task.artifacts.length} artifact${task.artifacts.length === 1 ? "" : "s"}` : "No artifacts yet"}</strong><small>Downloadable outputs stay associated with this task.</small>{task.artifacts.map((artifact) => <a className="task-artifact" key={artifact.id} href={artifactHref(task.id, artifact)} download={artifact.name}><FileArchive size={14} /><span>{artifact.name}</span><small>{artifact.type}</small><Download size={13} /></a>)}</div><div><strong>{task.checkpoints.length ? `${task.checkpoints.length} checkpoints` : "No checkpoints yet"}</strong><small>Restore a saved workspace state if you need to roll back a change.</small>{task.checkpoints.slice(-3).reverse().map((checkpoint) => <button type="button" className="checkpoint-row" key={checkpoint.id} disabled={busy} onClick={() => void action("restore_checkpoint", checkpoint.id)}><Undo2 size={13} /><span>{checkpoint.label}</span><ChevronRight size={13} /></button>)}</div></div></section>
        <div className="task-controls"><button type="button" className="secondary" disabled={Boolean(stopAfterStep.current) || task.status === "paused" || controlLocked} onClick={() => void action("pause")}><Pause size={14} />{stopAfterStep.current === "pause" ? "Pausing…" : "Pause"}</button><button type="button" className="secondary" disabled={Boolean(stopAfterStep.current) || controlLocked} onClick={() => void action("cancel")}><Square size={13} />{stopAfterStep.current === "cancel" ? "Cancelling…" : "Cancel"}</button>{task.checkpoints.length ? <button type="button" className="secondary" disabled={busy} onClick={() => void action("restore_checkpoint", task.checkpoints.at(-1)?.id)}><RotateCcw size={14} /> Restore latest</button> : null}</div>
      </>}

      {error ? <div className="inline-error" role="alert"><CircleAlert size={15} /><span>{error}</span>{task && canRun ? <button type="button" className="secondary" disabled={busy} onClick={() => void run()}><RotateCcw size={13} /> Retry</button> : null}</div> : null}
      {notice ? <div className="task-action-notice" role="status"><CheckCircle2 size={15} /><span>{notice}</span></div> : null}
      {history.length ? <section className="recent-tasks task-history-section"><div className="workbench-section-head"><div><span className="eyebrow">HISTORY</span><h2>Recent tasks</h2></div></div><div className="recent-task-list">{history.map((item) => <Link className="task-history-row" href={`/tasks?id=${encodeURIComponent(item.id)}`} key={item.id}><span className={`task-status-dot ${item.status}`} /><span className="task-history-copy"><strong>{item.title || "Untitled task"}</strong><small>{statusLabel(item.status)} · {new Date(item.updatedAt).toLocaleDateString()}</small></span>{item.approvals.some((approval) => approval.status === "pending") ? <span className="task-history-alert">Approval needed</span> : <span className="task-history-artifacts">{item.artifacts.length} artifacts</span>}<ChevronRight size={14} /></Link>)}</div></section> : null}
    </main>
  </AppShell>;
}
