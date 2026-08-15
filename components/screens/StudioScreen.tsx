"use client";

import Link from "next/link";
import { Camera, Check, Image as ImageIcon, Mic, MicOff, RefreshCcw, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { makeId, saveArtifact } from "@/lib/persistence";

type Recognition = { lang: string; interimResults: boolean; onstart: (() => void) | null; onend: (() => void) | null; onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null; start: () => void; stop: () => void };

export default function StudioScreen() {
  const [mode, setMode] = useState<"voice" | "camera">("voice");
  const [listening, setListening] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    if (requestedMode === "camera" || requestedMode === "voice") setMode(requestedMode);
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
    next.onresult = (event) => {
      const value = Array.from(event.results || []).map((result) => result?.[0]?.transcript || "").join(" ").trim();
      if (value) setTranscript(value);
    };
    recognition.current = next;
    next.start();
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

  return <AppShell title="Studio"><main className="screen studio-screen"><ScreenHeader title="Voice + camera" /><div className="studio-tabs"><button className={mode === "voice" ? "active" : ""} onClick={() => { setMode("voice"); stopCamera(); }}><Mic size={16} /> Voice</button><button className={mode === "camera" ? "active" : ""} onClick={() => { setMode("camera"); void startCamera(); }}><Camera size={16} /> Camera</button></div>{error ? <div className="inline-error">{error}</div> : null}{mode === "voice" ? <section className="voice-panel"><div className={`voice-orb ${listening ? "listening" : ""}`}><span><Mic size={32} /></span></div><h2>{listening ? "Listening…" : "ELIAS is ready"}</h2><p>{listening ? "Speak naturally. Your transcript stays visible before you send it." : "Use browser speech recognition, review the transcript, then hand it to chat."}</p><button className={`primary voice-button ${listening ? "danger" : ""}`} onClick={toggleVoice}>{listening ? <><MicOff size={17} /> stop</> : <><Mic size={17} /> start voice</>}</button>{transcript ? <div className="transcript-card"><span>{transcript}</span><div className="transcript-actions"><Link className="primary" href={`/tasks?prompt=${encodeURIComponent(transcript)}`}><Check size={15} /> use as task</Link><Link className="secondary" href={`/chat?prompt=${encodeURIComponent(transcript)}`}>use in chat</Link></div></div> : null}<div className="studio-capability-note"><Video size={15} /><span>Video description is unavailable without a configured video model.</span><ImageIcon size={15} /><span>Image analysis is unavailable without a configured vision model.</span></div></section> : <section className="camera-panel"><div className="camera-frame">{cameraReady ? <video ref={video} autoPlay playsInline muted /> : <div className="camera-empty"><Camera size={28} /><span>camera preview</span><small>start camera to begin</small></div>}</div><div className="camera-controls"><button onClick={stopCamera} aria-label="Stop camera"><X size={20} /></button><button className="shutter" onClick={() => void capture()} aria-label="Save snapshot" /><button onClick={() => void startCamera()} aria-label="Restart camera"><RefreshCcw size={20} /></button></div><small className="camera-caption">Snapshots are saved as local artifacts. No image is sent to a model.</small></section>}</main></AppShell>;
}
