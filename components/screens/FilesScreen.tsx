"use client";

import { Archive, ArrowUpRight, Download, FileCode2, FileText, Image as ImageIcon, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { deleteArtifact, getArtifacts, type ArtifactRecord } from "@/lib/persistence";

function iconFor(name: string) { if (name.endsWith(".zip")) return <Archive size={18} />; if (/\.(png|jpg|jpeg|webp)$/i.test(name)) return <ImageIcon size={18} />; if (/\.(tsx|ts|jsx|js|css|html|py|java)$/i.test(name)) return <FileCode2 size={18} />; return <FileText size={18} />; }
function typeFor(name: string) { if (/\.pdf$/i.test(name)) return "PDF"; if (/\.docx?$/i.test(name)) return "DOC"; if (/\.md$/i.test(name)) return "MD"; if (/\.(tsx|ts|jsx|js|css|html)$/i.test(name)) return "CODE"; return "FILE"; }

export default function FilesScreen() {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  async function reload() { try { setArtifacts(await getArtifacts()); } catch { setArtifacts([]); } }
  useEffect(() => { void reload(); }, []);
  function download(artifact: ArtifactRecord) { if (!artifact.blob && artifact.text === undefined) return; const blob = artifact.blob || new Blob([artifact.text || ""], { type: artifact.type || "text/plain" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = artifact.name; anchor.click(); URL.revokeObjectURL(url); }
  const filtered = artifacts.filter((artifact) => `${artifact.name} ${artifact.type}`.toLowerCase().includes(query.toLowerCase()));

  return <AppShell title="Library"><main className="screen library-screen"><header className="compact-destination-header"><div><span className="eyebrow">FILES</span><h1>Library</h1></div><span className="library-count">{filtered.length}</span></header><div className="searchbox library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></div><div className="file-list library-list">{filtered.map((artifact) => <div className="file-row library-row" key={artifact.id}><span className={`file-icon file-type-${typeFor(artifact.name).toLowerCase()}`}>{iconFor(artifact.name)}<small>{typeFor(artifact.name)}</small></span><span className="file-row-main"><strong>{artifact.name}</strong><small>{artifact.pageCount ? `${artifact.pageCount} pages · ` : ""}{artifact.chunks?.length ? `${artifact.chunks.length} chunks · ` : ""}{new Date(artifact.createdAt).toLocaleDateString()}</small></span><span className="file-row-actions"><button type="button" className="secondary preview-button" onClick={() => artifact.text !== undefined && setPreview(preview === artifact.id ? null : artifact.id)}>{artifact.text !== undefined ? "Preview" : "View"}</button>{artifact.blob || artifact.text !== undefined ? <button type="button" className="icon-btn" title="Download" onClick={() => download(artifact)}><Download size={16} /></button> : null}<button type="button" className="icon-btn danger-icon" title="Delete" onClick={() => { void deleteArtifact(artifact.id).then(reload); }}><Trash2 size={16} /></button></span>{preview === artifact.id && artifact.text !== undefined ? <div className="artifact-preview"><strong>{artifact.summary ? "Summary" : "Text"}</strong><pre>{artifact.text}</pre>{artifact.chunks?.length ? <small>{artifact.chunks.length} searchable chunks</small> : null}</div> : null}</div>)}{!filtered.length ? <div className="empty-projects panel"><Archive size={22} /><b>{query ? "No matches" : "No files yet"}</b><small>{query ? "Try another search." : "Files uploaded or created by Elias appear here."}</small><a className="primary" href="/chat">Open Chat <ArrowUpRight size={14} /></a></div> : null}</div></main></AppShell>;
}
