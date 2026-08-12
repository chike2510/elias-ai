import Link from "next/link";
import { Check, Circle, FileCode2, Hammer, Search, Sparkles, TestTube2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

const steps = [
  ["understand request", "done"],
  ["index project", "done"],
  ["identify relevant files", "done"],
  ["create implementation plan", "done"],
  ["edit files", "active"],
  ["run tests & build", "pending"],
  ["review changes", "pending"]
] as const;

export default function AgentScreen() {
  return <AppShell title="Agent activity">
    <main className="screen">
      <ScreenHeader title="Agent activity" back="/projects/storeos" />
      <section className="agent-hero"><span className="agent-badge"><Sparkles size={18}/></span><div><h2>fix authentication flow</h2><p>StoreOS · code agent</p></div><span className="agent-running">running</span></section>
      <section className="panel">
        <div className="panel-head"><h3>execution</h3><span>02:18</span></div>
        <div className="timeline">{steps.map(([label,state]) => <div className={`timeline-row ${state}`} key={label}><span className="timeline-icon">{state==="done"?<Check size={13}/>:state==="active"?<Circle size={13}/>:<Circle size={10}/>}</span><div><b>{label}</b><small>{state==="done"?"completed":state==="active"?"working now":"queued"}</small></div></div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>files</h3><span>3 changed</span></div>
        <div className="file-change"><p><FileCode2 size={15}/> app/login/page.tsx <small>updated</small></p><p><FileCode2 size={15}/> lib/auth.ts <small>updated</small></p><p><FileCode2 size={15}/> middleware.ts <small>created</small></p></div>
      </section>
      <section className="agent-result"><div><Hammer size={17}/><b>agent result</b><small>Build and tests start after the edit pass.</small></div><div className="result-actions"><Link href="/projects/storeos/code" className="primary">view changes</Link><Link href="/chat?prompt=review the authentication changes" className="secondary">ask ELIAS</Link></div></section>
    </main>
  </AppShell>;
}