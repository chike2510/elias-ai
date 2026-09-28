"use client";

import { AlertCircle, Check, CheckCircle2, ChevronRight, Clock3, FileText, Pause, Pencil, Play, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface Step {
  id: string;
  label: string;
  icon: "edit" | "file" | "check" | "search";
  status: "pending" | "active" | "complete" | "error";
}

export interface StepTrackerProps {
  summary: string;
  steps: Step[];
  status: "ready" | "in-progress" | "complete" | "interrupted" | "waiting" | "paused";
}

function stepIcon(icon: Step["icon"], status: Step["status"]) {
  if (status === "error") return <AlertCircle size={16} />;
  if (status === "active") return <Clock3 size={16} className="step-tracker-status-spin" />;
  if (icon === "edit") return <Pencil size={15} />;
  if (icon === "file") return <FileText size={15} />;
  if (icon === "search") return <Search size={15} />;
  return <CheckCircle2 size={15} />;
}

function statusIcon(status: StepTrackerProps["status"]) {
  if (status === "ready") return <Play size={14} />;
  if (status === "in-progress") return <Clock3 size={15} className="step-tracker-status-spin" />;
  if (status === "waiting") return <ShieldCheck size={15} />;
  if (status === "paused") return <Pause size={15} />;
  if (status === "interrupted") return <AlertCircle size={15} />;
  return <Check size={16} />;
}

function statusLabel(status: StepTrackerProps["status"]) {
  if (status === "ready") return "Ready to start";
  if (status === "waiting") return "Waiting for approval";
  if (status === "paused") return "Paused";
  if (status === "interrupted") return "Stopped before completion";
  if (status === "complete") return "Completed";
  return "In progress";
}

export default function StepTracker({ summary, steps, status }: StepTrackerProps) {
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const completed = steps.filter((step) => step.status === "complete").length;
  const stepCount = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  const progress = steps.length ? Math.round((completed / steps.length) * 100) : 0;

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [expanded]);

  return <>
    <button type="button" className={`step-tracker-collapsed step-tracker-${status}`} aria-expanded={expanded} aria-haspopup="dialog" onClick={() => setExpanded(true)}>
      <span className="step-tracker-status-icon" aria-hidden="true">{statusIcon(status)}</span>
      <span className="step-tracker-collapsed-copy"><span className="step-tracker-summary">{summary}</span><span className="step-tracker-count" aria-live="polite">{stepCount} · {statusLabel(status)}</span></span>
      <ChevronRight size={15} className="step-tracker-chevron" aria-hidden="true" />
    </button>
    {expanded ? <div className="step-tracker-backdrop" role="presentation" onMouseDown={() => setExpanded(false)}>
      <section className="step-tracker-sheet" role="dialog" aria-modal="true" aria-labelledby="step-tracker-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="step-tracker-drag-handle" aria-hidden="true" />
        <header className="step-tracker-sheet-header"><button ref={closeRef} type="button" className="step-tracker-close" onClick={() => setExpanded(false)} aria-label="Close task summary"><X size={19} /></button><h2 id="step-tracker-title">Task summary</h2><span className={`step-tracker-sheet-status step-tracker-${status}`}>{statusIcon(status)}<span>{statusLabel(status)}</span></span></header>
        <div className="step-tracker-sheet-body"><p className="step-tracker-expanded-summary">{summary}</p><div className="step-tracker-progress-caption"><span>{stepCount}</span><span>{completed} of {steps.length} complete</span></div><div className="step-tracker-modal-progress" role="progressbar" aria-label="Task plan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div><ol className="step-tracker-steps">{steps.map((step, index) => <li className={`step-tracker-step step-tracker-step-${step.status}`} key={step.id}><span className="step-tracker-step-icon" aria-hidden="true">{stepIcon(step.icon, step.status)}</span><span className="step-tracker-step-copy"><strong>{step.label}</strong><small>{step.status === "complete" ? "Complete" : step.status === "active" ? "In progress" : step.status === "error" ? "Needs attention" : "Pending"}</small></span><span className="step-tracker-step-number">{index + 1}</span></li>)}</ol>{status === "interrupted" ? <div className="step-tracker-interrupted-note"><AlertCircle size={15} /><span>This task stopped before all planned steps were complete. Review the latest activity and retry when you’re ready.</span></div> : status === "waiting" ? <div className="step-tracker-interrupted-note"><ShieldCheck size={15} /><span>Work is paused until you approve or decline the request in the task workspace.</span></div> : status === "paused" ? <div className="step-tracker-interrupted-note"><Pause size={15} /><span>The task is paused. You can resume it from the task workspace.</span></div> : null}</div>
      </section>
    </div> : null}
  </>;
}
