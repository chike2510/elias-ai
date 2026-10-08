"use client";

import Link from "next/link";
import { Copy, ExternalLink, FileSearch } from "lucide-react";
import { useState } from "react";
import { SiteIcon, SourcesCard } from "@/components/chat/SourcesCard";
import type { ReportSource, ResearchReport, ResearchReportCard } from "@/lib/research";

/** Renders "text [1, 2]" with the citation numbers as links to the source list. */
export function Cited({ text, sources, anchor }: { text: string; sources: ReportSource[]; anchor: string }) {
  const parts = text.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
  return <>{parts.map((part, index) => {
    const nums = part.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/)?.[1].split(/\s*,\s*/).map(Number);
    if (!nums) return <span key={index}>{part}</span>;
    return <sup key={index} className="v4r-cite">{nums.map((n, i) => {
      const source = sources.find((item) => item.n === n);
      return source ? <a key={i} href={`#src-${anchor}-${n}`} title={source.title}>{n}</a> : <span key={i}>{n}</span>;
    })}</sup>;
  })}</>;
}

function plainText(report: Pick<ResearchReport, "summary" | "findings" | "sources">) {
  return [
    report.summary,
    report.findings.length ? `Key findings\n${report.findings.map((item) => `- ${item}`).join("\n")}` : "",
    report.sources.length ? `Sources\n${report.sources.map((source) => `${source.n}. ${source.title} ${source.url}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Summary / Key findings / Sources, shared by the Research screen and the chat report card. */
export function ReportBody({ anchor, report, showSummary = true, copyText, actions }: { anchor: string; report: Pick<ResearchReport, "summary" | "findings" | "sources">; showSummary?: boolean; copyText?: string; actions?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(copyText || plainText(report)); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  }
  return <>
    {showSummary && report.summary ? <section><h3>Summary</h3><p className="v4r-summary"><Cited text={report.summary} sources={report.sources} anchor={anchor} /></p></section> : null}
    {report.findings.length ? <section><h3>Key findings</h3><ul className="v4r-findings">{report.findings.map((item, index) => <li key={index}><Cited text={item} sources={report.sources} anchor={anchor} /></li>)}</ul></section> : null}
    {report.sources.length ? <SourcesCard variant="inline" domains={report.sources.map((source) => source.domain || source.url)} count={report.sources.length} openOnHash={`src-${anchor}-`}><ol className="v4r-sources">{report.sources.map((source) => <li key={`${source.n}-${source.url}`} id={`src-${anchor}-${source.n}`}>
      <a href={source.url} target="_blank" rel="noreferrer"><span className="v4r-src-n">{source.n}</span><SiteIcon domain={source.domain || source.url} size={18} className="el-favicon el-favicon-sm" /><span className="v4r-src-text"><strong>{source.title}</strong><small>{source.domain}{source.note ? ` · ${source.note}` : ""}</small></span><ExternalLink size={15} aria-hidden="true" /></a>
    </li>)}</ol></SourcesCard> : <p className="el-fineprint">No sources were listed for this report.</p>}
    <div className="v4r-actions">{actions}<button type="button" className="el-btn el-btn-sm el-btn-ghost" onClick={() => void copy()}><Copy size={15} /> {copied ? "Copied" : "Copy"}</button></div>
  </>;
}

/** Chat card for a research job started from chat: the answer is the bubble above, this holds findings and sources. */
export function ResearchReportCardView({ card }: { card: ResearchReportCard }) {
  return <article className="v4r-report v5-report-card" aria-label={`Research report: ${card.title}`}>
    <header className="v5-report-head"><span className="v5-report-icon"><FileSearch size={16} /></span><span><small>Research report</small><strong>{card.title}</strong></span></header>
    <ReportBody anchor={card.jobId} report={card} showSummary={false} actions={<Link className="el-btn el-btn-sm" href="/research"><FileSearch size={15} /> All reports</Link>} />
  </article>;
}
