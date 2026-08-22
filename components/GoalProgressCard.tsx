"use client";

import { Check, Circle, ExternalLink, LoaderCircle, LockKeyhole, RotateCcw, X } from "lucide-react";
import type { TaskRecord, TaskPlanStep, TaskEvent } from "@/lib/task";

type GoalProgressCardProps = {
  task: TaskRecord;
  compact?: boolean;
  onRetry?: () => void;
};

function stepIcon(step: TaskPlanStep) {
  if (step.status === "completed") return <Check size={14} />;
  if (step.status === "failed") return <X size={14} />;
  if (step.status === "active") return <LoaderCircle className="goal-step-spin" size={14} />;
  return <Circle size={12} />;
}

function stepEvents(task: TaskRecord, stepId: string) {
  return task.events.filter((event) => event.stepId === stepId).slice(-3);
}

function eventSummary(event: TaskEvent) {
  return event.detail || event.label;
}

export default function GoalProgressCard({ task, compact = false, onRetry }: GoalProgressCardProps) {
  const completed = task.plan.filter((step) => step.status === "completed").length;
  const active = task.plan.find((step) => step.status === "active");
  const progress = task.plan.length ? Math.round((completed / task.plan.length) * 100) : 0;
  const latest = task.events.at(-1);

  return (
    <section className={`goal-progress-card ${compact ? "compact" : ""}`} aria-label={`Goal progress: ${task.title}`}>
      <header className="goal-progress-header">
        <div>
          <span className="eyebrow">GOAL PROGRESS</span>
          <h3>{task.title}</h3>
          <p>{active?.description || latest?.detail || `${completed} of ${task.plan.length} steps completed`}</p>
        </div>
        <strong className={`goal-progress-status ${task.status}`}>{task.status.replaceAll("_", " ")}</strong>
      </header>
      <div className="goal-progress-meter" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
      <div className="goal-progress-count">{completed}/{task.plan.length} steps · {progress}%</div>
      <div className="goal-progress-tree">
        {task.plan.map((step) => {
          const events = stepEvents(task, step.id);
          return <article className={`goal-step ${step.status}`} key={step.id}>
            <div className="goal-step-marker">{stepIcon(step)}</div>
            <div className="goal-step-content">
              <div className="goal-step-title"><strong>{step.title}</strong>{step.requires ? <small>{step.requires}</small> : null}</div>
              {!compact ? <p>{step.description}</p> : null}
              {events.length ? <div className="goal-step-events">{events.map((event) => <div className="goal-step-event" key={event.id}><span>{event.kind === "tool" ? "↗" : "•"}</span><span>{eventSummary(event)}</span>{event.evidence?.type === "url" && typeof event.evidence.value === "string" ? <a href={event.evidence.value} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink size={12} /></a> : null}</div>)}</div> : null}
            </div>
          </article>;
        })}
      </div>
      {task.status === "waiting_approval" ? <div className="goal-approval-note"><LockKeyhole size={14} /> Waiting for your approval before continuing.</div> : null}
      {task.status === "failed" ? <div className="goal-failure-note"><X size={14} /> {task.error || "This task encountered an error."}{onRetry ? <button type="button" onClick={onRetry}><RotateCcw size={13} /> Retry</button> : null}</div> : null}
    </section>
  );
}
