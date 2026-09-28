"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpRight, BookOpen, CheckCircle2, ChevronRight, CircleAlert, Code2, FileText, Globe2, ListChecks, LoaderCircle, Send, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import { readApiResponse } from "@/lib/clientApi";
import { listCachedTaskSnapshots } from "@/lib/clientTask";
import type { TaskRecord, TaskStatus } from "@/lib/task";

const examples = [
  { label: "Review a codebase", icon: Code2, prompt: "Review this project, identify the highest-risk issues, and propose a prioritized fix plan." },
  { label: "Research a question", icon: Globe2, prompt: "Research the latest best practices for this topic and cite the strongest sources." },
  { label: "Create a deliverable", icon: FileText, prompt: "Prepare a concise technical brief with a clear recommendation and supporting evidence." },
];

function statusLabel(status: TaskStatus) {
  const labels: Record<TaskStatus, string> = {
    queued: "Ready to start",
    planning: "Planning",
    running: "In progress",
    waiting_approval: "Approval needed",
    paused: "Paused",
    completed: "Completed",
    failed: "Needs attention",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function taskProgress(task: TaskRecord) {
  return task.plan.length ? Math.round((task.plan.filter((step) => step.status === "completed").length / task.plan.length) * 100) : 0;
}

export default function HomeScreen() {
  const [objective, setObjective] = useState("");
  const [recent, setRecent] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setRecent(listCachedTaskSnapshots().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3));
    void (async () => {
      try {
        const data = await readApiResponse<{ tasks?: TaskRecord[] }>(await fetch("/api/tasks", { cache: "no-store" }));
        if (!active) return;
        const cached = listCachedTaskSnapshots();
        setRecent([...cached, ...(data.tasks || [])]
          .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 3));
      } catch { /* recent tasks remain available from the local snapshot cache */ }
    })();
    return () => { active = false; };
  }, []);

  function startTask(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const value = objective.trim();
    if (!value || loading) return;
    setLoading(true);
    window.location.href = `/tasks?prompt=${encodeURIComponent(value)}`;
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      startTask();
    }
  }

  return <AppShell><main className="screen clean-home-screen task-first-home-screen">
    <div className="home-plan-badge"><span>ELIAS / TASK WORKSPACE</span><span>·</span><Link href="/profile">Customize</Link></div>
    <section className="clean-home-welcome task-home-welcome">
      <div className="clean-home-mark"><img src="/branding/elias-logo.png" alt="ELIAS" /></div>
      <span className="home-kicker">YOUR TASK WORKSPACE</span>
      <h1>What should Elias take care of?</h1>
      <p>Describe the outcome. Review the plan, follow real activity, and find the finished work in one place.</p>
    </section>

    <form className="task-home-composer" onSubmit={startTask}>
      <label htmlFor="task-objective">Describe the task</label>
      <textarea id="task-objective" value={objective} onChange={(event) => setObjective(event.target.value)} onKeyDown={handleComposerKeyDown} rows={3} maxLength={20000} placeholder="For example: Review this repository for the most important reliability risks and prepare a prioritized report." aria-describedby="task-entry-help" />
      <div className="task-home-composer-footer">
        <span id="task-entry-help">You’ll see the plan, progress, any approval requests, and deliverables here.</span>
        <button type="submit" className="primary" disabled={!objective.trim() || loading}>{loading ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}{loading ? "Opening task" : "Plan task"}</button>
      </div>
    </form>
    <div className="task-home-shortcut"><Sparkles size={14} /><span>Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to plan a task</span><span className="task-home-shortcut-separator">or choose an example</span></div>
    <nav className="task-example-row" aria-label="Task examples">{examples.map(({ label, icon: Icon, prompt }) => <button key={label} type="button" onClick={() => setObjective(prompt)}><Icon size={14} /><span>{label}</span><ChevronRight size={13} /></button>)}</nav>

    {recent.length ? <section className="home-recent-tasks" aria-labelledby="recent-tasks-title">
      <div className="home-recent-tasks-heading"><div><span className="home-section-heading">PICK UP WHERE YOU LEFT OFF</span><h2 id="recent-tasks-title">Recent tasks</h2></div><Link href="/tasks">All tasks <ArrowUpRight size={14} /></Link></div>
      <div className="home-recent-task-list">{recent.map((task) => <Link className="home-recent-task" href={`/tasks?id=${encodeURIComponent(task.id)}`} key={task.id}>
        <span className={`home-recent-task-icon ${task.status}`} aria-hidden="true">{task.status === "completed" ? <CheckCircle2 size={16} /> : task.status === "failed" ? <CircleAlert size={16} /> : <ListChecks size={16} />}</span>
        <span className="home-recent-task-copy"><strong>{task.title || "Untitled task"}</strong><small>{statusLabel(task.status)} · {task.plan.filter((step) => step.status === "completed").length} of {task.plan.length} steps complete</small><span className="home-recent-progress" role="progressbar" aria-label={`${task.title || "Task"} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskProgress(task)}><i style={{ width: `${taskProgress(task)}%` }} /></span></span>
        <ArrowUpRight size={15} className="home-recent-task-arrow" />
      </Link>)}</div>
    </section> : null}

    <section className="home-work-grid task-home-paths"><div className="home-section-heading"><span>CHOOSE A STARTING POINT</span><small>Each path opens a task you can track and revisit.</small></div><div className="home-work-cards">
      <button type="button" onClick={() => setObjective(examples[1].prompt)}><Globe2 size={18} /><strong>Research</strong><small>Find current sources and make sense of them.</small><ArrowUpRight size={14} /></button>
      <button type="button" onClick={() => setObjective(examples[0].prompt)}><Code2 size={18} /><strong>Build</strong><small>Review a project, fix a bug, or plan a feature.</small><ArrowUpRight size={14} /></button>
      <button type="button" onClick={() => setObjective("Teach me the fundamentals of this topic, then create a practical study plan with a short knowledge check.")}><BookOpen size={18} /><strong>Study</strong><small>Turn a topic into a practical learning plan.</small><ArrowUpRight size={14} /></button>
      <Link href="/tasks"><ListChecks size={18} /><strong>Task history</strong><small>Review plans, activity, approvals, and files.</small><ArrowUpRight size={14} /></Link>
    </div></section>
    <section className="home-recent-strip task-home-library"><div><span className="home-section-heading">YOUR WORK, TOGETHER</span><p>Generated files stay attached to the task that created them.</p></div><Link href="/files">Open Library <FileText size={14} /></Link></section>
  </main></AppShell>;
}
