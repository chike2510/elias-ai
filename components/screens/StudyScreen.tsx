"use client";

import { BookOpenCheck, Brain, CheckCircle2, FileUp, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { makeId, saveArtifact } from "@/lib/persistence";

type StudyDoc = { id: string; name: string; text: string; summary?: string; pageCount?: number; chunks?: number };
type UploadItem = { name: string; status: "uploading" | "ready" | "error"; progress: number; message?: string; source: File };

type ProcessedDocument = { summary?: string; pageCount?: number; chars?: number; truncated?: boolean; chunks?: Array<{ id: string; index: number; pageStart: number; pageEnd: number; text: string; summary?: string }> };

export default function StudyScreen() {
  const input = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<StudyDoc[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState("");

  function updateUpload(name: string, patch: Partial<UploadItem>) {
    setUploads((current) => current.map((item) => item.name === name ? { ...item, ...patch } : item));
  }

  async function processFile(file: File) {
    setUploads((current) => [...current, { name: file.name, status: "uploading", progress: 5, source: file }]);
    if (file.size > 25_000_000) {
      updateUpload(file.name, { status: "error", progress: 0, message: "Over 25 MB" });
      return;
    }
    try {
      updateUpload(file.name, { progress: 25 });
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/documents/process", { method: "POST", body: form });
      const data = await response.json() as { message?: string; text?: string; document?: ProcessedDocument };
      if (!response.ok) throw new Error(data.message || "Could not process file.");
      updateUpload(file.name, { progress: 78 });
      const document = data.document || {};
      const text = data.text || "";
      const documentId = makeId("artifact");
      await saveArtifact({ id: documentId, name: file.name, type: file.type || "application/octet-stream", createdAt: Date.now(), blob: file, text, summary: document.summary, pageCount: document.pageCount, charCount: document.chars, truncated: document.truncated, chunks: document.chunks });
      setDocs((current) => [...current, { id: documentId, name: file.name, text, summary: document.summary, pageCount: document.pageCount, chunks: document.chunks?.length }]);
      updateUpload(file.name, { status: "ready", progress: 100, message: "Saved to Library" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not process file.";
      updateUpload(file.name, { status: "error", progress: 0, message });
      setError(message);
    }
  }

  async function add(list: FileList | null) {
    if (!list) return;
    setError("");
    for (const file of Array.from(list)) await processFile(file);
  }

  return <AppShell title="Study"><main className="screen study-screen"><ScreenHeader title="Study" /><section className="study-hero"><span><BookOpenCheck size={25} /></span><div><h2>Study</h2><p>Upload material, then ask Elias about it.</p></div></section><input ref={input} hidden type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md" onChange={(event) => { void add(event.target.files); event.currentTarget.value = ""; }} /><button className="upload-drop" onClick={() => input.current?.click()}><FileUp size={25} /><b>Upload files</b><small>PDF, DOCX, XLSX, CSV, TXT, MD</small></button>{uploads.length ? <section className="upload-status-list panel"><div className="panel-head"><h3>Uploads</h3><span>{uploads.filter((item) => item.status === "ready").length}/{uploads.length}</span></div>{uploads.map((item) => <div className={`upload-status-row ${item.status}`} key={`${item.name}-${item.status}`}><span className="upload-status-icon">{item.status === "uploading" ? <LoaderCircle size={15} className="spin" /> : item.status === "ready" ? <CheckCircle2 size={15} /> : <RefreshCw size={15} />}</span><span><b>{item.name}</b><small>{item.status === "uploading" ? `Processing ${item.progress}%` : item.message || (item.status === "ready" ? "Saved to Library" : "Failed")}</small>{item.status === "uploading" ? <i className="upload-progress"><b style={{ width: `${item.progress}%` }} /></i> : null}</span>{item.status === "error" ? <button type="button" className="secondary" onClick={() => void processFile(item.source)}>Retry</button> : null}</div>)}</section> : null}{error ? <p className="connector-help upload-error">{error}</p> : null}<section className="panel study-documents"><div className="panel-head"><h3>Documents</h3><span>{docs.length}</span></div><div className="document-list">{docs.map((doc) => <div key={doc.id}><span className="doc-icon"><FileUp size={15} /></span><span><b>{doc.name}</b><small>{doc.pageCount ? `${doc.pageCount} pages · ` : ""}{doc.chunks ? `${doc.chunks} chunks · ` : ""}Saved to Library</small></span><CheckCircle2 size={15} className="success" /></div>)}</div>{!docs.length ? <small className="empty-inline">Uploaded documents will appear here.</small> : null}</section><div className="study-actions">{docs.length ? <><button onClick={() => window.location.href = `/chat?documentId=${encodeURIComponent(docs[docs.length - 1].id)}&prompt=${encodeURIComponent("Summarize this document for my revision.")}`}><Sparkles size={18} /> Ask</button><button onClick={() => window.location.href = `/chat?documentId=${encodeURIComponent(docs[docs.length - 1].id)}&prompt=${encodeURIComponent("Explain the most important concepts in this document.")}`}><Brain size={18} /> Explain</button><button onClick={() => window.location.href = `/chat?documentId=${encodeURIComponent(docs[docs.length - 1].id)}&prompt=${encodeURIComponent("Create practice questions from this document.")}`}><CheckCircle2 size={18} /> Questions</button><button onClick={() => window.location.href = `/chat?documentId=${encodeURIComponent(docs[docs.length - 1].id)}&prompt=${encodeURIComponent("Create flashcards from this document.")}`}><BookOpenCheck size={18} /> Flashcards</button></> : null}</div></main></AppShell>;
}
