"use client";

import { ArrowDownToLine, ArrowUpRight, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { artifactExtension, artifactKind, type ArtifactCardData } from "@/components/artifacts/ArtifactCard";

type ArtifactPreviewSheetProps = {
  artifact: ArtifactCardData | null;
  href?: string;
  onClose: () => void;
  onDownload?: () => void;
};

function dataUrl(artifact: ArtifactCardData) {
  if (!artifact.content) return undefined;
  if (artifact.content.startsWith("data:")) return artifact.content;
  const mime = artifact.type || "text/plain";
  return artifact.encoding === "base64" ? `data:${mime};base64,${artifact.content}` : `data:${mime},${encodeURIComponent(artifact.content)}`;
}

function readablePreview(artifact: ArtifactCardData) {
  return artifact.text ?? artifact.preview ?? (artifact.encoding !== "base64" ? artifact.content : undefined);
}

export default function ArtifactPreviewSheet({ artifact, href, onClose, onDownload }: ArtifactPreviewSheetProps) {
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (!artifact?.blob) { setBlobUrl(undefined); return; }
    const url = URL.createObjectURL(artifact.blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact]);
  if (!artifact) return null;

  const kind = artifactKind(artifact.name, artifact.type);
  const source = blobUrl || dataUrl(artifact);
  const text = readablePreview(artifact);
  const extension = artifactExtension(artifact.name).toUpperCase();
  const download = onDownload || (href ? () => { const anchor = document.createElement("a"); anchor.href = href; anchor.download = artifact.name; anchor.click(); } : undefined);
  return <div className="artifact-preview-backdrop" role="presentation" onMouseDown={onClose}><section className="artifact-preview-sheet" role="dialog" aria-modal="true" aria-label={`Preview ${artifact.name}`} onMouseDown={(event) => event.stopPropagation()}>
    <header className="artifact-preview-head"><div><span className="eyebrow">ARTIFACT PREVIEW</span><h2>{artifact.name}</h2><p>{extension}{artifact.pageCount ? ` · ${artifact.pageCount} pages` : ""}{artifact.chunks?.length ? ` · ${artifact.chunks.length} chunks` : ""}</p></div><button type="button" className="icon-btn" onClick={onClose} aria-label="Close artifact preview"><X size={18} /></button></header>
    <div className={`artifact-preview-body artifact-preview-${kind}`}>
      {kind === "image" && source ? <img src={source} alt={artifact.name} /> : null}
      {kind === "pdf" && source ? <iframe title={`Preview ${artifact.name}`} src={source} /> : null}
      {text !== undefined ? <pre>{text}</pre> : null}
      {!source && text === undefined ? <div className="artifact-preview-unavailable"><span className="artifact-preview-large-icon"><Check size={20} /></span><strong>Ready to open</strong><p>This file is stored safely in your Elias Library. Use the action below to download it.</p></div> : null}
    </div>
    <footer className="artifact-preview-foot"><span>{artifact.summary || "Stored in your Elias Library"}</span><div>{href ? <a className="secondary artifact-open-action" href={href} target="_blank" rel="noreferrer" download={href.startsWith("/api/") || href.startsWith("data:")}><ArrowUpRight size={14} /> Open</a> : null}{download ? <button type="button" className="primary artifact-download-action" onClick={download}><ArrowDownToLine size={14} /> Download</button> : null}</div></footer>
  </section></div>;
}
