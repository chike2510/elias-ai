"use client";

import { useState } from "react";
import { ExternalLink, Globe2, LoaderCircle, Search, Save } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

export default function ResearchScreen() {
  const [question, setQuestion] = useState("what are the latest changes in Next.js that could affect StoreOS?");
  const [answer, setAnswer] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/research", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({question}) });
      const data = await res.json();
      setAnswer(data.content || data.error || "No result.");
      setProvider(data.provider || "");
    } finally { setBusy(false); }
  }

  return <AppShell title="Research">
    <main className="screen">
      <ScreenHeader title="Research" />
      <div className="research-box"><div className="research-label"><Globe2 size={16}/> live research</div><textarea value={question} onChange={(e)=>setQuestion(e.target.value)} rows={4}/><button className="primary wide" onClick={run} disabled={busy}>{busy?<><LoaderCircle className="spin" size={16}/> researching…</>:<><Search size={16}/> search + synthesize</>}</button></div>
      {answer ? <section className="panel research-result"><div className="panel-head"><h3>research brief</h3>{provider && <span>{provider}</span>}</div><div className="markdown">{answer}</div><div className="source-actions"><button><Save size={15}/> save to project</button><button><ExternalLink size={15}/> export</button></div></section> : <section className="panel"><div className="empty-state"><Globe2 size={22}/><b>bring live information into ELIAS</b><small>use a provider with live web-search capability for current web research.</small></div></section>}
    </main>
  </AppShell>;
}