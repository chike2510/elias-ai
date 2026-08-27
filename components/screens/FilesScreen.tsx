"use client";

import { Archive, ArrowUpRight, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import ArtifactCard from "@/components/artifacts/ArtifactCard";
import ArtifactPreviewSheet from "@/components/artifacts/ArtifactPreviewSheet";
import { deleteArtifact, getArtifacts, type ArtifactRecord } from "@/lib/persistence";

export default function FilesScreen() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [preview, setPreview] = useState<ArtifactRecord | null>(null);
  const [query, setQuery] = useState("");
  async function reload() { try { setArtifacts(await getArtifacts()); } catch { setArtifacts([]); } }
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
      {filtered.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} taskLabel={artifact.pageCount ? "Document" : undefined} onPreview={() => setPreview(artifact)} onDownload={() => download(artifact)} />)}
      {!filtered.length ? <div className="empty-state panel"><Archive size={22} /><b>{query ? "No matches" : "No files yet"}</b><small>{query ? "Try another search." : "Files uploaded or created by Elias appear here."}</small><a className="primary" href="/chat">Open Chat <ArrowUpRight size={14} /></a></div> : null}
    </section>
    <ArtifactPreviewSheet artifact={preview} onClose={() => setPreview(null)} onDownload={preview ? () => download(preview) : undefined} />
  </main></AppShell>;
}
