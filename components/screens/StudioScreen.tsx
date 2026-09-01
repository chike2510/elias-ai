"use client";

import Link from "next/link";
import { Camera, Check, Image as ImageIcon, Mic, MicOff, RefreshCcw, Sparkles, Video, WandSparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { makeId, saveArtifact } from "@/lib/persistence";

type Recognition = { lang: string; interimResults: boolean; onstart: (() => void) | null; onend: (() => void) | null; onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null; start: () => void; stop: () => void };

export default function StudioScreen() {
  const [mode, setMode] = useState<"voice" | "camera" | "generate">("voice");
  const [listening, setListening] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generated, setGenerated] = useState<{ taskId: string; name: string } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    if (requestedMode === "camera" || requestedMode === "voice" || requestedMode === "generate") setMode(requestedMode);
    return () => { stream.current?.getTracks().forEach((track) => track.stop()); recognition.current?.stop(); };
  }, []);

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

  return <AppShell title="Studio"><main className="screen studio-screen">
    <ScreenHeader title="Voice + camera" />
    <section className="studio-card panel">
      <div className="studio-tabs" role="tablist" aria-label="Studio mode"><button type="button" className={mode === "voice" ? "active" : ""} onClick={() => { setMode("voice"); stopCamera(); }}><Mic size={16} /> Voice</button><button type="button" className={mode === "camera" ? "active" : ""} onClick={() => { setMode("camera"); void startCamera(); }}><Camera size={16} /> Camera</button><button type="button" className={mode === "generate" ? "active" : ""} onClick={() => { setMode("generate"); stopCamera(); }}><WandSparkles size={16} /> Generate</button></div>
      {error ? <div className="inline-error"><span>{error}</span></div> : null}
      {mode === "voice" ? <section className="voice-panel"><div className={`voice-orb ${listening ? "listening" : ""}`}><span><Mic size={30} /></span></div><h1>{listening ? "Listening…" : "ELIAS is ready"}</h1><p>{listening ? "Speak naturally. Your transcript stays visible before you send it." : "Use browser speech recognition, review the transcript, then hand it to chat."}</p><button type="button" className={`primary voice-button ${listening ? "danger" : ""}`} onClick={toggleVoice}>{listening ? <><MicOff size={17} /> stop</> : <><Mic size={17} /> start voice</>}</button>{transcript ? <div className="transcript-card"><strong>Transcript</strong><span>{transcript}</span><div className="transcript-actions"><Link className="primary" href={`/chat?prompt=${encodeURIComponent(transcript)}`}><Check size={15} /> use in chat</Link><Link className="secondary" href={`/chat?prompt=${encodeURIComponent(transcript)}`}>open chat</Link></div></div> : null}<div className="studio-capability-note"><div><Video size={16} /><span><strong>Video description</strong><small>Configure a video model to enable this capability.</small></span></div><div><ImageIcon size={16} /><span><strong>Image analysis</strong><small>Configure a vision model to analyze snapshots.</small></span></div></div></section> : mode === "generate" ? <section className="studio-generation-panel"><div className="studio-generation-intro"><span className="studio-generation-icon"><Sparkles size={22} /></span><div><h2>Generate an image</h2><p>Submit an image task through the free Pollinations provider. The completed asset is stored with the task and appears in Files.</p></div></div><textarea value={generatePrompt} onChange={(event) => setGeneratePrompt(event.target.value)} rows={5} placeholder="Describe the image you want Elias to generate…" /><button type="button" className="primary wide" disabled={!generatePrompt.trim() || generateBusy} onClick={() => void generateImage()}>{generateBusy ? "Generating…" : <><WandSparkles size={15} /> Generate image</>}</button>{generated ? <div className="studio-generation-success"><Check size={16} /><span><strong>{generated.name}</strong><small>Generation complete and stored in the task artifact pipeline.</small></span><Link className="secondary" href={`/tasks?id=${encodeURIComponent(generated.taskId)}`}>Open task</Link></div> : null}<div className="studio-capability-note"><div><Video size={16} /><span><strong>Video generation</strong><small>Deferred until a hosted video provider is configured.</small></span></div><div><Mic size={16} /><span><strong>Text to speech</strong><small>Deferred until a hosted TTS provider is configured.</small></span></div></div></section> : <section className="camera-panel"><div className="camera-frame">{cameraReady ? <video ref={video} autoPlay playsInline muted /> : <div className="camera-empty"><Camera size={28} /><strong>Camera preview</strong><small>Start camera to begin.</small></div>}</div><div className="camera-controls"><button type="button" onClick={stopCamera} aria-label="Stop camera"><X size={20} /></button><button type="button" className="shutter" onClick={() => void capture()} aria-label="Save snapshot" /><button type="button" onClick={() => void startCamera()} aria-label="Restart camera"><RefreshCcw size={20} /></button></div><small className="camera-caption">Snapshots are saved as local artifacts. No image is sent to a model.</small></section>}
    </section>
  </main></AppShell>;
}
