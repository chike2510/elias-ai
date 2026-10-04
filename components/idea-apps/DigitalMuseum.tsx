"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bookmark, Brush, Search, X } from "lucide-react";
import StandaloneAppShell from "./StandaloneAppShell";

type Artwork = { id: string; title: string; artist: string; date: string; image: string; room: string; note: string; source: string; sourceLabel: string; sourceLine: string };
const artworks: Artwork[] = [
  { id: "bedroom", title: "The Bedroom", artist: "Vincent van Gogh", date: "1888", image: "/idea-apps/artworks/bedroom.jpg", room: "Rooms", note: "A familiar room becomes a study in rest and colour. Van Gogh’s simplified lines and saturated blues make the small space feel both intimate and strangely expansive.", source: "https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_De_slaapkamer_-_Google_Art_Project.jpg", sourceLabel: "Wikimedia Commons · public domain", sourceLine: "Vincent van Gogh. The Bedroom, 1888. Wikimedia Commons." },
  { id: "poets-garden", title: "The Poet’s Garden", artist: "Vincent van Gogh", date: "1888", image: "/idea-apps/artworks/poets-garden.jpg", room: "Gardens", note: "A garden is treated less like a view than a living surface. Short, energetic marks give the trees, sky, and path the same restless rhythm.", source: "https://www.artic.edu/artworks/14586/the-poet-s-garden", sourceLabel: "Art Institute of Chicago · public domain", sourceLine: "Vincent van Gogh. The Poet’s Garden, 1888. The Art Institute of Chicago." },
  { id: "self-portrait", title: "Self-Portrait", artist: "Vincent van Gogh", date: "1887", image: "/idea-apps/artworks/self-portrait.jpg", room: "People", note: "The surrounding colour moves as much as the face. The portrait is a close encounter with looking: direct, alert, and built from small, deliberate strokes.", source: "https://www.artic.edu/artworks/80607/self-portrait", sourceLabel: "Art Institute of Chicago · public domain", sourceLine: "Vincent van Gogh. Self-Portrait, 1887. The Art Institute of Chicago." },
  { id: "grande-jatte", title: "A Sunday on La Grande Jatte — 1884", artist: "Georges Seurat", date: "1884–86", image: "/idea-apps/artworks/sunday-la-grande-jatte.jpg", room: "Gardens", note: "A riverside afternoon is assembled from patient points of colour. Step back for the calm scene; look closer and the surface becomes a lively pattern.", source: "https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884", sourceLabel: "Art Institute of Chicago · public domain", sourceLine: "Georges Seurat. A Sunday on La Grande Jatte — 1884, 1884–86. The Art Institute of Chicago." },
];
const rooms = ["All works", "Rooms", "Gardens", "People"];
const savedKey = "elias-idea-museum-saved-v1";

export default function DigitalMuseum() {
  const [activeRoom, setActiveRoom] = useState("All works");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { const stored = localStorage.getItem(savedKey); if (stored) setSaved(JSON.parse(stored) as string[]); } catch { /* Start with an empty saved shelf. */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(savedKey, JSON.stringify(saved)); }, [saved, ready]);

  const visible = useMemo(() => artworks.filter((work) => {
    const roomMatches = showSaved ? saved.includes(work.id) : activeRoom === "All works" || work.room === activeRoom;
    const textMatches = `${work.title} ${work.artist} ${work.room}`.toLowerCase().includes(query.trim().toLowerCase());
    return roomMatches && textMatches;
  }), [activeRoom, query, saved, showSaved]);

  function toggleSaved(id: string) {
    setSaved((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  return (
    <StandaloneAppShell active="/museum">
      <div className="idea-page museum-page">
        <section className="museum-hero">
          <div className="museum-hero-copy"><p className="idea-eyebrow">02 / A SMALL DIGITAL COLLECTION</p><h1>Look a little <em>longer.</em></h1><p>An ad-free pocket gallery for art worth returning to. Four public-domain works, selected for the ways they turn a room, a garden, and a face into something memorable.</p><span className="museum-open-access"><Brush size={15} /> Every artwork shown is marked public domain by its source.</span></div>
          <div className="museum-hero-art"><img src="/idea-apps/artworks/poets-garden.jpg" alt="A lush garden in broad greens and golds, painted by Vincent van Gogh" /><span>THE POET’S GARDEN · 1888</span></div>
        </section>

        <div className="museum-toolbar">
          <div className="museum-room-tabs" role="tablist" aria-label="Collection rooms">{rooms.map((room) => <button key={room} type="button" role="tab" aria-selected={!showSaved && activeRoom === room} className={!showSaved && activeRoom === room ? "is-active" : ""} onClick={() => { setShowSaved(false); setActiveRoom(room); }}>{room}</button>)}<button type="button" className={showSaved ? "is-active" : ""} aria-pressed={showSaved} onClick={() => setShowSaved(true)}><Bookmark size={13} /> Saved ({saved.length})</button></div>
          <label className="museum-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an artwork" aria-label="Find an artwork" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}</label>
        </div>

        <div className="museum-grid" aria-live="polite">{visible.map((work) => <article className="museum-card" key={work.id}>
          <div className={`museum-card-image museum-${work.id}`}><img src={work.image} alt={`${work.title} by ${work.artist}`} loading="lazy" /><button type="button" className={`museum-save${saved.includes(work.id) ? " is-saved" : ""}`} aria-label={`${saved.includes(work.id) ? "Remove" : "Save"} ${work.title}`} aria-pressed={saved.includes(work.id)} onClick={() => toggleSaved(work.id)}><Bookmark size={16} fill={saved.includes(work.id) ? "currentColor" : "none"} /></button></div>
          <div className="museum-card-copy"><div className="museum-card-meta"><span>{work.room} · {work.date}</span><span>PUBLIC DOMAIN</span></div><h2>{work.title}</h2><p className="museum-artist">{work.artist}</p>
            <button className="museum-read-note" type="button" aria-expanded={expanded === work.id} onClick={() => setExpanded(expanded === work.id ? null : work.id)}>{expanded === work.id ? "Close wall note" : "Read the wall note"}<span>{expanded === work.id ? "−" : "+"}</span></button>
            {expanded === work.id && <p className="museum-note">{work.note}</p>}
            <a className="museum-credit" href={work.source} target="_blank" rel="noreferrer"><span>{work.sourceLine}</span><small>{work.sourceLabel} <ArrowUpRight size={12} /></small></a>
          </div>
        </article>)}</div>
        {visible.length === 0 && <div className="idea-empty-state"><Brush size={23} /><p>{showSaved ? "Your saved shelf is empty. Bookmark a work to keep it close." : "No works match that search. Try a different title or room."}</p></div>}
        <p className="museum-footnote">Images are local copies of Wikimedia Commons files explicitly marked public domain. Selected Art Institute works are cross-checked against its collection API. Open the source links for each work’s record and image credit.</p>
      </div>
    </StandaloneAppShell>
  );
}
