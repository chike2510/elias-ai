"use client";

import Link from "next/link";
import { Code2, FileText, Globe2, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  makeId,
  getProjects,
  saveProject,
  type ProjectRecord,
} from "@/lib/persistence";

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState("");

  async function refresh() {
    try {
      setProjects(await getProjects());
    } catch {
      setProjects([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createProject() {
    const project: ProjectRecord = {
      id: makeId("project"),
      name: "New coding workspace",
      description: "ELIAS autonomous project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveProject(project);
    window.location.href = `/agent?project=${encodeURIComponent(project.id)}`;
  }

  const filtered = projects.filter((project) =>
    `${project.name} ${project.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <AppShell title="Projects">
      <main className="screen">
        <div className="screen-title">
          <span>Projects</span>
          <button className="primary small-button" onClick={() => void createProject()}>
            <Plus size={15} />
            new
          </button>
        </div>

        <div className="searchbox">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects..."
          />
        </div>

        <div className="filter-row">
          <b>All</b>
          <span>Code</span>
          <span>Research</span>
          <span>Study</span>
        </div>

        <div className="project-list">
          {filtered.map((project) => (
            <Link
              href={`/agent?project=${encodeURIComponent(project.id)}`}
              key={project.id}
              className="project-row"
            >
              <span className="project-icon">
                <Code2 size={18} />
              </span>
              <span className="project-copy">
                <strong>{project.name}</strong>
                <small>
                  {project.description || "ELIAS workspace"}
                </small>
              </span>
              <span className="live-dot" />
            </Link>
          ))}
        </div>

        {!filtered.length && (
          <div className="empty-projects">
            <Sparkles size={22} />
            <b>No saved projects yet</b>
            <small>
              Create a project or start a conversation and turn it into a coding workspace.
            </small>
            <button className="secondary" onClick={() => void createProject()}>
              <Plus size={15} />
              create workspace
            </button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
