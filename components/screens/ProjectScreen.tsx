import Link from "next/link";
import { Activity, Code2, FileText, GitBranch, Github, Package, Play, Settings2, ShieldCheck, UploadCloud } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

export default function ProjectScreen() {
  return <AppShell title="StoreOS">
    <main className="screen">
      <ScreenHeader title="StoreOS" back="/projects" />
      <section className="project-overview">
        <div className="project-brand-row"><div className="project-logo"><Code2 size={25}/></div><div><h2>StoreOS</h2><p>The AI that runs your store</p></div><span className="status-chip">● active</span></div>
        <div className="project-metrics"><div><b>24</b><span>files</span></div><div><b>3</b><span>commits</span></div><div><b>5</b><span>integrations</span></div></div>
      </section>

      <div className="project-tabs"><span className="active">overview</span><Link href="/projects/storeos/code">code</Link><span>files</span><span>activity</span></div>

      <section className="panel">
        <div className="panel-head"><h3>tools & integrations</h3></div>
        <div className="integration-grid">
          <div><Github size={18}/><b>GitHub</b><small>connected</small></div>
          <div><GitBranch size={18}/><b>Vercel</b><small>deployed</small></div>
          <div><ShieldCheck size={18}/><b>Supabase</b><small>connected</small></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>quick actions</h3></div>
        <div className="action-list">
          <Link href="/projects/storeos/code"><Code2 size={17}/> Open code <span>›</span></Link>
          <Link href="/agent/storeos"><Activity size={17}/> Run agent task <span>›</span></Link>
          <button><Play size={17}/> Run build <span>›</span></button>
          <button><Package size={17}/> Export ZIP <span>›</span></button>
          <button><UploadCloud size={17}/> Import files <span>›</span></button>
          <button><Settings2 size={17}/> Project settings <span>›</span></button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>recent activity</h3><span>view all</span></div>
        <div className="activity-list"><p><b>fixed authentication bug</b><small>2 hours ago · 3 files</small></p><p><b>added product filters</b><small>1 day ago · dashboard</small></p><p><b>updated checkout flow</b><small>2 days ago · Stripe</small></p></div>
      </section>
    </main>
  </AppShell>;
}