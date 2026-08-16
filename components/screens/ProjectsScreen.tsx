"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Cloud, Code2, Folder, Github, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { makeId, getProjects, saveProject, type ProjectRecord } from "@/lib/persistence";

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState("");

  async function refresh() { try { setProjects(await getProjects()); } catch { setProjects([]); } }
  useEffect(() => { void refresh(); }, []);

  async function createProject() {
    const project: ProjectRecord = { id: makeId("project"), name: "New coding workspace", description: "ELIAS autonomous project", createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(project);
    window.location.href = `/agent?project=${encodeURIComponent(project.id)}`;
  }

  const filtered = projects.filter((project) => `${project.name} ${project.description || ""}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <AppShell title="Projects">
      <main className="screen projects-screen">
        <div className="destination-heading"><div><p className="eyebrow">ELIAS / context</p><h1>Projects</h1><p className="destination-dek">The systems Elias works in.</p></div><button className="primary" onClick={() => void createProject()}><Plus size={15} /> New project</button></div>
        <div className="projects-layout">
          <div className="projects-main">
            <div className="searchbox"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></div>
            <div className="filter-row project-filters"><b>All projects</b><span>Connected</span><span>Local workspaces</span></div>
            <div className="project-list connected-project-list">
              <div className="connected-service-row"><span className="service-icon github"><Github size={20} /></span><span className="project-copy"><strong>Orion Platform</strong><small>GitHub repository · chike2510/orion-platform · main</small><em><i className="live-dot" /> Connected · Read repository and pull requests</em></span><ArrowUpRight size={16} /></div>
              <div className="connected-service-row"><span className="service-icon vercel"><Cloud size={20} /></span><span className="project-copy"><strong>Orion Platform</strong><small>Vercel production · orionplatform.app</small><em><i className="live-dot" /> Ready · View deployments and logs</em></span><ArrowUpRight size={16} /></div>
              {filtered.map((project) => <Link href={`/agent?project=${encodeURIComponent(project.id)}`} key={project.id} className="connected-service-row"><span className="service-icon local"><Code2 size={20} /></span><span className="project-copy"><strong>{project.name}</strong><small>{project.description || "Local coding workspace"}</small><em><i className="live-dot" /> Local workspace · Ready</em></span><ArrowUpRight size={16} /></Link>)}
            </div>
            {!filtered.length && !projects.length ? <div className="empty-projects panel"><Sparkles size={22} /><b>No local workspaces yet</b><small>Create a workspace to give Elias a place to inspect and edit files.</small><button className="secondary" onClick={() => void createProject()}><Plus size={15} /> Create workspace</button></div> : null}
          </div>
          <aside className="permissions-panel panel"><div className="panel-head"><h3>Project permissions</h3><span>Orion Platform</span></div><p>These permissions apply to the services connected to this workspace.</p><Permission icon={<Github size={16} />} label="Read repository" detail="Code, files, and metadata" granted /><Permission icon={<Code2 size={16} />} label="Inspect pull requests" detail="PRs, comments, and checks" granted /><Permission icon={<Cloud size={16} />} label="View deployments" detail="Deployments and logs" granted /><Permission icon={<Plus size={16} />} label="Propose changes" detail="Suggest a branch or pull request" /><button className="secondary wide"><Plus size={15} /> Connect service</button></aside>
        </div>
      </main>
    </AppShell>
  );
}

function Permission({ icon, label, detail, granted = false }: { icon: React.ReactNode; label: string; detail: string; granted?: boolean }) { return <div className="permission-row"><span className="permission-icon">{icon}</span><span><strong>{label}</strong><small>{detail}</small></span><span className={granted ? "permission-check granted" : "permission-check"}>{granted ? <Check size={13} /> : "–"}</span></div>; }
