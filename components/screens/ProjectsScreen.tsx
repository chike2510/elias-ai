"use client";

import Link from "next/link";
import { ArrowUpRight, Code2, FileText, Folder, GitBranch, Github, LoaderCircle, MoreVertical, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { makeId, getProjects, saveProject, type ProjectRecord } from "@/lib/persistence";

type Repository = { id: number; fullName: string; description: string; private: boolean; url: string; language: string };

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubWriteReady, setGithubWriteReady] = useState(false);
  const [githubMessage, setGithubMessage] = useState("");

  async function refresh() {
    try { setProjects(await getProjects()); } catch { setProjects([]); }
    setGithubLoading(true);
    try {
      const response = await fetch("/api/github/repos", { cache: "no-store" });
      const data = await response.json() as { connected?: boolean; writeReady?: boolean; repositories?: Repository[]; message?: string };
      setGithubConnected(Boolean(data.connected));
      setGithubWriteReady(Boolean(data.writeReady));
      setRepositories(Array.isArray(data.repositories) ? data.repositories : []);
      setGithubMessage(data.message || "");
    } catch {
      setGithubConnected(false);
      setGithubWriteReady(false);
      setRepositories([]);
      setGithubMessage("Could not reach the GitHub repository service.");
    } finally {
      setGithubLoading(false);
    }
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
        <div className={`projects-source-status ${githubLoading ? "loading" : githubConnected ? "connected" : "disconnected"}`}><span>{githubLoading ? <LoaderCircle size={13} className="spin" /> : <span className="source-status-dot" />}{githubLoading ? "Checking GitHub repositories…" : githubConnected ? `GitHub connected · ${repositories.length} repos · ${githubWriteReady ? "commits enabled" : "reconnect for commits"}` : (githubMessage || "GitHub is not connected")}</span>{!githubLoading && !githubConnected ? <Link href="/connectors/github">Connect GitHub</Link> : <Link href="/connectors/github">{githubConnected && !githubWriteReady ? "Reconnect" : "Manage"}</Link>}{!githubLoading ? <button type="button" aria-label="Refresh GitHub repositories" onClick={() => void refresh()}><RefreshCw size={13} /></button> : null}</div>

        {githubLoading ? <section className="empty-state panel project-loading-state"><LoaderCircle size={21} className="spin" /><b>Loading your projects</b><small>Checking local workspaces and connected GitHub repositories.</small></section> : hasProjects ? (
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
        ) : <section className="empty-state panel"><Folder size={22} /><b>{query ? "No matches" : githubConnected ? "No GitHub repositories found" : "No projects yet"}</b><small>{query ? "Try another search." : githubConnected ? "GitHub is connected, but this account returned no repositories. Reconnect to refresh permissions or create a local workspace." : (githubMessage || "Connect GitHub or create a workspace.")}</small><div className="empty-project-actions">{!githubConnected ? <Link className="secondary" href="/connectors/github">Connect GitHub</Link> : <Link className="secondary" href="/connectors/github">Reconnect GitHub</Link>}<button className="secondary" onClick={() => void createProject()}>Create workspace</button></div></section>}
      </main>
    </AppShell>
  );
}
