"use client";

import Link from "next/link";
import { Check, ChevronRight, CircleAlert, ClipboardCheck, FileArchive, LoaderCircle, LockKeyhole, Pause, Play, RotateCcw, Send, ShieldCheck, Sparkles, Square, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { readApiResponse } from "@/lib/clientApi";
import { cacheTaskSnapshot, getCachedTaskSnapshot, listCachedTaskSnapshots } from "@/lib/clientTask";
import type { TaskArtifactRef, TaskRecord, TaskStatus } from "@/lib/task";

function time(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: TaskStatus) {
  return status.replaceAll("_", " ");
}

function artifactHref(taskId: string, artifact: TaskArtifactRef) {
  if (artifact.content !== undefined) {
    if (artifact.encoding === "base64") return `data:${artifact.type};base64,${artifact.content}`;
    return `data:${artifact.type},${encodeURIComponent(artifact.content)}`;
  }
  return `/api/tasks/${encodeURIComponent(taskId)}/artifact/${encodeURIComponent(artifact.id)}`;
}

export default function TaskWorkspace() {
  const params = useMemo(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search), []);
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
    } catch {
      setRecent(listCachedTaskSnapshots());
    }
  }

  async function loadTask(id: string) {
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(id)}`, { cache: "no-store" }));
      setTask(data.task);
      cacheTaskSnapshot(data.task);
      setObjective(data.task.objective);
      setError("");
    } catch (caught) {
      const cached = getCachedTaskSnapshot(id);
      if (cached) {
        setTask(cached);
        setObjective(cached.objective);
        setError("Showing the cached task snapshot because the serverless task store is not available for this request.");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Task could not be loaded.");
    }
  }

  useEffect(() => {
    void loadRecent();
    if (requestedId) void loadTask(requestedId);
  }, [requestedId]);

  async function create() {
    const value = objective.trim();
    if (!value || busy) return;
    setBusy(true); setError("");
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: value }) }));
      setTask(data.task);
      cacheTaskSnapshot(data.task);
      window.history.replaceState({}, "", `/tasks?id=${encodeURIComponent(data.task.id)}`);
      setRecent((current) => [data.task, ...current.filter((item) => item.id !== data.task.id)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task could not be created.");
    } finally { setBusy(false); }
  }

  async function run() {
    if (!task || busy || task.status === "cancelled") return;
    setBusy(true); setError("");
    try {
      let current = task;
      for (let count = 0; count < 12; count += 1) {
        const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(current.id)}/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxSteps: 1 }) }));
        current = data.task;
        setTask(current);
        cacheTaskSnapshot(current);
        if (!["queued", "planning", "running"].includes(current.status)) break;
      }
      await loadRecent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task execution failed.");
    } finally { setBusy(false); }
  }

  async function action(value: "pause" | "cancel" | "approve" | "reject" | "restore_checkpoint", target?: string) {
    if (!task) return;
    try {
      const data = await readApiResponse<{ task: TaskRecord }>(await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value, value: target }) }));
      setTask(data.task);
      cacheTaskSnapshot(data.task);
      if (value === "approve") void run();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task action failed."); }
  }

  const completed = task?.plan.filter((step) => step.status === "completed").length || 0;
  const total = task?.plan.length || 0;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const pendingApproval = task?.approvals.find((approval) => approval.status === "pending");

  return (
    <AppShell title="Tasks">
      <main className="screen task-workspace-screen">
        <header className="task-workspace-header">
          <div><p className="eyebrow">ELIAS / task workspace</p><h1>{task?.title || "Start a task"}</h1><p className="task-subtitle">An objective, an evidence trail, and a deliverable you can verify.</p></div>
          <div className="task-header-actions"><span className="task-mode"><Sparkles size={13} /> multi-model</span><Link href="/chat">chat</Link></div>
        </header>

        <section className="task-objective panel">
          <div className="task-objective-label"><ClipboardCheck size={15} /> objective</div>
          <textarea value={objective} onChange={(event) => setObjective(event.target.value)} disabled={busy && Boolean(task)} rows={3} placeholder="Tell Elias the outcome you want, not just the next command…" />
          <div className="task-objective-actions"><small>{task ? `${task.kind} task · ${task.workspace.length} workspace files` : "Elias will turn this into a plan before acting."}</small><button type="button" className="primary" disabled={!objective.trim() || busy} onClick={() => task ? void run() : void create()}>{busy ? <LoaderCircle size={15} className="spin" /> : task ? <Play size={15} /> : <Send size={15} />}{busy ? "working…" : task ? "continue task" : "create task"}</button></div>
        </section>

        {error ? <div className="inline-error"><CircleAlert size={15} />{error}</div> : null}
        {pendingApproval ? <section className="approval-card"><div><LockKeyhole size={17} /><div><strong>ELIAS is waiting for your approval</strong><p>{pendingApproval.question}</p></div></div><div className="approval-actions"><button type="button" className="primary" onClick={() => void action("approve", pendingApproval.id)}><Check size={14} /> approve</button><button type="button" className="secondary" onClick={() => void action("reject", pendingApproval.id)}>reject</button></div></section> : null}

        {task ? <>
          <section className="task-status-row"><div className={`task-status-dot ${task.status}`} /><strong>{statusLabel(task.status)}</strong><span>{completed}/{total} steps</span><div className="task-progress"><i style={{ width: `${progress}%` }} /></div><small>{progress}%</small></section>
          <div className="task-grid">
            <section className="task-plan panel"><div className="workbench-section-head"><div><span className="eyebrow">plan</span><h2>How Elias will approach this</h2></div><ShieldCheck size={17} /></div><div className="plan-list">{task.plan.map((step, index) => <div className={`plan-step ${step.status}`} key={step.id}><span className="plan-index">{step.status === "completed" ? <Check size={13} /> : index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p>{step.evidenceEventIds.length ? <small>{step.evidenceEventIds.length} evidence event{step.evidenceEventIds.length === 1 ? "" : "s"}</small> : null}</div><span className="plan-state">{step.status}</span></div>)}</div></section>
            <section className="task-activity panel"><div className="workbench-section-head"><div><span className="eyebrow">evidence</span><h2>Live activity</h2></div><span className="activity-count">{task.events.length} events</span></div><div className="evidence-list">{task.events.length ? [...task.events].reverse().map((event) => <article className={`evidence-item ${event.status}`} key={event.id}><span className="evidence-line" /><div><div className="evidence-meta"><strong>{event.label}</strong><time>{time(event.createdAt)}</time></div>{event.detail ? <p>{event.detail}</p> : null}{event.evidence ? <pre>{typeof event.evidence.value === "string" ? event.evidence.value : JSON.stringify(event.evidence.value, null, 2)}</pre> : null}</div></article>) : <div className="task-empty"><Sparkles size={20} /><strong>No activity yet</strong><small>Start the task and Elias will show the actual operations and evidence here.</small></div>}</div></section>
          </div>
          <section className="task-delivery panel"><div className="workbench-section-head"><div><span className="eyebrow">delivery</span><h2>Artifacts and recovery</h2></div><FileArchive size={17} /></div><div className="delivery-grid"><div><strong>{task.artifacts.length ? `${task.artifacts.length} artifact${task.artifacts.length === 1 ? "" : "s"}` : "No artifacts yet"}</strong><small>Created outputs will be associated with this task.</small>{task.artifacts.map((artifact) => <a className="task-artifact" key={artifact.id} href={artifactHref(task.id, artifact)}><FileArchive size={14} /><span>{artifact.name}</span><small>{artifact.type}</small></a>)}</div><div><strong>{task.checkpoints.length ? `${task.checkpoints.length} checkpoints` : "No checkpoints yet"}</strong><small>Workspace mutations are recorded before and after changes.</small>{task.checkpoints.slice(-3).reverse().map((checkpoint) => <button type="button" className="checkpoint-row" key={checkpoint.id} onClick={() => void action("restore_checkpoint", checkpoint.id)}><Undo2 size={13} /><span>{checkpoint.label}</span><ChevronRight size={13} /></button>)}</div></div></section>
          <div className="task-controls"><button type="button" className="secondary" disabled={busy || task.status === "completed" || task.status === "cancelled"} onClick={() => void action("pause")}><Pause size={14} /> pause</button><button type="button" className="secondary" disabled={busy || task.status === "cancelled"} onClick={() => void action("cancel")}><Square size={13} /> cancel</button><Link className="secondary" href={`/agent?task=${encodeURIComponent(task.id)}`}><ChevronRight size={14} /> open coding workspace</Link>{task.checkpoints.length ? <button type="button" className="secondary" onClick={() => void action("restore_checkpoint", task.checkpoints.at(-1)?.id)}><RotateCcw size={14} /> restore latest</button> : null}</div>
        </> : <section className="task-start-guide panel"><div className="task-start-mark"><Sparkles size={25} /></div><h2>Start with the outcome.</h2><p>Ask Elias to investigate, build, compare, explain, refactor, or produce a deliverable. The system will create a plan, request permissions when needed, show evidence for each operation, and keep recovery checkpoints.</p><div className="task-examples"><button type="button" onClick={() => setObjective("Audit this project, explain the highest-risk issues, and create a prioritized fix plan.")}>Audit a project <ChevronRight size={14} /></button><button type="button" onClick={() => setObjective("Research the current best practices for Next.js App Router caching and cite primary sources.")}>Research with evidence <ChevronRight size={14} /></button><button type="button" onClick={() => setObjective("Create a technical architecture document for a reliable autonomous coding agent.")}>Create a deliverable <ChevronRight size={14} /></button></div></section>}

        {recent.length ? <section className="recent-tasks"><div className="workbench-section-head"><div><span className="eyebrow">history</span><h2>Recent tasks</h2></div><Link href="/projects">projects</Link></div><div className="recent-task-list">{recent.slice(0, 6).map((item) => <button type="button" className={task?.id === item.id ? "active" : ""} key={item.id} onClick={() => { window.history.pushState({}, "", `/tasks?id=${encodeURIComponent(item.id)}`); void loadTask(item.id); }}><span className={`task-status-dot ${item.status}`} /><span><strong>{item.title}</strong><small>{statusLabel(item.status)} · {new Date(item.updatedAt).toLocaleDateString()}</small></span><ChevronRight size={14} /></button>)}</div></section> : null}
      </main>
    </AppShell>
  );
}
