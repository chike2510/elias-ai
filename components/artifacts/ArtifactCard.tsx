"use client";

import { Archive, ArrowDownToLine, ArrowUpRight, CheckCircle2, FileCode2, FileImage, FileText, Presentation, ScrollText } from "lucide-react";
import type { ReactNode } from "react";

export type ArtifactCardData = {
  id: string;
  name: string;
  type?: string;
  createdAt?: number;
  size?: number;
  pageCount?: number;
  chunks?: Array<unknown>;
  summary?: string;
  text?: string;
  preview?: string;
  content?: string;
  encoding?: "utf8" | "base64";
  blob?: Blob;
  taskId?: string;
};

type ArtifactCardProps = {
  artifact: ArtifactCardData;
  href?: string;
  compact?: boolean;
  status?: "ready" | "working" | "error";
  taskLabel?: string;
  onPreview?: () => void;
  onDownload?: () => void;
};

export function artifactExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "file";
}

export function artifactKind(name: string, type = "") {
  const extension = artifactExtension(name);
  if (extension === "pdf" || type.includes("pdf")) return "pdf";
  if (extension === "doc" || extension === "docx" || type.includes("word")) return "doc";
  if (extension === "ppt" || extension === "pptx" || type.includes("presentation")) return "slides";
  if (["ts", "tsx", "js", "jsx", "css", "html", "py", "java", "sql", "json"].includes(extension)) return "code";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension) || type.startsWith("image/")) return "image";
  if (["zip", "tar", "gz"].includes(extension)) return "archive";
  if (["md", "txt"].includes(extension)) return "text";
  return "file";
}

function iconFor(kind: string) {
  if (kind === "code") return <FileCode2 size={18} />;
  if (kind === "image") return <FileImage size={18} />;
  if (kind === "slides") return <Presentation size={18} />;
  if (kind === "archive") return <Archive size={18} />;
  if (kind === "text") return <ScrollText size={18} />;
  return <FileText size={18} />;
}

function labelFor(kind: string) {
  return ({ pdf: "PDF", doc: "DOC", slides: "SLIDES", code: "CODE", image: "IMAGE", archive: "ARCHIVE", text: "TEXT", file: "FILE" } as Record<string, string>)[kind] || "FILE";
}

function formatSize(size?: number) {
  if (!size || size < 1) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ArtifactCard({ artifact, href, compact = false, status = "ready", taskLabel, onPreview, onDownload }: ArtifactCardProps) {
  const kind = artifactKind(artifact.name, artifact.type);
  const metadata = [labelFor(kind), artifact.pageCount ? `${artifact.pageCount} pages` : "", artifact.chunks?.length ? `${artifact.chunks.length} chunks` : "", formatSize(artifact.size)].filter(Boolean).join(" · ");
  const canPreview = Boolean(onPreview && (artifact.text !== undefined || artifact.preview !== undefined || artifact.content !== undefined || artifact.blob));
  const actionLabel = canPreview ? "Preview" : href ? "Open" : "Download";
  const action = onPreview || onDownload;
  const actionContent: ReactNode = action ? <button type="button" className="artifact-card-action" onClick={onPreview || onDownload}>{actionLabel}<ArrowUpRight size={12} /></button> : href ? <a className="artifact-card-action" href={href} target="_blank" rel="noreferrer" download={href.startsWith("/api/") || href.startsWith("data:")}>{actionLabel}<ArrowUpRight size={12} /></a> : null;

  return <article className={`artifact-card artifact-card-${kind} artifact-status-${status} ${compact ? "artifact-card-compact" : ""}`}>
    <span className="artifact-card-icon">{iconFor(kind)}<small>{labelFor(kind)}</small></span>
    <span className="artifact-card-copy"><strong title={artifact.name}>{artifact.name}</strong><small>{metadata || "Generated artifact"}{taskLabel ? ` · ${taskLabel}` : ""}</small>{artifact.summary && !compact ? <span>{artifact.summary}</span> : null}</span>
    <span className="artifact-card-actions">{status === "working" ? <span className="artifact-card-status"><span className="artifact-status-dot" />Preparing</span> : status === "error" ? <span className="artifact-card-status error">Unavailable</span> : <><span className="artifact-ready-icon"><CheckCircle2 size={13} /></span>{actionContent}{onDownload && onPreview ? <button type="button" className="artifact-icon-action" onClick={onDownload} aria-label={`Download ${artifact.name}`}><ArrowDownToLine size={14} /></button> : null}</>}</span>
  </article>;
}
