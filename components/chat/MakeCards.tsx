"use client";

import { ArrowDownToLine, Code2, FileText, Maximize2, Minimize2, RotateCw } from "lucide-react";
import { useState } from "react";
import type { Card } from "@/lib/chatClient";

type ImageCard = Extract<Card, { kind: "image" }>;
type FileCard = Extract<Card, { kind: "file" }>;
type PreviewCard = Extract<Card, { kind: "preview" }>;

function size(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

const label = (name: string) => (name.split(".").pop() || "file").toUpperCase();

/** A generated image: shows in place, tap to open full size, with a download button. */
export function ImageResultCard({ card }: { card: ImageCard }) {
  return <figure className="el-card el-make-image">
    <a href={card.url} target="_blank" rel="noreferrer"><img src={card.url} alt={card.prompt} loading="lazy" /></a>
    <figcaption><span>{card.prompt}</span><a className="el-btn-sm" href={card.downloadUrl} download={card.name} aria-label="Download image"><ArrowDownToLine size={15} /></a></figcaption>
  </figure>;
}

/** A generated document (PDF, Word, slides...): name, type and size, opens or downloads. */
export function FileResultCard({ card }: { card: FileCard }) {
  return <section className="el-card el-make-file">
    <span className="el-make-file-icon"><FileText size={20} /></span>
    <span className="el-make-file-text"><strong>{card.name}</strong><small>{label(card.name)} · {size(card.size)}</small></span>
    <a className="el-btn-sm" href={card.url} download={card.name}><ArrowDownToLine size={15} /> Download</a>
  </section>;
}

/** A live app preview: the HTML runs in a sandboxed iframe (scripts on, no access to Elias's origin, cookies or storage). */
export function PreviewResultCard({ card }: { card: PreviewCard }) {
  const [full, setFull] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [run, setRun] = useState(0);
  return <section className={`el-card el-make-preview${full ? " full" : ""}`} aria-label={`${card.title} preview`}>
    <header><strong>{card.title}</strong><span className="el-make-preview-actions">
      <button type="button" onClick={() => setRun((value) => value + 1)} aria-label="Restart preview"><RotateCw size={15} /></button>
      <button type="button" onClick={() => setShowCode((value) => !value)} aria-label={showCode ? "Show preview" : "Show code"} aria-pressed={showCode}><Code2 size={15} /></button>
      <button type="button" onClick={() => setFull((value) => !value)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
    </span></header>
    {showCode ? <pre className="el-make-preview-code"><code>{card.html}</code></pre> : <iframe key={run} title={card.title} srcDoc={card.html} sandbox="allow-scripts allow-forms allow-modals allow-popups" referrerPolicy="no-referrer" loading="lazy" />}
  </section>;
}
