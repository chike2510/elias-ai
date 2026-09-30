"use client";

import { Archive, ArrowUpRight, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import ArtifactCard from "@/components/artifacts/ArtifactCard";
import ArtifactPreviewSheet from "@/components/artifacts/ArtifactPreviewSheet";
import { deleteArtifact, getArtifacts, saveArtifact, type ArtifactRecord } from "@/lib/persistence";
import { readApiResponse } from "@/lib/clientApi";
import { syncTaskArtifactToLibrary } from "@/lib/taskArtifactLibrary";
import type { TaskRecord } from "@/lib/task";

export default function FilesScreen() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [preview, setPreview] = useState<ArtifactRecord | null>(null);
  const [query, setQuery] = useState("");
  async function reload() {
    try {
      const local = await getArtifacts();
      setArtifacts(local);
      try {
        const data = await readApiResponse<{ tasks?: TaskRecord[] }>(await fetch("/api/tasks", { cache: "no-store" }));
        const videoTasks = (data.tasks || []).filter((task) => task.videoGeneration?.status === "completed" && task.videoGeneration.artifactId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .filter((task) => {
            const artifact = task.artifacts.find((item) => item.id === task.videoGeneration?.artifactId);
            return Boolean(artifact && !local.some((item) => item.id === `task_${task.id}_${artifact.id}`));
          }).slice(0, 10);
        let changed = false;
        for (const task of videoTasks) {
          const videoArtifact = task.artifacts.find((artifact) => artifact.id === task.videoGeneration?.artifactId);
          if (!videoArtifact || local.some((artifact) => artifact.id === `task_${task.id}_${videoArtifact.id}`)) continue;
          try {
            const record = await syncTaskArtifactToLibrary(task, videoArtifact, { save: saveArtifact, maxRetries: 1 });
            local.push(record as ArtifactRecord);
            changed = true;
          } catch { /* keep the task download available if local browser storage is full */ }
        }
        if (changed) setArtifacts(await getArtifacts());
      } catch { /* a local Library remains available when the task service is offline */ }
    } catch { setArtifacts([]); }
  }
  useEffect(() => { void reload(); }, []);
  function download(artifact: ArtifactRecord) {
    if (!artifact.blob && artifact.text === undefined) return;
    const blob = artifact.blob || new Blob([artifact.text || ""], { type: artifact.type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 250);
  }
  const filtered = artifacts.filter((artifact) => `${artifact.name} ${artifact.type} ${artifact.summary || ""}`.toLowerCase().includes(query.toLowerCase()));

  return <AppShell title="Library"><main className="screen library-screen workspace-destination">
    <header className="screen-header"><div className="screen-header-copy"><span className="eyebrow">FILES</span><h1>Library</h1><p className="screen-description">Files uploaded or created by Elias, ready to revisit.</p></div><span className="library-count quiet-badge">{filtered.length}</span></header>
    <div className="searchbox library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /><span className="search-hint">{filtered.length}</span></div>
    <section className="artifact-library-list" aria-label="Elias artifacts">
      {filtered.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} taskLabel={artifact.taskId ? "Task output" : artifact.pageCount ? "Document" : undefined} onPreview={() => setPreview(artifact)} onDownload={() => download(artifact)} />)}
      {!filtered.length ? <div className="empty-state panel"><Archive size={22} /><b>{query ? "No matches" : "No files yet"}</b><small>{query ? "Try another search." : "Files uploaded or created by Elias appear here."}</small><a className="primary" href="/chat">Open Chat <ArrowUpRight size={14} /></a></div> : null}
    </section>
    <ArtifactPreviewSheet artifact={preview} onClose={() => setPreview(null)} onDownload={preview ? () => download(preview) : undefined} />
  </main></AppShell>;
}
