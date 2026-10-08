"use client";

import { CheckCircle2, CircleDashed, ExternalLink, GitBranch, GitMerge, GitPullRequest, XCircle } from "lucide-react";
import type { DiffCard as DiffCardData } from "@/lib/assistant/code/cards";
import { DiffView } from "@/components/code/DiffView";

/** Chat card for the coding agent: changed files with +/- stats and an expandable diff, commit, CI and PR state. */
export function DiffCard({ card }: { card: DiffCardData }) {
  const ci = card.ci;
  const CiIcon = !ci ? null : ci.status === "passed" ? CheckCircle2 : ci.status === "failed" ? XCircle : CircleDashed;
  return (
    <section className="el-card v4c-card" aria-label={card.title}>
      <div className="el-card-head">
        {card.pr ? (card.pr.merged ? <GitMerge size={14} /> : <GitPullRequest size={14} />) : <GitBranch size={14} />}
        <span>{card.title}</span>
        {card.files.length ? <span className="v4c-total"><b className="v4c-add">+{card.added}</b> <b className="v4c-del">−{card.removed}</b></span> : null}
      </div>
      {card.repo || card.branch ? <p className="v4c-meta">{card.repo}{card.branch ? <> · <code>{card.branch}</code></> : null}{card.base ? <> → <code>{card.base}</code></> : null}</p> : null}
      {card.files.length ? <DiffView files={card.files} diff={card.diff} /> : null}
      {ci && CiIcon ? (
        <div className={`v4c-ci v4c-ci-${ci.status}`}>
          <CiIcon size={16} aria-hidden />
          <span>{ci.status === "passed" ? "CI passed" : ci.status === "failed" ? `CI failed${ci.attempt ? ` · attempt ${ci.attempt}${ci.maxAttempts ? ` of ${ci.maxAttempts}` : ""}` : ""}` : ci.status === "running" ? "CI running" : "No CI run"}</span>
          {ci.url ? <a href={ci.url} target="_blank" rel="noreferrer">Logs</a> : null}
        </div>
      ) : null}
      {ci?.failure ? <pre className="v4c-log">{ci.failure}</pre> : null}
      <div className="v4c-links">
        {card.commit?.url ? <a href={card.commit.url} target="_blank" rel="noreferrer"><code>{card.commit.sha.slice(0, 7)}</code> <ExternalLink size={13} /></a> : null}
        {ci?.previewUrl ? <a href={ci.previewUrl} target="_blank" rel="noreferrer">Preview <ExternalLink size={13} /></a> : null}
        {card.pr ? <a href={card.pr.url} target="_blank" rel="noreferrer">PR #{card.pr.number} <ExternalLink size={13} /></a> : null}
      </div>
    </section>
  );
}
