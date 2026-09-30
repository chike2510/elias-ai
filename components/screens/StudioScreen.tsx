"use client";

import Link from "next/link";
import { Camera, Check, Image as ImageIcon, LoaderCircle, Mic, MicOff, RefreshCcw, Sparkles, Video, WandSparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { readApiResponse } from "@/lib/clientApi";
import { syncTaskArtifactToLibrary } from "@/lib/taskArtifactLibrary";
import { makeId, saveArtifact } from "@/lib/persistence";
import type { TaskRecord } from "@/lib/task";

type Recognition = { lang: string; interimResults: boolean; onstart: (() => void) | null; onend: (() => void) | null; onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null; start: () => void; stop: () => void };
type VideoJobView = {
  task: TaskRecord;
  status: "submitting" | "queued" | "running" | "finalizing" | "completed" | "failed";
  progress: number;
  retryCount: number;
  error?: string;
  lastPollError?: string;
  artifact?: TaskRecord["artifacts"][number];
};
type VideoApiPayload = { task?: TaskRecord; video?: Omit<VideoJobView, "task">; error?: { message?: string } };

export default function StudioScreen() {
  const [mode, setMode] = useState<"voice" | "camera" | "generate">("voice");
  const [generateType, setGenerateType] = useState<"image" | "video">("image");
  const [listening, setListening] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [confirmFictionalAdults, setConfirmFictionalAdults] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState<boolean | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generated, setGenerated] = useState<{ taskId: string; name: string } | null>(null);
  const [videoJob, setVideoJob] = useState<VideoJobView | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const syncedVideoArtifacts = useRef(new Set<string>());

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    if (requestedMode === "camera" || requestedMode === "voice" || requestedMode === "generate") setMode(requestedMode);
    return () => { stream.current?.getTracks().forEach((track) => track.stop()); recognition.current?.stop(); };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/generation", { cache: "no-store" })
      .then(async (response) => readApiResponse<{ video?: { available?: boolean } }>(response))
      .then((payload) => { if (active) setVideoAvailable(payload.video?.available === true); })
      .catch(() => { if (active) setVideoAvailable(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get("videoTask");
    if (!taskId) return;
    setMode("generate");
    setGenerateType("video");
    let active = true;
    void fetch(`/api/generation/${encodeURIComponent(taskId)}`, { cache: "no-store" })
      .then(async (response) => readApiResponse<VideoApiPayload>(response))
      .then((payload) => {
        if (active && payload.task && payload.video) setVideoJob({ task: payload.task, ...payload.video });
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not resume video status."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!videoJob || !["submitting", "queued", "running", "finalizing"].includes(videoJob.status)) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/generation/${encodeURIComponent(videoJob.task.id)}`, { cache: "no-store" });
        const payload = await readApiResponse<VideoApiPayload>(response);
        if (!active || !payload.task || !payload.video) return;
        const next = { task: payload.task, ...payload.video };
        setVideoJob(next);
        setError("");
        if (next.status === "completed") {
          const artifact = next.artifact || next.task.artifacts.find((item) => item.id === next.task.videoGeneration?.artifactId);
          if (artifact) {
            const key = `${next.task.id}:${artifact.id}`;
            if (!syncedVideoArtifacts.current.has(key)) {
              syncedVideoArtifacts.current.add(key);
              try {
                await syncTaskArtifactToLibrary(next.task, artifact, { save: saveArtifact });
                setNotice("MP4 saved to your Library and attached to this task.");
              } catch {
                syncedVideoArtifacts.current.delete(key);
                setError("The MP4 is complete and available in the task, but this browser could not save a Library copy. Open the task to download it.");
              }
            }
          }
          return;
        }
        if (next.status === "failed") return;
        timer = window.setTimeout(() => { void poll(); }, 3_000);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? `${caught.message} Retrying status check…` : "Video status is temporarily unavailable. Retrying…");
        timer = window.setTimeout(() => { void poll(); }, 5_000);
      }
    };
    timer = window.setTimeout(() => { void poll(); }, 2_000);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [videoJob?.task.id, videoJob?.status]);

  async function startCamera() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser.");
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (video.current) video.current.srcObject = stream.current;
      setCameraReady(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Camera permission was not granted."); }
  }

  function stopCamera() { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; setCameraReady(false); }

  function toggleVoice() {
    setError("");
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError("Speech recognition is not available in this browser. You can still type in chat."); return; }
    if (listening) { recognition.current?.stop(); setListening(false); return; }
    const next = new SpeechRecognition();
    next.lang = "en-US"; next.interimResults = true;
    next.onstart = () => setListening(true);
    next.onend = () => setListening(false);
    next.onresult = (event) => { const value = Array.from(event.results || []).map((result) => result?.[0]?.transcript || "").join(" ").trim(); if (value) setTranscript(value); };
    recognition.current = next;
    next.start();
  }

  async function generateImage() {
    const prompt = generatePrompt.trim();
    if (!prompt || generateBusy) return;
    setGenerateBusy(true); setError(""); setGenerated(null);
    try {
      const response = await fetch("/api/generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "image", prompt }) });
      const payload = await response.json() as { task?: { id?: string }; artifact?: { name?: string }; error?: { message?: string } };
      if (!response.ok || !payload.task?.id || !payload.artifact?.name) throw new Error(payload.error?.message || "Image generation failed.");
      setGenerated({ taskId: payload.task.id, name: payload.artifact.name });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Image generation failed."); }
    finally { setGenerateBusy(false); }
  }

  async function generateVideo(taskId?: string) {
    if (generateBusy || !confirmFictionalAdults) return;
    if (!taskId && !generatePrompt.trim()) return;
    setGenerateBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "video", ...(taskId ? { taskId } : { prompt: generatePrompt.trim(), durationSeconds: 4, width: 512, height: 512 }), confirmFictionalAdults: true }),
      });
      const payload = await readApiResponse<VideoApiPayload>(response);
      if (!payload.task || !payload.video) throw new Error("The video service returned an incomplete job response.");
      setVideoJob({ task: payload.task, ...payload.video });
      const params = new URLSearchParams(window.location.search);
      params.set("mode", "generate");
      params.set("videoTask", payload.task.id);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Video generation could not be submitted."); }
    finally { setGenerateBusy(false); }
  }

  async function capture() {
    if (!video.current || !cameraReady) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth || 720; canvas.height = video.current.videoHeight || 960;
    canvas.getContext("2d")?.drawImage(video.current, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    await saveArtifact({ id: makeId("artifact"), name: `capture-${new Date().toISOString().replaceAll(":", "-")}.jpg`, type: "image/jpeg", createdAt: Date.now(), blob });
    setError("Snapshot saved to Files. Image analysis is not configured in this deployment.");
  }

  const videoPending = Boolean(videoJob && ["submitting", "queued", "running", "finalizing"].includes(videoJob.status));
  const videoArtifact = videoJob?.artifact || videoJob?.task.artifacts.find((item) => item.id === videoJob.task.videoGeneration?.artifactId);
  const videoArtifactHref = videoJob && videoArtifact ? `/api/tasks/${encodeURIComponent(videoJob.task.id)}/artifact/${encodeURIComponent(videoArtifact.id)}` : "";

  return <AppShell title="ELIAS AI Studio"><main className="screen studio-screen">
    <ScreenHeader title="ELIAS AI Studio" />
    <section className="studio-card panel">
      <div className="studio-tabs" role="tablist" aria-label="Studio mode"><button type="button" className={mode === "voice" ? "active" : ""} onClick={() => { setMode("voice"); stopCamera(); }}><Mic size={16} /> Voice</button><button type="button" className={mode === "camera" ? "active" : ""} onClick={() => { setMode("camera"); void startCamera(); }}><Camera size={16} /> Camera</button><button type="button" className={mode === "generate" ? "active" : ""} onClick={() => { setMode("generate"); stopCamera(); }}><WandSparkles size={16} /> Generate</button></div>
      {error ? <div className="inline-error" role="alert"><span>{error}</span></div> : null}
      {notice ? <div className="studio-video-notice" role="status"><Check size={15} /><span>{notice}</span></div> : null}
      {mode === "voice" ? <section className="voice-panel"><div className={`voice-orb ${listening ? "listening" : ""}`}><span><Mic size={30} /></span></div><h1>{listening ? "Listening…" : "ELIAS is ready"}</h1><p>{listening ? "Speak naturally. Your transcript stays visible before you send it." : "Use browser speech recognition, review the transcript, then hand it to chat."}</p><button type="button" className={`primary voice-button ${listening ? "danger" : ""}`} onClick={toggleVoice}>{listening ? <><MicOff size={17} /> stop</> : <><Mic size={17} /> start voice</>}</button>{transcript ? <div className="transcript-card"><strong>Transcript</strong><span>{transcript}</span><div className="transcript-actions"><Link className="primary" href={`/chat?prompt=${encodeURIComponent(transcript)}`}><Check size={15} /> use in chat</Link><Link className="secondary" href={`/chat?prompt=${encodeURIComponent(transcript)}`}>open chat</Link></div></div> : null}<div className="studio-capability-note"><div><Video size={16} /><span><strong>Text-to-video</strong><small>{videoAvailable ? "A compatible async worker is configured." : "Requires a configured async video worker endpoint."}</small></span></div><div><ImageIcon size={16} /><span><strong>Image analysis</strong><small>Configure a vision model to analyze snapshots.</small></span></div></div></section> : mode === "generate" ? <section className="studio-generation-panel">
        <div className="studio-generation-intro"><span className="studio-generation-icon">{generateType === "image" ? <Sparkles size={22} /> : <Video size={22} />}</span><div><h2>Generate {generateType}</h2><p>{generateType === "image" ? "Submit an image task through the existing image provider. Completed assets are stored with the task and shown in your Library." : videoAvailable ? "Create a short text-to-video job with the configured worker. The job runs asynchronously and can be resumed from this page." : "Video submissions are not available until a compatible async worker endpoint is configured."}</p></div></div>
        <div className="studio-generation-kind" role="group" aria-label="Asset type"><button type="button" className={generateType === "image" ? "active" : ""} onClick={() => { setGenerateType("image"); setError(""); }}><ImageIcon size={15} /> Image</button><button type="button" className={generateType === "video" ? "active" : ""} onClick={() => { setGenerateType("video"); setError(""); }}><Video size={15} /> Video</button></div>
        <textarea value={generatePrompt} onChange={(event) => setGeneratePrompt(event.target.value)} rows={5} maxLength={generateType === "video" ? 2_000 : 8_000} placeholder={generateType === "video" ? "Describe the short text-to-video scene. Human characters must be fictional adults (18+)." : "Describe the image you want Elias to generate…"} />
        {generateType === "video" ? <>
          <label className="studio-video-confirm"><input type="checkbox" checked={confirmFictionalAdults} onChange={(event) => setConfirmFictionalAdults(event.target.checked)} /><span>I confirm any people shown are fictional adults (18+), not real-person likenesses. I understand automated prompt checks are imperfect.</span></label>
          <p className="studio-video-limits">Text-to-video only · 1–4 seconds · up to 512×512 · MP4 up to 16 MB. No image-to-video inputs.</p>
        </> : null}
        <button type="button" className="primary wide" disabled={!generatePrompt.trim() || generateBusy || (generateType === "video" && (!confirmFictionalAdults || !videoAvailable))} onClick={() => generateType === "image" ? void generateImage() : void generateVideo()}>{generateBusy ? <><LoaderCircle size={15} className="spin" /> Submitting…</> : generateType === "image" ? <><WandSparkles size={15} /> Generate image</> : <><Video size={15} /> Queue video job</>}</button>
        {generateType === "image" && generated ? <div className="studio-generation-success"><Check size={16} /><span><strong>{generated.name}</strong><small>Generation complete and stored in the task artifact pipeline.</small></span><Link className="secondary" href={`/tasks?id=${encodeURIComponent(generated.taskId)}`}>Open task</Link></div> : null}
        {generateType === "video" && videoJob ? <div className={`studio-video-job ${videoJob.status}`} role="status"><div className="studio-video-job-head"><Video size={16} /><strong>{videoJob.status === "completed" ? "Video ready" : videoJob.status === "failed" ? "Video job failed" : "Video job " + videoJob.status}</strong><span>{videoJob.status === "completed" ? "100%" : `${videoJob.progress}%`}</span></div>{videoPending ? <progress max={100} value={videoJob.progress} aria-label="Video job progress" /> : null}{videoJob.error ? <p>{videoJob.error}</p> : videoJob.lastPollError ? <p>Status check will retry: {videoJob.lastPollError}</p> : null}
            {videoArtifact && videoArtifactHref ? <><video className="studio-video-preview" src={videoArtifactHref} controls playsInline preload="metadata" /><small>{videoArtifact.name} · {videoArtifact.size ? `${(videoArtifact.size / (1024 * 1024)).toFixed(1)} MB` : "MP4"}</small></> : null}
            <div className="studio-video-job-actions"><Link className="secondary" href={`/tasks?id=${encodeURIComponent(videoJob.task.id)}`}>Open task</Link>{videoJob.status === "failed" ? <button type="button" className="secondary" disabled={generateBusy || !confirmFictionalAdults || videoJob.retryCount >= 2} onClick={() => void generateVideo(videoJob.task.id)}>Retry video {videoJob.retryCount >= 2 ? "(limit reached)" : ""}</button> : null}</div>
          </div> : null}
        {generateType === "video" ? <div className="studio-capability-note"><div><Video size={16} /><span><strong>Video worker</strong><small>{videoAvailable ? "Configured endpoint detected; model compatibility and pricing depend on that service." : "No endpoint configured. Add ELIAS_VIDEO_API_URL and optional server-side token."}</small></span></div><div><Mic size={16} /><span><strong>Text to speech</strong><small>Not part of this video integration.</small></span></div></div> : null}
      </section> : <section className="camera-panel"><div className="camera-frame">{cameraReady ? <video ref={video} autoPlay playsInline muted /> : <div className="camera-empty"><Camera size={28} /><strong>Camera preview</strong><small>Start camera to begin.</small></div>}</div><div className="camera-controls"><button type="button" onClick={stopCamera} aria-label="Stop camera"><X size={20} /></button><button type="button" className="shutter" onClick={() => void capture()} aria-label="Save snapshot" /><button type="button" onClick={() => void startCamera()} aria-label="Restart camera"><RefreshCcw size={20} /></button></div><small className="camera-caption">Snapshots are saved as local artifacts. No image is sent to a model.</small></section>}
    </section>
  </main></AppShell>;
}
