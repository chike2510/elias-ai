"use client";

import Link from "next/link";
import { BookOpenCheck, CheckCircle2, ChevronDown, Copy, ExternalLink, Hourglass, LoaderCircle, MessageCircle, Search, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import NotificationPrompt from "@/components/NotificationPrompt";
import type { Job } from "@/components/screens/JobsSection";
import { api, userTimezone } from "@/lib/chatClient";
import { parseReport, type ReportSource, type ResearchReport } from "@/lib/research";

const ACTIVE = new Set<Job["status"]>(["queued", "running", "waiting_approval"]);
const STATUS: Record<Job["status"], string> = { queued: "Queued", running: "Researching", waiting_approval: "Needs your OK", done: "Report ready", failed: "Couldn't finish", cancelled: "Cancelled" };
const IDEAS = ["Best budget Android phones in Nigeria right now, with prices", "Is solar cheaper than a generator for a 2-bedroom flat in Lagos?", "What changed in the latest Next.js release?"];

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Renders "text [1, 2]" with the citation numbers as links to the source list. */
function Cited({ text, sources, jobId }: { text: string; sources: ReportSource[]; jobId: string }) {
  const parts = text.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
  return <>{parts.map((part, index) => {
    const nums = part.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/)?.[1].split(/\s*,\s*/).map(Number);
    if (!nums) return <span key={index}>{part}</span>;
    return <sup key={index} className="v4r-cite">{nums.map((n, i) => {
      const source = sources.find((item) => item.n === n);
      return source ? <a key={i} href={`#src-${jobId}-${n}`} title={source.title}>{n}</a> : <span key={i}>{n}</span>;
    })}</sup>;
  })}</>;
}

function ReportCard({ job, report }: { job: Job; report: ResearchReport }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(job.result || ""); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  }
  return <article className="v4r-report" aria-label={`Report: ${job.title}`}>
    {report.summary ? <section><h3>Summary</h3><p className="v4r-summary"><Cited text={report.summary} sources={report.sources} jobId={job.id} /></p></section> : null}
    {report.findings.length ? <section><h3>Key findings</h3><ul className="v4r-findings">{report.findings.map((item, index) => <li key={index}><Cited text={item} sources={report.sources} jobId={job.id} /></li>)}</ul></section> : null}
    {report.sources.length ? <section><h3>Sources</h3><ol className="v4r-sources">{report.sources.map((source) => <li key={`${source.n}-${source.url}`} id={`src-${job.id}-${source.n}`}>
      <a href={source.url} target="_blank" rel="noreferrer"><span className="v4r-src-n">{source.n}</span><span className="v4r-src-text"><strong>{source.title}</strong><small>{source.domain}{source.note ? ` · ${source.note}` : ""}</small></span><ExternalLink size={15} aria-hidden="true" /></a>
    </li>)}</ol></section> : <p className="el-fineprint">No sources were listed for this report.</p>}
    <div className="v4r-actions">
      <Link className="el-btn el-btn-sm" href={`/chat?id=${job.conversationId}`}><MessageCircle size={15} /> Ask a follow-up</Link>
      <button type="button" className="el-btn el-btn-sm el-btn-ghost" onClick={() => void copy()}><Copy size={15} /> {copied ? "Copied" : "Copy"}</button>
    </div>
  </article>;
}

/** /research: ask a question, Elias researches it in the background and returns a cited report card. */
export default function ResearchScreen() {
  const [question, setQuestion] = useState("");
  const [reports, setReports] = useState<Job[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ reports: Job[] }>("/api/assistant/research");
      setReports(data.reports); setError(null);
      setOpen((current) => current ?? data.reports.find((job) => job.status === "done")?.id ?? null);
    } catch (err) { setError((err as Error).message); }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (reports?.some((job) => ACTIVE.has(job.status))) timer.current = window.setTimeout(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [reports, load]);

  async function start(text = question) {
    if (text.trim().length < 4 || busy) return;
    setBusy(true); setError(null);
    try {
      const data = await api<{ report: Job }>("/api/assistant/research", { method: "POST", body: JSON.stringify({ question: text, timezone: userTimezone() }) });
      setQuestion(""); setOpen(data.report.id); await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function cancel(job: Job) {
    if (!window.confirm(`Stop researching “${job.title}”?`)) return;
    try { await api(`/api/assistant/jobs/${job.id}`, { method: "DELETE" }); await load(); } catch (err) { setError((err as Error).message); }
  }

  return <AppShell title="Research">
    <main className="el-page v4r-page">
      <header className="el-page-head"><h1>Research</h1><p>Ask a question. Elias searches, reads and cross-checks sources in the background, then hands you a short report with citations.</p></header>

      <form className="v4r-ask" onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <label className="el-field"><span>What should Elias look into?</span>
          <textarea rows={3} maxLength={1500} value={question} placeholder="e.g. Which Nigerian banks have the lowest transfer fees this year?" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void start(); } }} />
        </label>
        <button type="submit" className="el-btn el-btn-primary v4r-go" disabled={busy || question.trim().length < 4}>{busy ? <><LoaderCircle size={16} className="el-spin" /> Starting…</> : <><Search size={16} /> Research it</>}</button>
        <p className="el-fineprint">Usually takes a few minutes. You can leave this page; the report also lands in your chat.</p>
      </form>

      {error ? <p className="el-error-text" role="alert">{error}</p> : null}
      {reports?.some((job) => ACTIVE.has(job.status)) ? <NotificationPrompt reason="I'll let you know when your report is ready, even if Elias is closed." /> : null}

      <section className="el-section">
        <div className="el-section-head"><h2>Reports</h2></div>
        {!reports && !error ? <ListSkeleton rows={2} /> : null}
        {reports && !reports.length ? <div className="v4r-empty">
          <p className="el-empty-line"><BookOpenCheck size={16} /> No reports yet. Try one of these:</p>
          <div className="v4r-ideas">{IDEAS.map((idea) => <button key={idea} type="button" className="v4r-idea" onClick={() => setQuestion(idea)}>{idea}</button>)}</div>
        </div> : null}
        {reports?.length ? <ul className="el-list v4r-list">{reports.map((job) => {
          const expanded = open === job.id;
          const active = ACTIVE.has(job.status);
          const last = job.steps[job.steps.length - 1];
          const report = job.result ? parseReport(job.result) : null;
          return <li key={job.id} className="el-list-item">
            <button type="button" className="el-list-row v4r-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : job.id)}>
              <span className={`el-list-icon el-job-${job.status}`}>{job.status === "done" ? <CheckCircle2 size={17} /> : active ? (job.status === "queued" ? <Hourglass size={17} /> : <LoaderCircle size={17} className="el-spin" />) : <XCircle size={17} />}</span>
              <span className="el-list-text">
                <strong className="el-wrap">{job.title}</strong>
                <small>{STATUS[job.status]}{report?.sources.length ? ` · ${report.sources.length} sources` : ""} · {ago(job.updatedAt)}</small>
                {active && last ? <small className="el-clamp">{last.summary}</small> : null}
              </span>
              <ChevronDown size={18} className={expanded ? "el-rot" : ""} aria-hidden="true" />
            </button>
            {expanded ? <div className="v4r-detail">
              {report ? <ReportCard job={job} report={report} /> : null}
              {active ? <div className="v4r-progress">
                <ol className="el-job-steps">{job.steps.length ? job.steps.map((step, index) => <li key={index} className={step.ok ? "" : "bad"}><span>{step.summary}</span></li>) : <li><span>Starting shortly…</span></li>}</ol>
                <div className="v4r-actions">
                  {job.status === "waiting_approval" && job.workConversationId ? <Link className="el-btn el-btn-sm el-btn-primary" href={`/chat?id=${job.workConversationId}`}>Review what's waiting</Link> : null}
                  <button type="button" className="el-btn el-btn-sm el-btn-danger" onClick={() => void cancel(job)}>Stop</button>
                </div>
              </div> : null}
              {job.error ? <p className="el-error-text">{job.error}</p> : null}
              {!active && !report ? <div className="v4r-actions"><button type="button" className="el-btn el-btn-sm" onClick={() => void start(job.title)}>Try again</button></div> : null}
            </div> : null}
          </li>;
        })}</ul> : null}
      </section>
    </main>
  </AppShell>;
}
