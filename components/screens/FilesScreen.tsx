"use client";

import { Archive, ArrowUpRight, Download, FileCode2, FileText, Image as ImageIcon, LibraryBig, MoreHorizontal, Trash2 } from "lucide-react";
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

  return <AppShell title="Library"><main className="screen library-screen">
    <div className="destination-heading"><div><p className="eyebrow">ELIAS / deliverables</p><h1>Library</h1><p className="destination-dek">Deliverables and evidence from your work.</p></div><button className="secondary"><LibraryBig size={15} /> Create collection</button></div>
    <div className="library-layout"><div className="library-main">
      <div className="library-tabs"><b>Recent</b><span>Collections</span><span>Evidence</span><span className="library-count">{filtered.length} items</span></div>
      <div className="searchbox library-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search deliverables" /></div>
      <div className="file-list library-list">{filtered.map((artifact) => <div className="file-row library-row" key={artifact.id}><span className={`file-icon file-type-${typeFor(artifact.name).toLowerCase()}`}>{iconFor(artifact.name)}<small>{typeFor(artifact.name)}</small></span><span className="file-row-main"><strong>{artifact.name}</strong><small>{artifact.pageCount ? `${artifact.pageCount} pages · ` : ""}{artifact.chunks?.length ? `${artifact.chunks.length} chunks · ` : ""}{artifact.truncated ? "truncated · " : ""}From task <em>ELIAS workspace</em> · {new Date(artifact.createdAt).toLocaleDateString()}</small></span><span className="file-row-actions"><button type="button" className="secondary preview-button" onClick={() => artifact.text !== undefined && setPreview(preview === artifact.id ? null : artifact.id)}>{artifact.text !== undefined ? "Preview" : "View"}</button>{artifact.blob || artifact.text !== undefined ? <button type="button" className="icon-btn" title="Download" onClick={() => download(artifact)}><Download size={16} /></button> : null}<button type="button" className="icon-btn" title="More actions"><MoreHorizontal size={16} /></button><button type="button" className="icon-btn danger-icon" title="Delete" onClick={() => { void deleteArtifact(artifact.id).then(reload); }}><Trash2 size={16} /></button></span>{preview === artifact.id && artifact.text !== undefined ? <div className="artifact-preview"><strong>{artifact.summary ? "Study guide summary" : "Extracted text"}</strong><pre>{artifact.text}</pre>{artifact.chunks?.length ? <small>{artifact.chunks.length} searchable chunks are available for follow-up questions in Chat.</small> : null}</div> : null}</div>)}{!filtered.length ? <div className="empty-projects panel"><Archive size={22} /><b>No deliverables yet</b><small>Ask Elias to create a report, PDF, brief, or evidence pack and it will appear here.</small><a className="primary" href="/chat">Start a conversation <ArrowUpRight size={14} /></a></div> : null}</div>
    </div><aside className="library-filter panel"><div className="panel-head"><h3>Filter</h3><button className="text-action">Reset</button></div><label>Type<select><option>All types</option><option>PDF</option><option>Documents</option><option>Code</option></select></label><label>Project<select><option>All projects</option><option>Orion Platform</option></select></label><label>Date<select><option>Any time</option><option>This week</option><option>This month</option></select></label><div className="library-storage"><span>Storage status</span><strong>Browser persistence</strong><small>Connect server storage for shared, durable files.</small></div></aside></div>
  </main></AppShell>;
}
