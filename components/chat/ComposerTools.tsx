"use client";

import { Camera, Check, Cpu, FileText, ImagePlus, Loader2, Mic, Paperclip, Square, Volume2, X, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, haptic, type StoredAttachment } from "@/lib/chatClient";
import { canSpeak, formatBytes, recorderFormat, speakableText, transcribe } from "@/lib/chatMedia";
import { modelLabel } from "@/lib/assistant/modelRouter";

/* ---------------- attachments ---------------- */

export type DraftAttachment = {
  id: string;
  kind: "image" | "file";
  name: string;
  mime: string;
  size: number;
  status: "working" | "ready" | "error";
  error?: string;
  dataUrl?: string;
  thumb?: string;
  width?: number;
  height?: number;
  text?: string;
  chars?: number;
  truncated?: boolean;
};

export const ACCEPT_FILES = "image/*,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.html,.xml,.rtf,.log,.yaml,.yml,.tsv";

/** Paperclip button with a small menu: take a photo, or pick photos and files. Also opens the model picker. */
export function AttachMenu({ disabled, onFiles, onOpenModels, modelName }: { disabled?: boolean; onFiles: (files: File[]) => void; onOpenModels: () => void; modelName: string }) {
  const [open, setOpen] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const take = (input: HTMLInputElement | null) => { setOpen(false); input?.click(); };
  const picked = (event: React.ChangeEvent<HTMLInputElement>) => { const list = [...(event.target.files || [])]; event.target.value = ""; if (list.length) onFiles(list); };
  return <div className="el-attach" ref={wrap}>
    <button type="button" className="el-composer-btn" aria-label="Attach photos or files, choose model" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)}><Paperclip size={20} /></button>
    {open ? <div className="el-attach-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => take(camera.current)}><Camera size={18} /> Take a photo</button>
      <button type="button" role="menuitem" onClick={() => take(files.current)}><ImagePlus size={18} /> Photos and files</button>
      <hr />
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenModels(); }}><Cpu size={18} /> <span>Model</span><small>{modelName}</small></button>
    </div> : null}
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
    <input ref={files} type="file" accept={ACCEPT_FILES} multiple hidden onChange={picked} />
  </div>;
}

/** Previews of what will be sent: thumbnails for images, chips for documents. */
export function AttachmentStrip({ items, onRemove }: { items: DraftAttachment[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return <div className="el-attach-strip" aria-label="Attachments">
    {items.map((item) => <div key={item.id} className={`el-attach-item ${item.kind} ${item.status}`} title={item.error || item.name}>
      {item.kind === "image" && (item.thumb || item.dataUrl) ? <img src={item.thumb || item.dataUrl} alt={item.name} /> : <span className="el-attach-icon">{item.status === "working" ? <Loader2 size={18} className="el-spin" /> : <FileText size={18} />}</span>}
      {item.kind === "file" ? <span className="el-attach-meta"><strong>{item.name}</strong><small>{item.status === "working" ? "Reading…" : item.status === "error" ? item.error || "Couldn't read" : `${formatBytes(item.size)}${item.chars ? ` · ${item.chars.toLocaleString()} chars` : ""}`}</small></span> : null}
      {item.kind === "image" && item.status === "working" ? <span className="el-attach-busy"><Loader2 size={18} className="el-spin" /></span> : null}
      {item.kind === "image" && item.status === "error" ? <span className="el-attach-busy error">!</span> : null}
      <button type="button" className="el-attach-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}><X size={14} /></button>
    </div>)}
  </div>;
}

/** Chips and thumbnails on a sent message (from the stored metadata). */
export function MessageAttachments({ items }: { items: StoredAttachment[] }) {
  if (!items.length) return null;
  return <div className="el-msg-attachments">
    {items.map((item, index) => item.kind === "image"
      ? (item.thumb ? <img key={index} className="el-msg-thumb" src={item.thumb} alt={item.name} /> : <span key={index} className="el-msg-file"><ImagePlus size={14} /> {item.name}</span>)
      : <span key={index} className="el-msg-file"><FileText size={14} /> <span>{item.name}</span></span>)}
  </div>;
}

/* ---------------- voice ---------------- */

type RecordMode = "idle" | "hold" | "tap" | "transcribing";
const MAX_RECORD_MS = 120_000;
const HOLD_THRESHOLD_MS = 350;

/**
 * Mic button. Press and hold to talk (release sends), or tap to start and tap again to stop
 * (the transcript fills the composer for editing).
 */
export function useVoice(onTranscript: (text: string, autoSend: boolean) => void, onError: (message: string) => void) {
  const [mode, setMode] = useState<RecordMode>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pressedAt = useRef(0);
  const holding = useRef(false);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const format = useRef<{ mime: string; ext: string } | null>(null);
  const startPromise = useRef<Promise<boolean> | null>(null);
  const startedAt = useRef(0);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
  };
  useEffect(() => () => { cancelled.current = true; try { recorder.current?.stop(); } catch { /* idle */ } cleanup(); }, []);

  const start = useCallback(async () => {
    const supported = recorderFormat();
    if (!supported || !navigator.mediaDevices?.getUserMedia) { onError("Voice input isn't supported in this browser."); return false; }
    format.current = supported;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { onError("Microphone access was blocked. Allow it in your browser settings to talk to Elias."); return false; }
    const media = supported.mime ? new MediaRecorder(stream, { mimeType: supported.mime }) : new MediaRecorder(stream);
    chunks.current = [];
    cancelled.current = false;
    media.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
    media.onstop = async () => {
      const autoSend = holding.current;
      const blob = new Blob(chunks.current, { type: media.mimeType || supported.mime || "audio/webm" });
      cleanup();
      if (cancelled.current || blob.size < 1200) { setMode("idle"); if (!cancelled.current) onError("That was too short. Hold the mic a bit longer."); return; }
      setMode("transcribing");
      try {
        const text = await transcribe(blob, /mp4|aac|m4a/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : supported.ext);
        if (text.trim()) onTranscript(text.trim(), autoSend); else onError("I couldn't hear anything. Try again a little closer to the mic.");
      } catch (error) { onError((error as Error).message); }
      finally { setMode("idle"); }
    };
    recorder.current = media;
    media.start(250);
    startedAt.current = Date.now();
    setElapsed(0);
    const began = Date.now();
    timer.current = setInterval(() => { const ms = Date.now() - began; setElapsed(ms); if (ms >= MAX_RECORD_MS) stop(); }, 250);
    haptic(15);
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError, onTranscript]);

  const stop = useCallback(() => { try { if (recorder.current?.state === "recording") recorder.current.stop(); } catch { cleanup(); setMode("idle"); } }, []);
  const cancel = useCallback(() => { cancelled.current = true; stop(); setMode("idle"); }, [stop]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (mode === "transcribing") return;
    if (mode === "tap") { holding.current = false; stop(); return; }
    event.preventDefault();
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* old browsers */ }
    pressedAt.current = Date.now();
    holding.current = true;
    setMode("hold");
    startPromise.current = start().then((ok) => { if (!ok) setMode("idle"); return ok; });
  }, [mode, start, stop]);

  const onPointerUp = useCallback(async () => {
    if (mode !== "hold" || !startPromise.current) return;
    const upAt = Date.now();
    const ok = await startPromise.current;
    startPromise.current = null;
    if (!ok) return;
    // A quick tap, or a release before recording even began (the permission prompt), means tap-to-record.
    if (upAt - pressedAt.current < HOLD_THRESHOLD_MS || upAt < startedAt.current + 200) { holding.current = false; setMode("tap"); return; }
    holding.current = true;
    stop();
  }, [mode, stop]);

  /** Keyboard / accessibility path: Enter or Space toggles tap-to-record. */
  const toggle = useCallback(() => {
    if (mode === "transcribing") return;
    if (mode === "tap" || mode === "hold") { holding.current = false; stop(); return; }
    holding.current = false;
    setMode("tap");
    void start().then((ok) => { if (!ok) setMode("idle"); });
  }, [mode, start, stop]);

  return { mode, elapsed, onPointerDown, onPointerUp, stop, cancel, toggle };
}

export function MicButton({ voice, disabled }: { voice: ReturnType<typeof useVoice>; disabled?: boolean }) {
  const recording = voice.mode === "hold" || voice.mode === "tap";
  return <button type="button" className={`el-send el-mic ${recording ? "recording" : ""}`} disabled={disabled || voice.mode === "transcribing"}
    aria-label={recording ? "Stop recording" : voice.mode === "transcribing" ? "Transcribing" : "Voice message: hold to talk, or tap to record"}
    onPointerDown={voice.onPointerDown} onPointerUp={() => void voice.onPointerUp()} onPointerCancel={() => void voice.onPointerUp()}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); voice.toggle(); } }}>
    {voice.mode === "transcribing" ? <Loader2 size={20} className="el-spin" /> : recording ? <Square size={15} fill="currentColor" /> : <Mic size={20} />}
  </button>;
}

/** Replaces the text field while recording. */
export function RecordingBar({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const seconds = Math.floor(voice.elapsed / 1000);
  return <div className="el-recording" role="status" aria-live="polite">
    {voice.mode === "transcribing" ? <span>Transcribing…</span> : <>
      <span className="el-rec-dot" aria-hidden="true" />
      <span className="el-rec-time">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
      <span className="el-rec-hint">{voice.mode === "hold" ? "Release to send" : "Tap ■ to stop"}</span>
      {voice.mode === "tap" ? <button type="button" className="el-composer-btn" aria-label="Cancel recording" onClick={voice.cancel}><X size={18} /></button> : null}
    </>}
  </div>;
}

/* ---------------- read aloud + model label ---------------- */

export function ReplyMeta({ content, model }: { content: string; model?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const label = modelLabel(model);
  useEffect(() => () => { if (speaking && canSpeak()) window.speechSynthesis.cancel(); }, [speaking]);
  function toggle() {
    if (!canSpeak()) return;
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(speakableText(content));
    utterance.lang = document.documentElement.lang || navigator.language || "en";
    utterance.rate = 1.02;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }
  if (!label && !canSpeak()) return null;
  return <div className="el-reply-meta">
    {canSpeak() && content ? <button type="button" className="el-reply-action" aria-pressed={speaking} aria-label={speaking ? "Stop reading" : "Read aloud"} onClick={toggle}>{speaking ? <Square size={13} fill="currentColor" /> : <Volume2 size={15} />}<span>{speaking ? "Stop" : "Read aloud"}</span></button> : null}
    {label ? <span className="el-model-label">via {label.provider} · {label.model}</span> : null}
  </div>;
}

/* ---------------- model picker ---------------- */

type ModelsResponse = { modes: Array<{ id: string; label: string; detail: string }>; providers: Array<{ provider: string; models: Array<{ id: string; model: string; vision: boolean }> }>; choice: string };

export function choiceName(choice: string) {
  if (choice === "auto" || !choice) return "Auto";
  if (choice === "fast") return "Fast";
  if (choice === "strong") return "Strong";
  const label = modelLabel(choice);
  return label ? label.model : choice;
}

export function ModelSheet({ choice, onChoose, onClose }: { choice: string; onChoose: (choice: string) => void; onClose: () => void }) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<ModelsResponse>("/api/assistant/models").then(setData).catch((err) => setError((err as Error).message)); }, []);
  const option = (id: string, title: string, detail?: string, icon?: React.ReactNode) => <button key={id} type="button" role="radio" aria-checked={choice === id} className={`el-model-option ${choice === id ? "on" : ""}`} onClick={() => { onChoose(id); onClose(); }}>
    {icon}<span><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>{choice === id ? <Check size={18} /> : null}
  </button>;
  return <div className="el-overlay el-overlay-sheet" onClick={onClose}>
    <section className="el-sheet el-model-sheet" role="dialog" aria-modal="true" aria-label="Choose a model" onClick={(event) => event.stopPropagation()}>
      <span className="el-sheet-grip" aria-hidden="true" />
      <header className="el-sheet-head"><Cpu size={18} /><strong>Model</strong><button type="button" className="el-icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <div className="el-model-list" role="radiogroup" aria-label="Model">
        {(data?.modes || [{ id: "auto", label: "Auto", detail: "Picks fast or strong for each message" }, { id: "fast", label: "Fast", detail: "Quick replies for plain chat" }, { id: "strong", label: "Strong", detail: "Tools, long messages and files" }])
          .map((mode) => option(mode.id, mode.label, mode.detail, mode.id === "fast" ? <Zap size={17} /> : <Cpu size={17} />))}
        {error ? <p className="el-error-text" role="alert">{error}</p> : null}
        {!data && !error ? <p className="el-muted"><Loader2 size={14} className="el-spin" /> Loading models…</p> : null}
        {data?.providers.filter((item) => item.models.length).map((item) => <div key={item.provider} className="el-model-group">
          <p className="el-model-group-title">{item.provider}</p>
          {item.models.map((model) => option(model.id, model.model, model.vision ? "Can see images" : undefined))}
        </div>)}
      </div>
      <p className="el-muted el-model-note">Images always go to a vision model. If your pick is busy, Elias falls back to the next one.</p>
    </section>
  </div>;
}
