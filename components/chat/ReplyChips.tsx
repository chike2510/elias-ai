"use client";

import { CornerDownRight, Sparkles } from "lucide-react";

/**
 * Tap-to-send chips under the latest reply.
 * "choices" answer a question Elias just asked (quick replies); "followups" are suggested next messages.
 */
export default function ReplyChips({ items, kind, disabled, onPick }: { items: string[]; kind: "choices" | "followups"; disabled?: boolean; onPick: (text: string) => void }) {
  if (!items.length) return null;
  const label = kind === "choices" ? "Quick replies" : "Suggested follow-ups";
  return <div className={`el-reply-chips ${kind}`} role="group" aria-label={label}>
    {items.map((item) => <button type="button" key={item} className="el-reply-chip" disabled={disabled} onClick={() => onPick(item)}>
      {kind === "followups" ? <CornerDownRight size={14} aria-hidden="true" /> : null}<span>{item}</span>
    </button>)}
    {kind === "followups" ? <Sparkles className="el-reply-chips-mark" size={12} aria-hidden="true" /> : null}
  </div>;
}
