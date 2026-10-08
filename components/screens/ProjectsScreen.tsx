"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Code2, Github, Lock, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { makeId, getProjects, saveProject, type ProjectRecord } from "@/lib/persistence";

type Repository = { id: number; fullName: string; description: string; private: boolean; url: string; language: string; defaultBranch?: string; updatedAt?: string; canWrite?: boolean };
type ReposResponse = { connected?: boolean; writeReady?: boolean; workflowReady?: boolean; reconnectRequired?: boolean; repositories?: Repository[]; message?: string };
type GitHubState = { status: "loading" | "connected" | "reconnect" | "disconnected" | "error"; writeReady: boolean; workflowReady: boolean; message: string };

/** Accepts "owner/repo" or any github.com URL to a repo. */
export function parseRepositoryInput(value: string): { owner: string; repo: string } | undefined {
  const trimmed = value.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i) || trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

function ago(iso?: string) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days}d ago` : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
}

export default function ProjectsScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [github, setGithub] = useState<GitHubState>({ status: "loading", writeReady: false, workflowReady: true, message: "" });
  const [query, setQuery] = useState("");
  const [openValue, setOpenValue] = useState("");
  const [openError, setOpenError] = useState("");

  const refresh = useCallback(async () => {
    void getProjects().then(setProjects).catch(() => setProjects([]));
    setGithub((current) => ({ ...current, status: "loading" }));
    try {
      const response = await fetch("/api/github/repos", { cache: "no-store" });
      const data = await response.json() as ReposResponse;
      setRepositories(Array.isArray(data.repositories) ? data.repositories : []);
      const status: GitHubState["status"] = data.connected && response.ok ? "connected" : data.reconnectRequired && !data.connected ? "reconnect" : response.status === 401 ? "disconnected" : "error";
      setGithub({ status, writeReady: Boolean(data.writeReady), workflowReady: data.workflowReady !== false, message: data.message || "" });
    } catch {
      setRepositories([]);
      setGithub({ status: "error", writeReady: false, workflowReady: true, message: "Couldn't reach GitHub right now." });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createProject() {
    const project: ProjectRecord = { id: makeId("project"), name: "New workspace", description: "", createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(project);
    router.push(`/agent?project=${encodeURIComponent(project.id)}`);
  }

  function openRepository(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseRepositoryInput(openValue);
    if (!parsed) { setOpenError("Use owner/repo or a github.com link."); return; }
    router.push(`/repositories/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
  }

  const term = query.trim().toLowerCase();
  const visibleRepos = repositories.filter((repo) => `${repo.fullName} ${repo.description} ${repo.language}`.toLowerCase().includes(term));
  const visibleProjects = (projects || []).filter((project) => `${project.name} ${project.description || ""}`.toLowerCase().includes(term));

  return <AppShell title="Projects">
    <main className="el-page v4-projects">
      <header className="el-page-head"><h1>Projects</h1><p>Your GitHub repositories and local workspaces. Open one to ask Elias about the code or have it make changes.</p></header>

      <div className="v4-chats-tools">
        <label className="v4-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /></label>
        <button type="button" className="el-btn" onClick={() => void createProject()}><Plus size={16} /> New</button>
      </div>

      {github.status === "reconnect" || github.status === "disconnected" ? <section className="v4-notice" role="status">
        <span className="el-list-icon warn"><Github size={17} /></span>
        <div><strong>{github.status === "reconnect" ? "Reconnect GitHub" : "Connect GitHub"}</strong><p>{github.status === "reconnect" ? "GitHub stopped accepting Elias's saved authorization. Reconnect once to see your repositories again." : "Connect GitHub to see your repositories here and let Elias work on them."}</p></div>
        <a className="el-btn el-btn-primary" href="/api/connect/github">{github.status === "reconnect" ? "Reconnect" : "Connect"}</a>
      </section> : null}
      {github.status === "error" ? <section className="v4-notice" role="status">
        <span className="el-list-icon warn"><Github size={17} /></span>
        <div><strong>GitHub didn't answer</strong><p>{github.message || "Try again in a moment."}</p></div>
        <button type="button" className="el-icon-btn" aria-label="Try again" onClick={() => void refresh()}><RefreshCw size={16} /></button>
      </section> : null}
      {github.status === "connected" && (!github.writeReady || !github.workflowReady) ? <p className="v4-hint">{!github.writeReady ? "Elias can read these repositories but not commit." : "Elias can't edit workflow files yet."} <a href="/api/connect/github">Reconnect GitHub</a> to {!github.writeReady ? "allow commits" : "allow that"}.</p> : null}

      {github.status !== "disconnected" && github.status !== "reconnect" ? <section className="el-section">
        <h2>GitHub {github.status === "connected" ? <small className="v4-count">{repositories.length}</small> : null}{github.status === "connected" ? <button type="button" className="el-icon-btn v4-refresh" aria-label="Refresh repositories" onClick={() => void refresh()}><RefreshCw size={15} /></button> : null}</h2>
        {github.status === "loading" ? <ListSkeleton rows={4} /> : null}
        {github.status === "connected" && !visibleRepos.length ? <p className="el-empty-line"><Github size={16} /> {term ? "No repositories match." : "This GitHub account returned no repositories."}</p> : null}
        {github.status === "connected" && visibleRepos.length ? <ul className="el-list">{visibleRepos.map((repo) => { const [owner, name] = repo.fullName.split("/"); return <li key={repo.id}><Link className="el-list-row" href={`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`}>
          <span className="el-list-icon"><Github size={17} /></span>
          <span className="el-list-text"><strong>{repo.fullName}</strong><small>{[repo.private ? "Private" : "Public", repo.language !== "Unknown" ? repo.language : "", repo.updatedAt ? `updated ${ago(repo.updatedAt)}` : ""].filter(Boolean).join(" · ")}</small>{repo.description && repo.description !== "No description" ? <small className="el-clamp">{repo.description}</small> : null}</span>
          {repo.canWrite === false ? <span className="el-state off" title="Read only"><Lock size={12} /> Read</span> : null}
          <ChevronRight size={17} className="el-list-trail" />
        </Link></li>; })}</ul> : null}
      </section> : null}

      <section className="el-section">
        <h2>Open a repository</h2>
        <form className="v4-open-repo" onSubmit={openRepository}>
          <label className="v4-search"><Github size={16} /><input value={openValue} onChange={(event) => { setOpenValue(event.target.value); setOpenError(""); }} placeholder="owner/repo or github.com link" aria-label="Repository" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
          <button type="submit" className="el-btn" disabled={!openValue.trim()}>Open</button>
        </form>
        {openError ? <p className="el-error-text" role="alert">{openError}</p> : null}
      </section>

      <section className="el-section">
        <h2>Local workspaces</h2>
        {!projects ? <ListSkeleton rows={2} /> : null}
        {projects && !visibleProjects.length ? <p className="el-empty-line"><Code2 size={16} /> {term ? "No workspaces match." : "None yet. Tap New to start one in this browser."}</p> : null}
        {visibleProjects.length ? <ul className="el-list">{visibleProjects.map((project) => <li key={project.id}><Link className="el-list-row" href={`/agent?project=${encodeURIComponent(project.id)}`}>
          <span className="el-list-icon"><Code2 size={17} /></span>
          <span className="el-list-text"><strong>{project.name}</strong><small>{project.description || "Local workspace"} · {ago(new Date(project.updatedAt).toISOString())}</small></span>
          <ChevronRight size={17} className="el-list-trail" />
        </Link></li>)}</ul> : null}
      </section>
    </main>
  </AppShell>;
}
