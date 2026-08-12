"use client";

import { Camera, Image as ImageIcon, Mic, MicOff, RefreshCcw, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

export default function StudioScreen() {
  const [mode,setMode]=useState<"voice"|"camera">("voice");
  const [listening,setListening]=useState(false);
  const [cameraReady,setCameraReady]=useState(false);
  const video=useRef<HTMLVideoElement>(null);
  const stream=useRef<MediaStream|null>(null);

  useEffect(()=>()=>{stream.current?.getTracks().forEach(t=>t.stop())},[]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    stream.current=await navigator.mediaDevices.getUserMedia({video:true});
    if (video.current) video.current.srcObject=stream.current;
    setCameraReady(true);
  }

  function stopCamera(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCameraReady(false)}

  function toggleVoice() {
    const SpeechRecognition=(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Voice recognition is not available in this browser yet."); return; }
    if (listening) { setListening(false); return; }
    const recognition=new SpeechRecognition();
    recognition.lang="en-NG"; recognition.interimResults=true;
    recognition.onend=()=>setListening(false);
    recognition.onstart=()=>setListening(true);
    recognition.onresult=(e:any)=>console.log(e.results?.[0]?.[0]?.transcript);
    recognition.start();
  }

  return <AppShell title="Studio">
    <main className="screen studio-screen">
      <ScreenHeader title="Voice + camera" />
      <div className="studio-tabs"><button className={mode==="voice"?"active":""} onClick={()=>{setMode("voice");stopCamera()}}><Mic size={16}/> Voice</button><button className={mode==="camera"?"active":""} onClick={()=>{setMode("camera");void startCamera()}}><Camera size={16}/> Camera</button></div>

      {mode==="voice" ? <section className="voice-panel">
        <div className={`voice-orb ${listening?"listening":""}`}><span><Mic size={32}/></span></div>
        <h2>{listening?"Listening…":"ELIAS is ready"}</h2><p>{listening?"Speak naturally.":"Talk to ELIAS, ask questions, or tell it what to build."}</p>
        <button className={`primary voice-button ${listening?"danger":""}`} onClick={toggleVoice}>{listening?<><MicOff size={17}/> stop</>:<><Mic size={17}/> start voice</>}</button>
        <div className="studio-chips"><button><Video size={15}/> describe this video</button><button><ImageIcon size={15}/> analyze an image</button></div>
      </section> : <section className="camera-panel">
        <div className="camera-frame">{cameraReady?<video ref={video} autoPlay playsInline muted/>:<div className="camera-empty"><Camera size={28}/><span>camera preview</span><small>tap start camera to begin</small></div>}</div>
        <div className="camera-controls"><button onClick={stopCamera}><X size={20}/></button><button className="shutter" onClick={()=>alert("Captured frame — send it to ELIAS next.")}></button><button onClick={()=>void startCamera()}><RefreshCcw size={20}/></button></div>
      </section>}
    </main>
  </AppShell>;
}