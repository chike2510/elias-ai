"use client";

import { BookOpenCheck, FileUp, Brain, Sparkles, CheckCircle2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { useRef, useState } from "react";

export default function StudyScreen() {
  const input = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState(["CSC428_Topics.pdf","Memory Management.pdf","Operating Systems.docx"]);

  return <AppShell title="Study">
    <main className="screen">
      <ScreenHeader title="Study / documents" />
      <section className="study-hero"><span><BookOpenCheck size={25}/></span><div><h2>study with ELIAS</h2><p>Upload course material, then turn it into notes, questions, flashcards or a mock exam.</p></div></section>
      <input ref={input} hidden type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,.xlsx,.csv" onChange={(e)=>setDocs((d)=>[...d,...Array.from(e.target.files||[]).map(f=>f.name)])}/>
      <button className="upload-drop" onClick={()=>input.current?.click()}><FileUp size={25}/><b>upload your study materials</b><small>PDF, DOCX, PPTX, XLSX, TXT and images</small><span>choose files</span></button>
      <section className="panel"><div className="panel-head"><h3>recent documents</h3><span>{docs.length} files</span></div><div className="document-list">{docs.map((d)=><div key={d}><span className="doc-icon"><FileUp size={15}/></span><span><b>{d}</b><small>available to ELIAS</small></span><CheckCircle2 size={15} className="success"/></div>)}</div></section>
      <section className="study-actions">
        <button><Sparkles size={18}/> summarize</button>
        <button><Brain size={18}/> explain a topic</button>
        <button><CheckCircle2 size={18}/> generate questions</button>
        <button><BookOpenCheck size={18}/> make flashcards</button>
      </section>
    </main>
  </AppShell>;
}