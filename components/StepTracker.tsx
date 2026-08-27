"use client";

import { AlertCircle, Check, CheckCircle2, ChevronRight, Clock3, FileText, Pencil, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface Step {
  id: string;
  label: string;
  icon: "edit" | "file" | "check" | "search";
  status: "pending" | "complete" | "error";
}

export interface StepTrackerProps {
  summary: string;
  steps: Step[];
  status: "in-progress" | "complete" | "interrupted";
}

function stepIcon(icon: Step["icon"], status: Step["status"]) {
  if (status === "error") return <AlertCircle size={16} />;
  if (icon === "edit") return <Pencil size={15} />;
  if (icon === "file") return <FileText size={15} />;
  if (icon === "search") return <Search size={15} />;
  return <CheckCircle2 size={15} />;
}

function statusIcon(status: StepTrackerProps["status"]) {
  if (status === "in-progress") return <Clock3 size={15} className="step-tracker-status-spin" />;
  if (status === "interrupted") return <AlertCircle size={15} />;
  return <Check size={16} />;
}

function statusLabel(status: StepTrackerProps["status"]) {
  if (status === "interrupted") return "Response was interrupted.";
  if (status === "complete") return "Completed";
  return "In progress";
}

export default function StepTracker({ summary, steps, status }: StepTrackerProps) {
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const completed = steps.filter((step) => step.status === "complete").length;
  const stepCount = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  const displaySummary = status === "interrupted" ? "Response was interrupted." : summary;

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
      <span className="step-tracker-collapsed-copy"><span className="step-tracker-summary">{displaySummary}</span><span className="step-tracker-count" aria-live="polite">{stepCount}</span></span>
      <ChevronRight size={15} className="step-tracker-chevron" aria-hidden="true" />
    </button>
    {expanded ? <div className="step-tracker-backdrop" role="presentation" onMouseDown={() => setExpanded(false)}>
      <section className="step-tracker-sheet" role="dialog" aria-modal="true" aria-labelledby="step-tracker-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="step-tracker-drag-handle" aria-hidden="true" />
        <header className="step-tracker-sheet-header"><button ref={closeRef} type="button" className="step-tracker-close" onClick={() => setExpanded(false)} aria-label="Close Summary"><X size={19} /></button><h2 id="step-tracker-title">Summary</h2><span className={`step-tracker-sheet-status step-tracker-${status}`}>{statusIcon(status)}<span>{statusLabel(status)}</span></span></header>
        <div className="step-tracker-sheet-body"><p className="step-tracker-expanded-summary">{displaySummary}</p><div className="step-tracker-progress-caption"><span>{stepCount}</span><span>{status === "in-progress" ? `${completed} complete` : status === "complete" ? "All steps complete" : "Stopped before completion"}</span></div><ol className="step-tracker-steps">{steps.map((step, index) => <li className={`step-tracker-step step-tracker-step-${step.status}`} key={step.id}><span className="step-tracker-step-icon" aria-hidden="true">{stepIcon(step.icon, step.status)}</span><span className="step-tracker-step-copy"><strong>{step.label}</strong><small>{step.status === "complete" ? "Complete" : step.status === "error" ? "Needs attention" : "Pending"}</small></span><span className="step-tracker-step-number">{index + 1}</span></li>)}</ol>{status === "interrupted" ? <div className="step-tracker-interrupted-note"><AlertCircle size={15} /><span>Response was interrupted. You can review the completed steps and continue from the task workspace.</span></div> : null}</div>
      </section>
    </div> : null}
  </>;
}
