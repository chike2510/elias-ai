"use client";

import Link from "next/link";
import { Download, ImageIcon, LoaderCircle, MessageCircle, RefreshCw, Trash2, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorCard } from "@/components/chat/ChatView";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { api } from "@/lib/chatClient";

type GalleryImage = { id: string; name: string; mime: string; size: number; text?: string; createdAt: string };
type Aspect = "square" | "portrait" | "landscape";

const ASPECTS: Array<{ value: Aspect; label: string }> = [{ value: "square", label: "Square" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }];
const IDEAS = ["A cosy reading nook with plants and warm afternoon light, watercolour", "Lagos skyline at sunset, cinematic, wide shot", "A minimalist logo of a fox made of geometric shapes"];

const src = (image: GalleryImage) => `/api/assistant/files/${encodeURIComponent(image.id)}/download?inline=1`;

/** /studio: describe an image, generate it, and keep it in your gallery (stored in the Library). Voice and camera live in chat. */
export default function StudioScreen() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<Aspect>("square");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GalleryImage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [latest, setLatest] = useState<GalleryImage | null>(null);
  const [viewing, setViewing] = useState<GalleryImage | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try { setImages((await api<{ images: GalleryImage[] }>("/api/assistant/studio")).images); }
    catch (err) { setLoadError((err as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!viewing) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setViewing(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  async function generate(text = prompt) {
    if (text.trim().length < 3 || busy) return;
    setBusy(true); setError(null);
    try {
      const data = await api<{ image: GalleryImage }>("/api/assistant/studio", { method: "POST", body: JSON.stringify({ prompt: text, aspect }) });
      setLatest(data.image);
      setImages((current) => [data.image, ...(current || []).filter((item) => item.id !== data.image.id)]);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(image: GalleryImage) {
    if (!window.confirm("Delete this image?")) return;
    try {
      await api(`/api/assistant/files/${encodeURIComponent(image.id)}`, { method: "DELETE" });
      setImages((current) => (current || []).filter((item) => item.id !== image.id));
      if (latest?.id === image.id) setLatest(null);
      setViewing(null);
    } catch (err) { setError((err as Error).message); }
  }

  const actions = (image: GalleryImage) => <div className="v4s-actions">
    <a className="el-btn el-btn-sm" href={`/api/assistant/files/${encodeURIComponent(image.id)}/download`}><Download size={15} /> Save</a>
    <Link className="el-btn el-btn-sm" href={`/chat?prompt=${encodeURIComponent(`I generated an image from this prompt: "${image.text || ""}". Suggest three ways to improve the prompt.`)}`}><MessageCircle size={15} /> Improve prompt</Link>
    <button type="button" className="el-icon-btn danger" aria-label="Delete image" onClick={() => void remove(image)}><Trash2 size={17} /></button>
  </div>;

  return <AppShell title="Studio">
    <main className="el-page v4s-page">
      <header className="el-page-head"><h1>Studio</h1><p>Describe an image and Elias makes it. Everything you make is kept in your gallery.</p></header>

      <form className="v4s-ask" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <label className="el-field"><span>Describe the image</span>
          <textarea rows={3} maxLength={1000} value={prompt} placeholder="e.g. A golden retriever in a raincoat, children's book illustration" onChange={(event) => setPrompt(event.target.value)} />
        </label>
        <div className="v4s-aspect" role="radiogroup" aria-label="Shape">{ASPECTS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={aspect === item.value} className={aspect === item.value ? "on" : ""} onClick={() => setAspect(item.value)}><span className={`v4s-shape ${item.value}`} aria-hidden="true" />{item.label}</button>)}</div>
        <button type="submit" className="el-btn el-btn-primary v4s-go" disabled={busy || prompt.trim().length < 3}>{busy ? <><LoaderCircle size={16} className="el-spin" /> Making it… (up to a minute)</> : <><WandSparkles size={16} /> Generate</>}</button>
        {!prompt ? <div className="v4s-ideas">{IDEAS.map((idea) => <button key={idea} type="button" className="v4s-idea" onClick={() => setPrompt(idea)}>{idea}</button>)}</div> : null}
      </form>

      {error ? <p className="el-error-text" role="alert">{error}</p> : null}

      {busy ? <div className={`v4s-placeholder ${aspect}`} aria-hidden="true"><LoaderCircle size={22} className="el-spin" /></div> : latest ? <figure className="v4s-latest">
        <img src={src(latest)} alt={latest.text || "Generated image"} />
        <figcaption>{latest.text}</figcaption>
        <div className="v4s-latest-bar">{actions(latest)}<button type="button" className="el-btn el-btn-sm el-btn-ghost" onClick={() => void generate(latest.text || prompt)}><RefreshCw size={15} /> Again</button></div>
      </figure> : null}

      <section className="el-section">
        <div className="el-section-head"><h2>Gallery</h2></div>
        {!images && loadError ? <ErrorCard text={loadError} onRetry={() => { setLoadError(null); void load(); }} /> : !images ? <ListSkeleton rows={2} /> : !images.length ? <p className="el-empty-line"><ImageIcon size={16} /> Nothing here yet. Your images will collect here.</p> : <ul className="v4s-grid">{images.map((image) => <li key={image.id}>
          <button type="button" className="v4s-thumb" onClick={() => setViewing(image)} aria-label={`Open: ${image.text || image.name}`}><img src={src(image)} alt="" loading="lazy" /></button>
        </li>)}</ul>}
      </section>

      {viewing ? <div className="v4s-viewer" role="dialog" aria-modal="true" aria-label="Image" onClick={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
        <div className="v4s-viewer-card">
          <button type="button" className="el-icon-btn v4s-close" aria-label="Close" onClick={() => setViewing(null)}><X size={18} /></button>
          <img src={src(viewing)} alt={viewing.text || "Generated image"} />
          {viewing.text ? <p>{viewing.text}</p> : null}
          <div className="v4s-latest-bar">{actions(viewing)}<button type="button" className="el-btn el-btn-sm el-btn-ghost" onClick={() => { setPrompt(viewing.text || ""); setViewing(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Use prompt</button></div>
        </div>
      </div> : null}
    </main>
  </AppShell>;
}
