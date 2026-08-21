"use client";

import Link from "next/link";
import { ArrowUpRight, Code2, Folder, Github, Plus, Search } from "lucide-react";
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
    try { const response = await fetch("/api/github/repos", { cache: "no-store" }); const data = await response.json(); setRepositories(data.repositories || []); } catch { setRepositories([]); }
  }
  useEffect(() => { void refresh(); }, []);

  async function createProject() {
    const project: ProjectRecord = { id: makeId("project"), name: "New workspace", description: "", createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(project);
    window.location.href = `/agent?project=${encodeURIComponent(project.id)}`;
  }

  const term = query.toLowerCase();
  const visibleRepositories = repositories.filter((repo) => `${repo.fullName} ${repo.description}`.toLowerCase().includes(term));
  const visibleProjects = projects.filter((project) => `${project.name} ${project.description || ""}`.toLowerCase().includes(term));

  return <AppShell title="Projects"><main className="screen projects-screen"><header className="compact-destination-header"><div><span className="eyebrow">WORKSPACE</span><h1>Projects</h1></div><button className="primary" onClick={() => void createProject()}><Plus size={15} /> New</button></header><div className="searchbox project-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></div><section className="project-list connected-project-list">{visibleRepositories.map((repo) => { const [owner, name] = repo.fullName.split("/"); return <Link href={`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`} key={`github-${repo.id}`} className="connected-service-row"><span className="service-icon github"><Github size={20} /></span><span className="project-copy"><strong>{repo.fullName}</strong><small>{repo.description || "GitHub repository"}</small><em>{repo.private ? "Private" : "Public"}{repo.language ? ` · ${repo.language}` : ""} · Work in Elias</em></span><ArrowUpRight size={16} /></Link>; })}{visibleProjects.map((project) => <Link href={`/agent?project=${encodeURIComponent(project.id)}`} key={project.id} className="connected-service-row"><span className="service-icon local"><Code2 size={20} /></span><span className="project-copy"><strong>{project.name}</strong><small>{project.description || "Local workspace"}</small><em>Local workspace</em></span><ArrowUpRight size={16} /></Link>)}</section>{!visibleRepositories.length && !visibleProjects.length ? <section className="empty-projects panel"><Folder size={22} /><b>{query ? "No matches" : "No projects yet"}</b><small>{query ? "Try another search." : "Connect GitHub or create a workspace."}</small><div className="empty-project-actions"><Link className="secondary" href="/connectors/github">Connect GitHub</Link><button className="secondary" onClick={() => void createProject()}>Create workspace</button></div></section> : null}</main></AppShell>;
}
