"use client";

import Link from "next/link";
import { ArrowUpRight, Code2, FileText, Folder, GitBranch, Github, MoreVertical, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { makeId, getProjects, saveProject, type ProjectRecord } from "@/lib/persistence";

type Repository = { id: number; fullName: string; description: string; private: boolean; url: string; language: string };

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");

  async function refresh() {
    try { setProjects(await getProjects()); } catch { setProjects([]); }
    try {
      const response = await fetch("/api/github/repos", { cache: "no-store" });
      const data = await response.json();
      setRepositories(Array.isArray(data.repositories) ? data.repositories : []);
    } catch { setRepositories([]); }
  }

  useEffect(() => { void refresh(); }, []);

  async function createProject() {
    const project: ProjectRecord = { id: makeId("project"), name: "New workspace", description: "", createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(project);
    window.location.href = `/agent?project=${encodeURIComponent(project.id)}`;
  }

  const term = query.trim().toLowerCase();
  const visibleRepositories = repositories.filter((repo) => `${repo.fullName} ${repo.description}`.toLowerCase().includes(term));
  const visibleProjects = projects.filter((project) => `${project.name} ${project.description || ""}`.toLowerCase().includes(term));
  const hasProjects = visibleRepositories.length > 0 || visibleProjects.length > 0;

  return (
    <AppShell title="Projects">
      <main className="screen projects-screen workspace-destination">
        <header className="screen-header projects-heading">
          <div className="screen-header-copy"><span className="eyebrow">WORKSPACE</span><h1>Projects</h1><p className="screen-description">Connect a repository or open a local workspace.</p></div>
          <button className="primary projects-new" onClick={() => void createProject()}><Plus size={15} /> New</button>
        </header>
        <div className="searchbox project-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /><span className="search-hint">{visibleRepositories.length + visibleProjects.length}</span></div>

        {hasProjects ? (
          <section className="project-list project-card-list" aria-label="Projects"><div className="workspace-section-label"><span>Your workspaces</span><small>{visibleRepositories.length + visibleProjects.length} available</small></div>
            {visibleRepositories.map((repo) => {
              const [owner, name] = repo.fullName.split("/");
              return <Link href={`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`} key={`github-${repo.id}`} className="project-card">
                <div className="project-card-top"><span className="service-icon github"><Github size={22} /></span><span className="project-card-copy"><strong>{repo.fullName}</strong><small>{repo.description || "GitHub repository"}</small></span><MoreVertical size={18} className="project-card-menu" /></div>
                <div className="project-card-divider" />
                <div className="project-card-meta"><span><GitBranch size={14} /> {repo.private ? "private" : "public"}</span>{repo.language ? <span>{repo.language}</span> : null}<b>connected</b><ArrowUpRight size={15} /></div>
              </Link>;
            })}
            {visibleProjects.map((project) => <Link href={`/agent?project=${encodeURIComponent(project.id)}`} key={project.id} className="project-card">
              <div className="project-card-top"><span className="service-icon local"><Code2 size={22} /></span><span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || "Local workspace"}</small></span><MoreVertical size={18} className="project-card-menu" /></div>
              <div className="project-card-divider" />
              <div className="project-card-meta"><span><FileText size={14} /> {project.description ? "project" : "1 file"}</span><span>local</span><b>ready</b><ArrowUpRight size={15} /></div>
            </Link>)}
          </section>
        ) : <section className="empty-state panel"><Folder size={22} /><b>{query ? "No matches" : "No projects yet"}</b><small>{query ? "Try another search." : "Connect GitHub or create a workspace."}</small><div className="empty-project-actions"><Link className="secondary" href="/connectors/github">Connect GitHub</Link><button className="secondary" onClick={() => void createProject()}>Create workspace</button></div></section>}
      </main>
    </AppShell>
  );
}
