"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Clock3, Download, ExternalLink, FileArchive, LoaderCircle, LockKeyhole, Pause, Play, Plus, RotateCcw, Send, Share2, ShieldCheck, Square, SquareKanban, Undo2 } from "lucide-react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import RepositoryTaskChanges from "@/components/RepositoryTaskChanges";
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
function stepStatusLabel(status: TaskRecord["plan"][number]["status"]) {
  if (status === "completed") return "Complete";
  if (status === "active") return "In progress";
  if (status === "failed") return "Needs attention";
  if (status === "skipped") return "Skipped";
  return "Not started";
}

export default function TaskWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedId = params.get("id");
  const requestedPrompt = params.get("prompt");
  const repositoryOwner = params.get("owner");
  const repositoryName = params.get("repo");
  const repositoryMode = Boolean(repositoryOwner && repositoryName);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [recent, setRecent] = useState<TaskRecord[]>([]);
  const [objective, setObjective] = useState(requestedPrompt || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedArtifact, setCopiedArtifact] = useState("");
  const stopAfterStep = useRef<StopAfterStep | null>(null);

  async function loadRecent() {
    if (repositoryMode) { setRecent([]); return; }
    try {
      const data = await readApiResponse<{ tasks?: TaskRecord[] }>(await fetch("/api/tasks", { cache: "no-store" }));
      const serverTasks = data.tasks || [];
      const cachedTasks = listCachedTaskSnapshots();
      setRecent([...cachedTasks, ...serverTasks].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch { setRecent(listCachedTaskSnapshots()); }
  }

  async function loadTask(id: string) {
    const cached = repositoryMode ? undefined : getCachedTaskSnapshot(id);
    if (cached) { setTask(cached); setObjective(cached.objective); setError(""); }
    try {
      const endpoint = repositoryMode ? `/api/github/repository-tasks/${encodeURIComponent(id)}` : `/api/tasks/${encodeURIComponent(id)}`;
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(endpoint, { cache: "no-store" }));
      setTask(data.task); cacheTaskSnapshot(data.task); setObjective(data.task.objective); setError("");
    } catch (caught) {
      if (cached) return;
      setError(caught instanceof Error ? caught.message : "Task could not be loaded.");
    }
  }

  useEffect(() => { void loadRecent(); if (requestedId) void loadTask(requestedId); else setTask(null); }, [requestedId, requestedPrompt, repositoryOwner, repositoryName]);

  async function create() {
    const value = objective.trim();
    if (!value || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const endpoint = repositoryMode ? `/api/github/repositories/${encodeURIComponent(repositoryOwner!)}/${encodeURIComponent(repositoryName!)}/tasks` : "/api/tasks";
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: value }) }));
      setTask(data.task); cacheTaskSnapshot(data.task);
      const nextUrl = data.task.repository ? `/tasks?owner=${encodeURIComponent(data.task.repository.owner)}&repo=${encodeURIComponent(data.task.repository.repo)}&id=${encodeURIComponent(data.task.id)}` : `/tasks?id=${encodeURIComponent(data.task.id)}`;
      window.history.replaceState({}, "", nextUrl); if (!data.task.repository) setRecent((current) => [data.task, ...current.filter((item) => item.id !== data.task.id && !item.repository)]);
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
        const stepEndpoint = current.repository ? `/api/github/repository-tasks/${encodeURIComponent(current.id)}/step` : `/api/tasks/${encodeURIComponent(current.id)}/step`;
        const stepRequest = current.repository
          ? fetch(stepEndpoint, { method: "POST" })
          : fetch(stepEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxSteps: 1, task: current }) });
        const data = await readApiResponse<{ task: TaskRecord }>(await stepRequest);
        current = data.task; setTask(current); cacheTaskSnapshot(current);
        const requestedStop = stopAfterStep.current;
        if (requestedStop) {
          stopAfterStep.current = null;
          const stopEndpoint = current.repository ? `/api/github/repository-tasks/${encodeURIComponent(current.id)}` : `/api/tasks/${encodeURIComponent(current.id)}`;
          const stopped = await readApiResponse<{ task: TaskRecord }>(await fetch(stopEndpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: requestedStop }) }));
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
      const endpoint = task.repository ? `/api/github/repository-tasks/${encodeURIComponent(task.id)}` : `/api/tasks/${encodeURIComponent(task.id)}`;
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value, value: target }) }));
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
  const history = recent.filter((item) => !item.repository && item.id !== task?.id).slice(0, 6);
  const canRun = Boolean(task && ["queued", "planning", "running", "paused", "failed"].includes(task.status));
  const controlLocked = Boolean(task && ["completed", "cancelled"].includes(task.status));

  const stateTone = !task ? "" : task.status === "completed" ? "on" : task.status === "waiting_approval" || task.status === "paused" ? "na" : task.status === "failed" ? "bad" : task.status === "cancelled" ? "" : "busy";
  const loadingTask = Boolean(requestedId && !task && !error);
  const mainArtifact = task?.artifacts[0];

  return <AppShell title="Workbench" back="/tasks">
    <main className="el-page v5-wb">
      <header className="el-page-head v5-wb-head">
        <div><h1>Workbench</h1><p>Plan a task step by step. Approvals, files and checkpoints stay with it.</p></div>
        {task ? <button type="button" className="el-btn el-btn-sm" onClick={() => { router.push("/tasks?view=workbench"); setTask(null); setObjective(""); setError(""); setNotice(""); }}><Plus size={15} /> New</button> : null}
      </header>

      {loadingTask ? <section className="el-section" aria-busy="true" aria-label="Loading task"><ListSkeleton rows={4} /></section> : null}

      {!task && !requestedId ? <section className="el-section">
        <form className="el-card v5-wb-start" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          {repositoryMode ? <div className="el-hint"><LockKeyhole size={15} /><span><strong>{repositoryOwner}/{repositoryName}</strong><br />Elias reads a text snapshot. Edits stay isolated until you approve an exact commit and pull request.</span></div> : null}
          <label className="el-field" htmlFor="task-start-input"><span>{repositoryMode ? "What should change in this repository?" : "What do you want done?"}</span>
            <textarea id="task-start-input" value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} maxLength={20000} placeholder="Describe the outcome. Elias makes a plan you can review first." onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void create(); } }} />
          </label>
          <button type="submit" className="el-btn el-btn-primary el-btn-lg" disabled={!objective.trim() || busy}>{busy ? <LoaderCircle size={16} className="el-spin" /> : <Send size={16} />} {busy ? "Making a plan…" : "Make a plan"}</button>
        </form>
        {!objective.trim() ? <div className="v5-wb-examples" aria-label="Examples">
          {[["Audit a project", "Audit this project, explain the highest-risk issues, and create a prioritized fix plan."], ["Research with sources", "Research the current best practices for Next.js App Router caching and cite primary sources."], ["Write a document", "Create a technical architecture document for a reliable autonomous coding agent."]].map(([label, text]) => <button type="button" key={label} className="el-chip" onClick={() => setObjective(text)}><ChevronRight size={16} /> {label}</button>)}
        </div> : null}
      </section> : null}

      {task ? <>
        <section className="el-section">
          <div className="el-card v5-wb-focus">
            <div className="v5-wb-title"><h2>{task.title || "Untitled task"}</h2><span className={`el-state v5-wb-state ${stateTone}`}>{task.status === "completed" ? <Check size={13} /> : task.status === "waiting_approval" ? <ShieldCheck size={13} /> : task.status === "paused" ? <Pause size={13} /> : task.status === "failed" ? <AlertCircle size={13} /> : ["planning", "running"].includes(task.status) ? <LoaderCircle size={13} className="el-spin" /> : null}{statusLabel(task.status)}</span></div>
            <p className="el-muted">{statusDetail(task.status)}</p>
            <div className="v5-wb-progress"><div><strong>{completed} of {total} steps</strong><span>{progress}%</span></div><div className="v5-wb-meter" role="progressbar" aria-label="Task plan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div></div>
            <details className="v5-wb-request"><summary>Original request</summary><p>{task.objective}</p></details>
            <div className="v5-wb-actions"><button type="button" className="el-btn el-btn-primary" disabled={busy || !canRun || Boolean(pendingApproval)} onClick={() => void run()}>{busy ? <LoaderCircle size={16} className="el-spin" /> : task.status === "failed" ? <RotateCcw size={16} /> : task.status === "completed" ? <CheckCircle2 size={16} /> : task.status === "cancelled" ? <Square size={14} /> : <Play size={16} />}{busy ? "Working…" : task.status === "completed" ? "Done" : task.status === "cancelled" ? "Cancelled" : task.status === "failed" ? "Retry" : task.status === "paused" ? "Resume" : task.status === "queued" ? "Start" : task.status === "waiting_approval" ? "Waiting on you" : "Continue"}</button>{task.repository ? <a className="el-btn" href={task.repository.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> GitHub</a> : <Link className="el-btn" href={`/agent?task=${encodeURIComponent(task.id)}`}><ExternalLink size={15} /> Open workspace</Link>}</div>
          </div>
        </section>

        {task.error ? <section className="el-error-card v5-wb-alert" role="alert"><CircleAlert size={18} /><div><strong>This task needs attention</strong><small>{task.error}</small></div>{canRun ? <button type="button" className="el-btn" disabled={busy} onClick={() => void run()}><RotateCcw size={15} /> Retry</button> : null}</section> : null}

        {pendingApproval ? <section className="el-approval v5-wb-approval" aria-labelledby="approval-title"><div className="el-approval-head"><LockKeyhole size={17} /><strong id="approval-title">Elias needs your OK</strong></div><div className="el-approval-body"><p className="v5-wb-q">{pendingApproval.question}</p><small className="el-muted">Allowing lets Elias {permissionLabel(pendingApproval.permission)} for this task.</small></div><div className="el-approval-actions"><button type="button" className="el-btn el-btn-primary" disabled={busy} onClick={() => void action("approve", pendingApproval.id)}><Check size={15} /> Allow</button><button type="button" className="el-btn" disabled={busy} onClick={() => void action("reject", pendingApproval.id)}>Decline</button></div></section> : null}

        {mainArtifact ? <section className="el-section"><h2>Ready</h2><div className="el-card v5-wb-file"><div className="el-card-compact"><FileArchive size={20} /><span><strong className="v5-wb-ellipsis">{mainArtifact.name}</strong><small>{mainArtifact.type || "Generated file"}{mainArtifact.size ? ` · ${Math.max(1, Math.round(mainArtifact.size / 1024))} KB` : ""}</small></span></div>{mainArtifact.preview ? <p className="v5-wb-preview">{mainArtifact.preview.slice(0, 320)}{mainArtifact.preview.length > 320 ? "…" : ""}</p> : null}<div className="v5-wb-actions"><a className="el-btn el-btn-primary" href={artifactHref(task.id, mainArtifact)} download={mainArtifact.name}><Download size={15} /> Download</a><button className="el-btn" type="button" onClick={() => void shareArtifact(mainArtifact)}><Share2 size={15} /> {copiedArtifact === mainArtifact.id ? "Link copied" : "Copy link"}</button></div><span className="v5-sr" aria-live="polite">{copiedArtifact === mainArtifact.id ? "Artifact link copied to clipboard." : ""}</span></div></section> : null}

        <section className="el-section"><h2>Plan</h2>
          {task.plan.length ? <ol className="el-list v5-wb-steps" aria-label="Task plan">{task.plan.map((step, index) => { const tone = step.status === "completed" ? "done" : step.status === "active" ? "running" : step.status === "failed" ? "failed" : ""; const evidenceCount = step.evidenceEventIds?.length || 0; return <li key={step.id} className="el-list-row static"><span className={`el-list-icon ${tone ? `el-job-${tone}` : ""}`}>{step.status === "completed" ? <Check size={16} /> : step.status === "failed" ? <AlertCircle size={16} /> : step.status === "active" ? <LoaderCircle size={16} className="el-spin" /> : <b>{index + 1}</b>}</span><span className="el-list-text"><strong className="el-wrap">{step.title}</strong>{step.description ? <small className="el-clamp">{step.description}</small> : null}<small>{stepStatusLabel(step.status)}{step.status !== "pending" ? ` · ${time(step.updatedAt)}` : ""}{evidenceCount ? <> · <a href="#task-activity">{evidenceCount} activity item{evidenceCount === 1 ? "" : "s"}</a></> : null}</small></span></li>; })}</ol> : <p className="el-empty-line"><Clock3 size={16} /> No plan yet. Tap Start and Elias will write one.</p>}
        </section>

        {task.repository ? <RepositoryTaskChanges task={task} /> : null}

        <section className="el-section" id="task-activity"><details className="v5-wb-fold"><summary><span>Activity</span><small>{task.events.length} item{task.events.length === 1 ? "" : "s"}</small><ChevronDown size={16} /></summary>
          {task.events.length ? <ul className="el-list v5-wb-events">{[...task.events].reverse().map((event) => <li key={event.id} className={`v5-wb-event ${event.status}`}><div className="v5-wb-event-head"><strong>{event.label}</strong><time>{time(event.createdAt)}</time></div>{event.detail ? <p>{event.detail}</p> : null}{event.evidence ? <details className="v5-wb-evidence"><summary>Recorded evidence</summary><pre>{typeof event.evidence.value === "string" ? event.evidence.value : JSON.stringify(event.evidence.value, null, 2)}</pre></details> : null}</li>)}</ul> : <p className="el-empty-line"><Clock3 size={16} /> No activity yet. Start the task to see each step here.</p>}
        </details></section>

        <section className="el-section"><details className="v5-wb-fold"><summary><span>Files &amp; checkpoints</span><small>{task.artifacts.length} file{task.artifacts.length === 1 ? "" : "s"} · {task.checkpoints.length} checkpoint{task.checkpoints.length === 1 ? "" : "s"}</small><ChevronDown size={16} /></summary>
          {task.artifacts.length ? <ul className="el-list">{task.artifacts.map((artifact) => <li key={artifact.id}><a className="el-list-row" href={artifactHref(task.id, artifact)} download={artifact.name}><span className="el-list-icon accent"><FileArchive size={16} /></span><span className="el-list-text"><strong>{artifact.name}</strong><small>{artifact.type}</small></span><Download size={16} className="el-list-trail" /></a></li>)}</ul> : <p className="el-empty-line"><FileArchive size={16} /> No files yet. Downloads appear here when Elias makes them.</p>}
          {task.checkpoints.length ? <ul className="el-list v5-wb-gap">{task.checkpoints.slice(-3).reverse().map((checkpoint) => <li key={checkpoint.id}><button type="button" className="el-list-row" disabled={busy} onClick={() => void action("restore_checkpoint", checkpoint.id)}><span className="el-list-icon"><Undo2 size={16} /></span><span className="el-list-text"><strong>{checkpoint.label}</strong><small>Restore this saved state</small></span><ChevronRight size={16} className="el-list-trail" /></button></li>)}</ul> : <p className="el-empty-line v5-wb-gap"><Undo2 size={16} /> No checkpoints yet.</p>}
        </details></section>

        <div className="v5-wb-controls"><button type="button" className="el-btn el-btn-sm" disabled={Boolean(stopAfterStep.current) || task.status === "paused" || controlLocked} onClick={() => void action("pause")}><Pause size={15} />{stopAfterStep.current === "pause" ? "Pausing…" : "Pause"}</button><button type="button" className="el-btn el-btn-sm el-btn-danger" disabled={Boolean(stopAfterStep.current) || controlLocked} onClick={() => void action("cancel")}><Square size={13} />{stopAfterStep.current === "cancel" ? "Cancelling…" : "Cancel"}</button>{task.checkpoints.length ? <button type="button" className="el-btn el-btn-sm" disabled={busy} onClick={() => void action("restore_checkpoint", task.checkpoints.at(-1)?.id)}><RotateCcw size={15} /> Restore latest</button> : null}</div>
      </> : null}

      {error ? <section className="el-error-card v5-wb-alert" role="alert"><CircleAlert size={18} /><div><strong>{task ? "That didn't go through" : "Couldn't load this task"}</strong><small>{error}</small></div>{task && canRun ? <button type="button" className="el-btn" disabled={busy} onClick={() => void run()}><RotateCcw size={15} /> Retry</button> : !task && requestedId ? <button type="button" className="el-btn" onClick={() => { setError(""); void loadTask(requestedId); }}><RotateCcw size={15} /> Retry</button> : null}</section> : null}
      {notice ? <div className="el-notice ok v5-wb-alert" role="status"><CheckCircle2 size={16} /><span>{notice}</span></div> : null}

      {history.length ? <section className="el-section"><h2>Recent</h2><ul className="el-list">{history.map((item) => <li key={item.id}><Link className="el-list-row" href={`/tasks?id=${encodeURIComponent(item.id)}`}><span className={`el-list-icon ${item.status === "completed" ? "el-job-done" : item.status === "failed" ? "el-job-failed" : item.status === "waiting_approval" ? "el-job-waiting_approval" : ["running", "planning"].includes(item.status) ? "el-job-running" : ""}`}><SquareKanban size={16} /></span><span className="el-list-text"><strong>{item.title || "Untitled task"}</strong><small>{statusLabel(item.status)} · {new Date(item.updatedAt).toLocaleDateString()}{item.approvals.some((approval) => approval.status === "pending") ? " · approval needed" : item.artifacts.length ? ` · ${item.artifacts.length} file${item.artifacts.length === 1 ? "" : "s"}` : ""}</small></span><ChevronRight size={16} className="el-list-trail" /></Link></li>)}</ul></section> : null}
    </main>
  </AppShell>;
}
