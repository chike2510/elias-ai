"use client";

import Link from "next/link";
import { CheckCircle2, ChevronDown, CircleSlash, Hourglass, LoaderCircle, Rocket, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import MarkdownMessage from "@/components/MarkdownMessage";
import NotificationPrompt from "@/components/NotificationPrompt";
import { ListSkeleton } from "@/components/AppShell";
import { api, userTimezone } from "@/lib/chatClient";

type JobStep = { n: number; at: string; summary: string; tools: string[]; ok: boolean };
export type Job = {
  id: string; title: string; kind: "research" | "task"; prompt: string; status: "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";
  steps: JobStep[]; result: string | null; error: string | null; slices: number; maxSlices: number; conversationId: string; workConversationId: string | null;
  createdAt: string; updatedAt: string; finishedAt: string | null;
};

const ACTIVE = new Set(["queued", "running", "waiting_approval"]);
const LABEL: Record<Job["status"], string> = { queued: "Queued", running: "Working", waiting_approval: "Needs your OK", done: "Done", failed: "Failed", cancelled: "Cancelled" };

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "running") return <LoaderCircle size={17} className="el-spin" />;
  if (status === "queued") return <Hourglass size={17} />;
  if (status === "waiting_approval") return <ShieldCheck size={17} />;
  if (status === "done") return <CheckCircle2 size={17} />;
  if (status === "failed") return <XCircle size={17} />;
  return <CircleSlash size={17} />;
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Tasks → Jobs: hand work to the background, watch it live, cancel it, read the result.
 * `composer={false}` when the page has its own New task sheet; bump `reloadKey` to refetch after it starts a job.
 */
export default function JobsSection({ composer = true, reloadKey = 0, title = "Background jobs" }: { composer?: boolean; reloadKey?: number; title?: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"research" | "task">("research");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try { setJobs((await api<{ jobs: Job[] }>("/api/assistant/jobs")).jobs); setError(null); }
    catch (err) { setError((err as Error).message); }
  }, []);

  // Live status: poll every 4s while anything is active and the tab is visible.
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (jobs?.some((job) => ACTIVE.has(job.status))) timer.current = window.setTimeout(() => { if (document.visibilityState === "visible") void load(); else setJobs((current) => current ? [...current] : current); }, 4000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [jobs, load]);

  async function cancel(job: Job) {
    if (!window.confirm(`Cancel “${job.title}”?`)) return;
    try { await api(`/api/assistant/jobs/${job.id}`, { method: "DELETE" }); await load(); } catch (err) { setError((err as Error).message); }
  }

  async function start() {
    if (!prompt.trim()) return;
    setBusy(true); setError(null);
    try {
      await api("/api/assistant/jobs", { method: "POST", body: JSON.stringify({ prompt, kind, timezone: userTimezone() }) });
      setPrompt(""); setComposing(false); await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="el-section" id="jobs">
    <div className="el-section-head"><h2>{title}</h2>{composer && !composing ? <button type="button" className="el-btn el-btn-sm" onClick={() => setComposing(true)}><Rocket size={15} /> New job</button> : null}</div>
    {composing ? <form className="el-job-new" onSubmit={(event) => { event.preventDefault(); void start(); }}>
      <label className="el-field"><span>What should Elias work on?</span><textarea rows={3} value={prompt} maxLength={6000} placeholder="e.g. Compare the 3 best budget Android phones in Nigeria right now, with prices and where to buy" onChange={(event) => setPrompt(event.target.value)} /></label>
      <div className="el-seg" role="radiogroup" aria-label="Kind of job">
        {(["research", "task"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={kind === value} className={kind === value ? "on" : ""} onClick={() => setKind(value)}>{value === "research" ? "Deep research" : "Multi-step task"}</button>)}
      </div>
      <div className="el-editor-actions"><button type="button" className="el-btn" onClick={() => setComposing(false)}>Cancel</button><button type="submit" className="el-btn el-btn-primary" disabled={busy || !prompt.trim()}>{busy ? "Starting…" : "Start"}</button></div>
    </form> : null}
    {error ? <p className="el-error-text" role="alert">{error}</p> : null}
    {!jobs && !error ? <ListSkeleton rows={2} /> : null}
    {jobs && !jobs.length && !composing ? <p className="el-empty-line"><Rocket size={16} /> {composer ? "No background jobs yet. Ask in chat: “research this in the background and ping me”." : "Nothing running. Tap New task, or ask in chat: “research this in the background and ping me”."}</p> : null}
    {jobs?.some((job) => ACTIVE.has(job.status)) ? <NotificationPrompt reason="I'll let you know the moment your job is done, even if Elias is closed." /> : null}
    {jobs?.length ? <ul className="el-list">{jobs.map((job) => {
      const last = job.steps[job.steps.length - 1];
      const expanded = open === job.id;
      return <li key={job.id} className="el-list-item">
        <div className="el-list-row static">
          <span className={`el-list-icon el-job-${job.status}`}><StatusIcon status={job.status} /></span>
          <span className="el-list-text">
            <strong>{job.title}</strong>
            <small>{LABEL[job.status]}{ACTIVE.has(job.status) ? ` · step ${Math.min(job.slices + (job.status === "running" ? 1 : 0), job.maxSlices) || 1} of up to ${job.maxSlices}` : ""} · {ago(job.updatedAt)}</small>
            {last && ACTIVE.has(job.status) ? <small className="el-clamp">{last.summary}</small> : null}
          </span>
          <span className="el-list-actions">
            {ACTIVE.has(job.status) ? <button type="button" className="el-btn el-btn-sm el-btn-danger" onClick={() => void cancel(job)}>Cancel</button> : null}
            <button type="button" className="el-icon-btn" aria-expanded={expanded} aria-label={expanded ? `Hide ${job.title}` : `Show ${job.title}`} onClick={() => setOpen(expanded ? null : job.id)}><ChevronDown size={18} className={expanded ? "el-rot" : ""} /></button>
          </span>
        </div>
        {expanded ? <div className="el-job-detail">
          {job.status === "waiting_approval" && job.workConversationId ? <Link className="el-btn el-btn-primary" href={`/chat?id=${job.workConversationId}`}><ShieldCheck size={16} /> Review what's waiting</Link> : null}
          {job.result ? <div className="el-job-result"><MarkdownMessage content={job.result} /></div> : null}
          {job.error ? <p className="el-error-text">{job.error}</p> : null}
          {job.steps.length ? <ol className="el-job-steps">{job.steps.map((step, index) => <li key={index} className={step.ok ? "" : "bad"}><span>{step.summary}</span>{step.tools.length ? <small>{step.tools.join(" · ")}</small> : null}</li>)}</ol> : <p className="el-fineprint">Starting shortly…</p>}
          <div className="el-job-links">
            {job.result ? <Link className="el-btn el-btn-sm" href={`/chat?id=${job.conversationId}`}>Open in chat</Link> : null}
            {job.workConversationId ? <Link className="el-btn el-btn-sm el-btn-ghost" href={`/chat?id=${job.workConversationId}`}>See the work</Link> : null}
          </div>
        </div> : null}
      </li>;
    })}</ul> : null}
  </section>;
}
