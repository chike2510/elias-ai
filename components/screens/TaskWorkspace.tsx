"use client";

import Link from "next/link";
import { Check, ChevronRight, CircleAlert, ClipboardCheck, FileArchive, LoaderCircle, LockKeyhole, Pause, Play, RotateCcw, Send, ShieldCheck, Sparkles, Square, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { readApiResponse } from "@/lib/clientApi";
import { cacheTaskSnapshot, getCachedTaskSnapshot, listCachedTaskSnapshots } from "@/lib/clientTask";
import type { TaskArtifactRef, TaskRecord, TaskStatus } from "@/lib/task";

function time(value: number) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function statusLabel(status: TaskStatus | string) { return status.replaceAll("_", " "); }
function artifactHref(taskId: string, artifact: TaskArtifactRef) {
  if (artifact.content !== undefined) {
    if (artifact.encoding === "base64") return `data:${artifact.type};base64,${artifact.content}`;
    return `data:${artifact.type},${encodeURIComponent(artifact.content)}`;
  }
  return `/api/tasks/${encodeURIComponent(taskId)}/artifact/${encodeURIComponent(artifact.id)}`;
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

  useEffect(() => { void loadRecent(); if (requestedId) void loadTask(requestedId); else setTask(null); }, [requestedId]);

  async function create() {
    const value = objective.trim();
    if (!value || busy) return;
    setBusy(true); setError("");
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: value }) }));
      setTask(data.task); cacheTaskSnapshot(data.task); window.history.replaceState({}, "", `/tasks?id=${encodeURIComponent(data.task.id)}`); setRecent((current) => [data.task, ...current.filter((item) => item.id !== data.task.id)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task could not be created."); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!task || busy || task.status === "cancelled") return;
    setBusy(true); setError("");
    try {
      let current = task;
      for (let count = 0; count < 12; count += 1) {
        const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(current.id)}/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxSteps: 1, task: current }) }));
        current = data.task; setTask(current); cacheTaskSnapshot(current);
        if (!["queued", "planning", "running"].includes(current.status)) break;
      }
      await loadRecent();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task execution failed."); }
    finally { setBusy(false); }
  }

  async function action(value: "pause" | "cancel" | "approve" | "reject" | "restore_checkpoint", target?: string) {
    if (!task) return;
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value, value: target }) }));
      setTask(data.task); cacheTaskSnapshot(data.task); if (value === "approve") void run();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task action failed."); }
  }

  const completed = task?.plan.filter((step) => step.status === "completed").length || 0;
  const total = task?.plan.length || 0;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const pendingApproval = task?.approvals.find((approval) => approval.status === "pending");
  const history = recent.filter((item) => item.id !== task?.id).slice(0, 6);

  return <AppShell title="Tasks">
    <main className="screen task-workspace-screen workspace-destination">
      <header className="screen-header task-workspace-header task-mock-header">
        <div className="screen-header-copy"><span className="eyebrow">WORKSPACE</span><h1>Tasks</h1><p className="screen-description">Outcomes, approvals, and deliverables stay together.</p></div>
        <button type="button" className="secondary task-filter" onClick={() => { window.history.pushState({}, "", "/tasks"); setTask(null); setObjective(""); }}>All tasks <ChevronRight size={15} /></button>
      </header>

      {!task ? <section className="task-start-guide panel quiet-card"><div className="task-start-mark"><Sparkles size={25} /></div><h2>What do you want done?</h2><p>Give Elias the outcome. It will create the steps.</p><textarea className="task-start-input" value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} placeholder="Describe the outcome…" /><button type="button" className="primary task-start-button" disabled={!objective.trim() || busy} onClick={() => void create()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} {busy ? "Working" : "Start task"}</button><div className="task-examples"><button type="button" onClick={() => setObjective("Audit this project, explain the highest-risk issues, and create a prioritized fix plan.")}>Audit a project <ChevronRight size={14} /></button><button type="button" onClick={() => setObjective("Research the current best practices for Next.js App Router caching and cite primary sources.")}>Research with evidence <ChevronRight size={14} /></button><button type="button" onClick={() => setObjective("Create a technical architecture document for a reliable autonomous coding agent.")}>Create a deliverable <ChevronRight size={14} /></button></div></section> : <>
        <section className="task-focus-card panel quiet-card">
          <div className="task-focus-head"><div><h2>{task.title || "Untitled task"}</h2><small>{task.kind} · {task.workspace.length} files</small></div><span className={`task-state-pill ${task.status}`}>{statusLabel(task.status)}</span></div>
          <div className="task-focus-progress-label"><strong>{progress}% complete</strong><span>{progress}%</span></div>
          <div className="task-progress task-focus-meter"><i style={{ width: `${progress}%` }} /></div>
          <div className="task-mock-timeline">{task.plan.map((step, index) => { const active = step.status === "active"; const complete = step.status === "completed"; return <div className={`task-mock-step ${complete ? "completed" : active ? "active" : "pending"}`} key={step.id}><span className="task-mock-marker">{complete ? <Check size={14} /> : active ? <span /> : index + 1}</span><div><strong>{index + 1}. {step.title}</strong><small>{complete ? "Complete" : active ? "In progress" : "Pending"}</small></div><time>{active || complete ? time(task.updatedAt) : "—"}</time></div>; })}</div>
          <div className="task-focus-actions"><button type="button" className="primary" disabled={busy || task.status === "completed" || task.status === "cancelled"} onClick={() => void run()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />} {busy ? "Working" : "Continue"}</button><Link className="secondary" href={`/agent?task=${encodeURIComponent(task.id)}`}>Open workspace</Link></div>
        </section>

        {pendingApproval ? <section className="approval-card"><div><LockKeyhole size={17} /><div><strong>ELIAS is waiting for your approval</strong><p>{pendingApproval.question}</p></div></div><div className="approval-actions"><button type="button" className="primary" onClick={() => void action("approve", pendingApproval.id)}><Check size={14} /> approve</button><button type="button" className="secondary" onClick={() => void action("reject", pendingApproval.id)}>reject</button></div></section> : null}
        <section className="task-evidence-card panel quiet-card"><div className="workbench-section-head"><div><span className="eyebrow">EVIDENCE</span><h2>Activity</h2></div><span className="activity-count">{task.events.length}</span></div><div className="evidence-list">{task.events.length ? [...task.events].reverse().map((event) => <article className={`evidence-item ${event.status}`} key={event.id}><span className="evidence-line" /><div><div className="evidence-meta"><strong>{event.label}</strong><time>{time(event.createdAt)}</time></div>{event.detail ? <p>{event.detail}</p> : null}{event.evidence ? <pre>{typeof event.evidence.value === "string" ? event.evidence.value : JSON.stringify(event.evidence.value, null, 2)}</pre> : null}</div></article>) : <div className="task-empty"><Sparkles size={20} /><strong>No activity yet</strong><small>Continue the task and Elias will show the actual operations and evidence here.</small></div>}</div></section>
        <section className="task-delivery panel quiet-card"><div className="workbench-section-head"><div><span className="eyebrow">OUTPUT</span><h2>Files & checkpoints</h2></div><FileArchive size={17} /></div><div className="delivery-grid"><div><strong>{task.artifacts.length ? `${task.artifacts.length} artifact${task.artifacts.length === 1 ? "" : "s"}` : "No artifacts yet"}</strong><small>Created outputs stay associated with this task.</small>{task.artifacts.map((artifact) => <a className="task-artifact" key={artifact.id} href={artifactHref(task.id, artifact)}><FileArchive size={14} /><span>{artifact.name}</span><small>{artifact.type}</small></a>)}</div><div><strong>{task.checkpoints.length ? `${task.checkpoints.length} checkpoints` : "No checkpoints yet"}</strong><small>Workspace mutations are recorded before and after changes.</small>{task.checkpoints.slice(-3).reverse().map((checkpoint) => <button type="button" className="checkpoint-row" key={checkpoint.id} onClick={() => void action("restore_checkpoint", checkpoint.id)}><Undo2 size={13} /><span>{checkpoint.label}</span><ChevronRight size={13} /></button>)}</div></div></section>
        <div className="task-controls"><button type="button" className="secondary" disabled={busy || task.status === "completed" || task.status === "cancelled"} onClick={() => void action("pause")}><Pause size={14} /> pause</button><button type="button" className="secondary" disabled={busy || task.status === "cancelled"} onClick={() => void action("cancel")}><Square size={13} /> cancel</button>{task.checkpoints.length ? <button type="button" className="secondary" onClick={() => void action("restore_checkpoint", task.checkpoints.at(-1)?.id)}><RotateCcw size={14} /> restore latest</button> : null}</div>
      </>}

      {error ? <div className="inline-error"><CircleAlert size={15} />{error}</div> : null}
      {history.length ? <section className="recent-tasks task-history-section"><div className="workbench-section-head"><div><span className="eyebrow">HISTORY</span><h2>History</h2></div></div><div className="recent-task-list">{history.map((item) => <button type="button" key={item.id} onClick={() => { window.history.pushState({}, "", `/tasks?id=${encodeURIComponent(item.id)}`); void loadTask(item.id); }}><span className={`task-status-dot ${item.status}`} /><span><strong>{item.title}</strong><small>{statusLabel(item.status)} · {new Date(item.updatedAt).toLocaleDateString()}</small></span><span className="task-history-artifacts">{item.artifacts.length} artifacts</span><ChevronRight size={14} /></button>)}</div></section> : null}
    </main>
  </AppShell>;
}
