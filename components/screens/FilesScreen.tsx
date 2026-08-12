"use client";

import { Archive, Download, FileCode2, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { deleteArtifact, getArtifacts, type ArtifactRecord } from "@/lib/persistence";

function iconFor(name: string) {
  if (name.endsWith(".zip")) return <Archive size={17} />;
  if (name.match(/\.(png|jpg|jpeg|webp)$/i)) return <ImageIcon size={17} />;
  if (name.match(/\.(tsx|ts|jsx|js|css|html|py|java)$/i)) return <FileCode2 size={17} />;
  return <FileText size={17} />;
}

export default function FilesScreen() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  async function reload() {
    try { setArtifacts(await getArtifacts()); } catch { setArtifacts([]); }
  }
  useEffect(() => { void reload(); }, []);

  function download(artifact: ArtifactRecord) {
    if (!artifact.blob && artifact.text === undefined) return;
    const blob = artifact.blob || new Blob([artifact.text || ""], { type: artifact.type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = artifact.name; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Files">
      <main className="screen">
        <ScreenHeader title="Artifacts / files" />
        <section className="panel file-library-head"><div><p className="eyebrow">device-persistent artifacts</p><h2>Your generated files</h2><small>Outputs are stored in this browser until a server storage provider is configured.</small></div></section>
        <div className="file-list">
          {artifacts.map((artifact) => <div className="file-row" key={artifact.id}><span className="file-icon">{iconFor(artifact.name)}</span><span className="file-row-main"><strong>{artifact.name}</strong><small>{artifact.type} · {new Date(artifact.createdAt).toLocaleString()}</small></span><span className="file-row-actions">{artifact.text !== undefined ? <button type="button" className="icon-btn" title="Preview" onClick={() => setPreview(preview === artifact.id ? null : artifact.id)}><FileText size={16} /></button> : null}{artifact.blob || artifact.text !== undefined ? <button type="button" className="icon-btn" title="Download" onClick={() => download(artifact)}><Download size={16} /></button> : null}<button type="button" className="icon-btn danger-icon" title="Delete" onClick={() => { void deleteArtifact(artifact.id).then(reload); }}>{/* no fake persistence */}<Trash2 size={16} /></button></span>{preview === artifact.id && artifact.text !== undefined ? <pre className="artifact-preview">{artifact.text}</pre> : null}</div>)}
          {!artifacts.length ? <div className="empty-projects"><Archive size={22} /><b>No artifacts yet</b><small>Export a project ZIP or ask ELIAS to create a document from a coding workspace.</small></div> : null}
        </div>
      </main>
    </AppShell>
  );
}
