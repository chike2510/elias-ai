"use client";

import { ArrowUpRight, Lightbulb, ShieldAlert, Sparkles } from "lucide-react";
import MarkdownMessage from "@/components/MarkdownMessage";
import { safeSuggestedReplies } from "@/lib/chatResponse";

type Props = {
  content: string;
  taskId?: string;
  recommendation?: string;
  reasons?: string[];
  risks?: string[];
  suggestedReplies?: string[];
  busy?: boolean;
  onSelectReply: (index: number) => void;
};

export default function StructuredChatResponse({ content, taskId, recommendation, reasons, risks, suggestedReplies, busy = false, onSelectReply }: Props) {
  const choices = safeSuggestedReplies(suggestedReplies);
  const hasStructure = Boolean(recommendation || reasons?.length || risks?.length || choices.length);
  if (!hasStructure) return <MarkdownMessage content={content} taskId={taskId} />;

  return <div className="assistant-structured-response">
    {recommendation ? <aside className="assistant-recommendation-card" aria-label="Recommendation">
      <div className="assistant-structure-heading"><span><Lightbulb size={14} /> Recommendation</span><Sparkles size={14} /></div>
      <p>{recommendation}</p>
    </aside> : null}
    <MarkdownMessage content={content} taskId={taskId} />
    {reasons?.length ? <section className="assistant-rationale" aria-label="Why this recommendation">
      <strong>Why it fits</strong>
      <ul>{reasons.slice(0, 4).map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
    </section> : null}
    {risks?.length ? <section className="assistant-risks" aria-label="Risks and trade-offs">
      <strong><ShieldAlert size={13} /> Watch-outs</strong>
      <ul>{risks.slice(0, 3).map((risk, index) => <li key={`${index}-${risk}`}>{risk}</li>)}</ul>
    </section> : null}
    {choices.length ? <nav className="assistant-reply-choices" aria-label="Suggested next steps">
      <span>Take this further</span>
      <div>{choices.map((choice, index) => <button key={`${index}-${choice}`} type="button" disabled={busy} aria-label={`Send suggested reply: ${choice}`} onClick={() => onSelectReply(index)}>{choice}<ArrowUpRight size={13} /></button>)}</div>
    </nav> : null}
  </div>;
}
