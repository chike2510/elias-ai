"use client";

import { Check, ChevronDown, Circle, ExternalLink, LoaderCircle, LockKeyhole, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import type { TaskRecord, TaskPlanStep, TaskEvent } from "@/lib/task";
import MarkdownMessage from "@/components/MarkdownMessage";

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
  const [expanded, setExpanded] = useState(false);
  const isRunning = task.status === "running" || task.status === "planning" || task.status === "queued";

  return (
    <section className={`goal-progress-card ${compact ? "compact" : ""} ${expanded ? "expanded" : "collapsed"}`} aria-label={`Goal progress: ${task.title}`}>
      <button type="button" className="goal-progress-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="goal-progress-header">
          <span>
            <span className="eyebrow">GOAL PROGRESS</span>
            <strong className="goal-progress-title">{task.title}</strong>
            <span className="goal-progress-summary">{active?.description || latest?.detail || `${completed} of ${task.plan.length} steps completed`}</span>
          </span>
          <span className="goal-progress-header-right"><strong className={`goal-progress-status ${task.status}`}>{task.status.replaceAll("_", " ")}</strong><ChevronDown size={16} className={`goal-progress-chevron ${expanded ? "open" : ""}`} /></span>
        </span>
      </button>
      <div className="goal-progress-meter" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
      <div className="goal-progress-count">{isRunning ? <LoaderCircle size={12} className="goal-progress-spinner" /> : null}{completed}/{task.plan.length} steps · {progress}%</div>
      {expanded ? <div className="goal-progress-tree">
        {task.plan.map((step) => {
          const events = stepEvents(task, step.id);
          return <article className={`goal-step ${step.status}`} key={step.id}>
            <div className="goal-step-marker">{stepIcon(step)}</div>
            <div className="goal-step-content">
              <div className="goal-step-title"><strong>{step.title}</strong>{step.requires ? <small>{step.requires}</small> : null}</div>
              {!compact ? <p>{step.description}</p> : null}
              {events.length ? <div className="goal-step-events">{events.map((event) => <div className="goal-step-event" key={event.id}><span>{event.kind === "tool" ? "↗" : "•"}</span><span className="goal-step-event-text"><MarkdownMessage content={eventSummary(event)} taskId={task.id} /></span>{event.evidence?.type === "url" && typeof event.evidence.value === "string" ? <a href={event.evidence.value} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink size={12} /></a> : null}</div>)}</div> : null}
            </div>
          </article>;
        })}
      </div> : null}
      {task.status === "waiting_approval" ? <div className="goal-approval-note"><LockKeyhole size={14} /> Waiting for your approval before continuing.</div> : null}
      {task.status === "failed" ? <div className="goal-failure-note"><X size={14} /> {task.error || "This task encountered an error."}{onRetry ? <button type="button" onClick={onRetry}><RotateCcw size={13} /> Retry</button> : null}</div> : null}
    </section>
  );
}
