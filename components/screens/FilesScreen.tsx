"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, Brain, CheckCircle2, ChevronDown, Download, FileText, Layers, LoaderCircle, MessageCircle, Paperclip, RefreshCw, Search, Sparkles, Trash2, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import ArtifactCard from "@/components/artifacts/ArtifactCard";
import ArtifactPreviewSheet from "@/components/artifacts/ArtifactPreviewSheet";
import { api } from "@/lib/chatClient";
import { MAX_ATTACHMENT_BYTES, uploadDocument } from "@/lib/chatMedia";
import { getArtifacts, type ArtifactRecord } from "@/lib/persistence";
import type { Flashcard, QuizItem, StudyKind } from "@/lib/study";

type StudyAids = { summary?: string; quiz?: QuizItem[]; flashcards?: Flashcard[] };
type LibraryFile = { id: string; name: string; mime: string; size: number; kind: "upload" | "attachment" | "generated"; chars: number; pageCount: number | null; truncated: boolean; conversationId: string | null; hasData: boolean; study: StudyAids; createdAt: string; text?: string };
type Upload = { key: string; name: string; status: "working" | "done" | "error"; error?: string; file: File };

const ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.html,.xml,.rtf,.log,.yaml,.yml,.tsv";
const KIND_LABEL: Record<LibraryFile["kind"], string> = { upload: "Uploaded", attachment: "From chat", generated: "Made by Elias" };

function sizeLabel(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function dateLabel(iso: string) { return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); }

function Quiz({ items }: { items: QuizItem[] }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const answered = Object.keys(picked).length;
  const score = items.reduce((total, item, index) => total + (picked[index] === item.answer ? 1 : 0), 0);
  return <div className="v4l-quiz">
    {items.map((item, index) => {
      const choice = picked[index];
      return <fieldset key={index} className="v4l-q">
        <legend><span>{index + 1}.</span> {item.q}</legend>
        {item.options.map((option, optionIndex) => {
          const state = choice === undefined ? "" : optionIndex === item.answer ? "right" : optionIndex === choice ? "wrong" : "";
          return <button key={optionIndex} type="button" className={`v4l-opt ${state}`} disabled={choice !== undefined} aria-pressed={choice === optionIndex} onClick={() => setPicked((current) => ({ ...current, [index]: optionIndex }))}>
            <span className="v4l-opt-letter">{String.fromCharCode(65 + optionIndex)}</span><span>{option}</span>
            {state === "right" ? <CheckCircle2 size={16} aria-label="Correct" /> : state === "wrong" ? <XCircle size={16} aria-label="Wrong" /> : null}
          </button>;
        })}
        {choice !== undefined && item.why ? <p className="v4l-why">{item.why}</p> : null}
      </fieldset>;
    })}
    <div className="v4l-score" aria-live="polite">{answered ? `${score} of ${answered} right${answered === items.length ? " · done" : ""}` : `${items.length} questions`}{answered ? <button type="button" className="el-btn el-btn-sm el-btn-ghost" onClick={() => setPicked({})}>Reset</button> : null}</div>
  </div>;
}

function Flashcards({ cards }: { cards: Flashcard[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[Math.min(index, cards.length - 1)];
  const go = (step: number) => { setFlipped(false); setIndex((current) => (current + step + cards.length) % cards.length); };
  return <div className="v4l-cards">
    <button type="button" className={`v4l-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((value) => !value)} aria-label={flipped ? "Show the front" : "Show the answer"}>
      <small>{flipped ? "Answer" : "Card"} {index + 1} / {cards.length}</small>
      <strong>{flipped ? card.back : card.front}</strong>
      <em>{flipped ? "Tap to flip back" : "Tap to see the answer"}</em>
    </button>
    <div className="v4l-card-nav"><button type="button" className="el-btn" onClick={() => go(-1)}>Previous</button><button type="button" className="el-btn el-btn-primary" onClick={() => go(1)}>Next</button></div>
  </div>;
}

function FileDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [file, setFile] = useState<LibraryFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StudyKind | "text">("summary");
  const [working, setWorking] = useState<StudyKind | null>(null);

  useEffect(() => {
    let live = true;
    setFile(null); setError(null);
    api<{ file: LibraryFile }>(`/api/assistant/files/${encodeURIComponent(id)}`).then((data) => { if (live) setFile(data.file); }).catch((err) => { if (live) setError((err as Error).message); });
    return () => { live = false; };
  }, [id]);

  const make = useCallback(async (kind: StudyKind, refresh = false) => {
    setWorking(kind); setError(null);
    try {
      const data = await api<{ value: StudyAids[StudyKind] }>(`/api/assistant/files/${encodeURIComponent(id)}/study`, { method: "POST", body: JSON.stringify({ kind, refresh }) });
      setFile((current) => current ? { ...current, study: { ...current.study, [kind]: data.value } } : current);
    } catch (err) { setError((err as Error).message); }
    finally { setWorking(null); }
  }, [id]);

  async function remove() {
    if (!file || !window.confirm(`Delete “${file.name}” from your Library?`)) return;
    try { await api(`/api/assistant/files/${encodeURIComponent(id)}`, { method: "DELETE" }); onDeleted(); } catch (err) { setError((err as Error).message); }
  }

  if (!file) return error ? <p className="el-error-text" role="alert">{error}</p> : <ListSkeleton rows={3} />;
  const aid = tab === "text" ? null : file.study[tab];
  const has = aid && (!Array.isArray(aid) || aid.length);
  const ask = (prompt: string) => `/chat?file=${encodeURIComponent(file.id)}&prompt=${encodeURIComponent(prompt)}`;
  return <div className="v4l-detail">
    <header className="v4l-detail-head">
      <span className="v4l-file-icon"><FileText size={20} /></span>
      <div><h2 className="el-wrap">{file.name}</h2><p>{[KIND_LABEL[file.kind], file.pageCount ? `${file.pageCount} pages` : "", sizeLabel(file.size), dateLabel(file.createdAt)].filter(Boolean).join(" · ")}</p></div>
    </header>
    <div className="v4l-actions">
      <Link className="el-btn el-btn-primary" href={`/chat?file=${encodeURIComponent(file.id)}`}><MessageCircle size={16} /> Ask about it</Link>
      <a className="el-btn" href={`/api/assistant/files/${encodeURIComponent(file.id)}/download`}><Download size={16} /> {file.hasData ? "Download" : "Text"}</a>
      <button type="button" className="el-icon-btn danger" aria-label="Delete file" onClick={() => void remove()}><Trash2 size={17} /></button>
    </div>
    <div className="v4l-tabs" role="tablist" aria-label="Study tools">
      {([["summary", "Summary", Sparkles], ["quiz", "Quiz", Brain], ["flashcards", "Flashcards", Layers], ["text", "Text", FileText]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "on" : ""} onClick={() => setTab(value)}><Icon size={15} /> {label}</button>)}
    </div>
    {error ? <p className="el-error-text" role="alert">{error}</p> : null}
    <section className="v4l-panel" role="tabpanel">
      {tab === "text" ? <pre className="v4l-text">{(file.text || "").slice(0, 20_000) || "No readable text."}{(file.text || "").length > 20_000 ? "\n\n…" : ""}</pre>
        : working === tab ? <p className="v4l-working"><LoaderCircle size={16} className="el-spin" /> {tab === "summary" ? "Summarising…" : tab === "quiz" ? "Writing questions…" : "Making flashcards…"}</p>
        : !has ? <div className="v4l-make">
            <p>{tab === "summary" ? "A short revision summary with the key ideas and terms." : tab === "quiz" ? "Six multiple-choice questions to test yourself." : "Ten flashcards for quick review."}</p>
            <button type="button" className="el-btn el-btn-primary" onClick={() => void make(tab)}>{tab === "summary" ? <><Sparkles size={16} /> Summarise</> : tab === "quiz" ? <><Brain size={16} /> Make a quiz</> : <><Layers size={16} /> Make flashcards</>}</button>
          </div>
        : <>
            {tab === "summary" ? <div className="v4l-summary"><MarkdownMessage content={file.study.summary || ""} /></div> : tab === "quiz" ? <Quiz items={file.study.quiz || []} /> : <Flashcards cards={file.study.flashcards || []} />}
            <button type="button" className="el-btn el-btn-sm el-btn-ghost v4l-redo" onClick={() => void make(tab, true)}><RefreshCw size={14} /> Make new</button>
          </>}
    </section>
    <div className="v4l-asks">
      <Link className="v4l-ask" href={ask("Explain the most important ideas in this document simply, with examples.")}><BookOpenCheck size={16} /> Explain it simply</Link>
      <Link className="v4l-ask" href={ask("What are the main points and any action items in this document?")}><Sparkles size={16} /> Main points and to-dos</Link>
    </div>
  </div>;
}

/** /files (Library): every file you uploaded or attached in chat, server-side; open one to ask, summarise, quiz or make flashcards. */
export default function FilesScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const openId = params.get("id");
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [local, setLocal] = useState<ArtifactRecord[]>([]);
  const [showLocal, setShowLocal] = useState(false);
  const [preview, setPreview] = useState<ArtifactRecord | null>(null);

  const load = useCallback(async (q = "") => {
    try { setFiles((await api<{ files: LibraryFile[] }>(`/api/assistant/files${q ? `?q=${encodeURIComponent(q)}` : ""}`)).files); setError(null); }
    catch (err) { setError((err as Error).message); setFiles((current) => current || []); }
  }, []);
  useEffect(() => { void load(); void getArtifacts().then(setLocal).catch(() => setLocal([])); }, [load]);
  useEffect(() => { const timer = window.setTimeout(() => void load(query.trim()), 250); return () => window.clearTimeout(timer); }, [query, load]);

  async function uploadOne(item: Upload): Promise<string | null> {
    setUploads((current) => [...current.filter((entry) => entry.key !== item.key), { ...item, status: "working", error: undefined }]);
    try {
      if (item.file.size > MAX_ATTACHMENT_BYTES) throw new Error("Files can be up to 10 MB.");
      const result = await uploadDocument(item.file, undefined, { save: "library" });
      if (!result.fileId) throw new Error("Read it, but couldn't save it to your Library.");
      setUploads((current) => current.map((entry) => entry.key === item.key ? { ...entry, status: "done" } : entry));
      return result.fileId;
    } catch (err) {
      setUploads((current) => current.map((entry) => entry.key === item.key ? { ...entry, status: "error", error: (err as Error).message } : entry));
      return null;
    }
  }
  async function add(list: FileList | null) {
    if (!list?.length) return;
    const items = Array.from(list).map((file) => ({ key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`, name: file.name, status: "working" as const, file }));
    const saved: string[] = [];
    for (const item of items) { const id = await uploadOne(item); if (id) saved.push(id); }
    await load(query.trim());
    if (items.length === 1 && saved[0]) router.push(`/files?id=${encodeURIComponent(saved[0])}`);
  }

  function download(artifact: ArtifactRecord) {
    if (!artifact.blob && artifact.text === undefined) return;
    const blob = artifact.blob || new Blob([artifact.text || ""], { type: artifact.type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = artifact.name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 250);
  }

  if (openId) return <AppShell title="File" back="/files"><main className="el-page v4l-page"><FileDetail id={openId} onDeleted={() => { router.push("/files"); void load(query.trim()); }} /></main></AppShell>;

  return <AppShell title="Library">
    <main className="el-page v4l-page">
      <header className="el-page-head"><h1>Library</h1><p>Your files in one place: uploads and chat attachments. Open one to ask about it, summarise it, or study it with a quiz and flashcards.</p></header>
      <input ref={input} hidden type="file" multiple accept={ACCEPT} onChange={(event) => { void add(event.target.files); event.currentTarget.value = ""; }} />
      <button type="button" className="v4l-drop" onClick={() => input.current?.click()}><Upload size={22} /><span><strong>Upload files</strong><small>PDF, Word, Excel, CSV, text · up to 10 MB</small></span></button>
      {uploads.length ? <ul className="v4l-uploads">{uploads.map((item) => <li key={item.key} className={item.status}>
        {item.status === "working" ? <LoaderCircle size={16} className="el-spin" /> : item.status === "done" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        <span><strong className="el-wrap">{item.name}</strong><small>{item.status === "working" ? "Reading…" : item.status === "done" ? "Saved" : item.error}</small></span>
        {item.status === "error" ? <button type="button" className="el-btn el-btn-sm" onClick={() => void uploadOne(item).then(() => load(query.trim()))}>Retry</button> : null}
      </li>)}</ul> : null}

      <div className="v4l-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names and contents" aria-label="Search files" /></div>
      {error ? <p className="el-error-text" role="alert">{error}</p> : null}

      <section className="el-section">
        {!files ? <ListSkeleton rows={4} /> : !files.length ? <p className="el-empty-line"><Paperclip size={16} /> {query ? "No files match that." : "No files yet. Upload one, or attach a file in chat and it will show up here."}</p> : <ul className="el-list">{files.map((file) => <li key={file.id} className="el-list-item">
          <Link className="el-list-row" href={`/files?id=${encodeURIComponent(file.id)}`}>
            <span className="el-list-icon"><FileText size={17} /></span>
            <span className="el-list-text"><strong className="el-wrap">{file.name}</strong><small>{[KIND_LABEL[file.kind], file.pageCount ? `${file.pageCount} pages` : "", sizeLabel(file.size), dateLabel(file.createdAt)].filter(Boolean).join(" · ")}</small></span>
            {file.study.quiz?.length || file.study.flashcards?.length ? <span className="v4l-badge">Studied</span> : null}
          </Link>
        </li>)}</ul>}
      </section>

      {local.length ? <section className="el-section">
        <button type="button" className="v4l-local-toggle" aria-expanded={showLocal} onClick={() => setShowLocal((value) => !value)}><span>On this device ({local.length})</span><ChevronDown size={18} className={showLocal ? "el-rot" : ""} /></button>
        {showLocal ? <div className="artifact-library-list">{local.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} taskLabel={artifact.taskId ? "Task output" : artifact.pageCount ? "Document" : undefined} onPreview={() => setPreview(artifact)} onDownload={() => download(artifact)} />)}</div> : null}
      </section> : null}
      <ArtifactPreviewSheet artifact={preview} onClose={() => setPreview(null)} onDownload={preview ? () => download(preview) : undefined} />
    </main>
  </AppShell>;
}
