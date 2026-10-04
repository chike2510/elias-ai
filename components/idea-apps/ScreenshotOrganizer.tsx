"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, FileImage, FolderOpen, LockKeyhole, Plus, Search, Tag, Trash2, Upload, X } from "lucide-react";
import StandaloneAppShell from "./StandaloneAppShell";
import { filterScreenshots } from "@/lib/standaloneExperiences.mjs";
import { getScreenshots, putScreenshot, removeScreenshot, type ScreenshotRecord } from "@/lib/screenshotDb";

const categories = ["Unsorted", "Receipt", "Places", "Products", "How-to"];
const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `shot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function ScreenshotOrganizer() {
  const [records, setRecords] = useState<ScreenshotRecord[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { setRecords(await getScreenshots()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Local screenshot storage is unavailable."); }
  }

  useEffect(() => { void refresh().finally(() => setReady(true)); }, []);
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const record of records) urls[record.id] = URL.createObjectURL(record.image);
    setImageUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [records]);

  const visible = useMemo(() => filterScreenshots(records, query, activeCategory), [records, query, activeCategory]);
  const countByCategory = (category: string) => records.filter((record) => record.category === category).length;

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    let skipped = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) { skipped += 1; continue; }
        const record: ScreenshotRecord = { id: makeId(), name: file.name, category: "Unsorted", note: "", tags: [], image: file, createdAt: new Date().toISOString() };
        await putScreenshot(record);
        added += 1;
      }
      await refresh();
      setMessage(`${added} screenshot${added === 1 ? "" : "s"} stored locally${skipped ? `; ${skipped} file${skipped === 1 ? " was" : "s were"} skipped (image files up to 15 MB only)` : "."}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the selected screenshots."); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  function updateDraft(id: string, changes: Partial<Pick<ScreenshotRecord, "category" | "note" | "tags">>) {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...changes } : record));
  }

  async function saveRecord(record: ScreenshotRecord) {
    try { await putScreenshot(record); setMessage(`Saved notes for ${record.name} on this device.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save changes locally."); }
  }

  async function deleteRecord(record: ScreenshotRecord) {
    if (!window.confirm(`Remove “${record.name}” from this browser?`)) return;
    try { await removeScreenshot(record.id); await refresh(); setMessage("Screenshot removed from this device."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove the screenshot."); }
  }

  return (
    <StandaloneAppShell active="/screenshots">
      <div className="idea-page screenshots-page">
        <div className="idea-page-heading screenshots-heading"><div><p className="idea-eyebrow">04 / FIND THAT THING AGAIN</p><h1>Your camera roll, <em>with a filing cabinet.</em></h1><p>Keep the useful screenshots close. Add a few words and a shelf, then search by what you remember.</p></div><button type="button" className="idea-button idea-button-primary screenshot-upload-top" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16} /> {busy ? "Adding…" : "Add screenshots"}</button></div>
        <input className="screenshot-file-input" ref={fileInput} type="file" accept="image/*" multiple onChange={(event) => void importFiles(event.currentTarget.files)} />
        <div className="screenshot-privacy"><LockKeyhole size={17} /><div><strong>Private by default</strong><span>Only the images you choose are stored in this browser’s local database. No upload, account connection, or automatic photo-library scan.</span></div></div>
        <section className="idea-panel screenshot-library">
          <div className="screenshot-library-head"><div><p className="idea-eyebrow">YOUR LOCAL LIBRARY</p><h2>{ready ? `${records.length} saved screenshot${records.length === 1 ? "" : "s"}` : "Opening local library…"}</h2></div><label className="screenshot-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, notes, tags…" aria-label="Search local screenshots" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}</label></div>
          <div className="screenshot-filter-row"><div className="screenshot-filters" aria-label="Filter by category"><button type="button" className={activeCategory === "All" ? "is-active" : ""} onClick={() => setActiveCategory("All")}>All <span>{records.length}</span></button>{categories.map((category) => <button type="button" key={category} className={activeCategory === category ? "is-active" : ""} onClick={() => setActiveCategory(category)}>{category} <span>{countByCategory(category)}</span></button>)}</div><span className="screenshot-local-badge"><FolderOpen size={14} /> Saved on this device</span></div>
          {visible.length ? <div className="screenshot-grid">{visible.map((record) => <article className="screenshot-card" key={record.id}><div className="screenshot-thumb">{imageUrls[record.id] ? <img src={imageUrls[record.id]} alt={`Screenshot ${record.name}`} loading="lazy" /> : <div className="screenshot-thumb-placeholder"><FileImage size={25} /></div>}<span>{record.category}</span></div><div className="screenshot-card-body"><div className="screenshot-card-title"><strong title={record.name}>{record.name}</strong><button className="screenshot-delete" type="button" aria-label={`Delete ${record.name}`} onClick={() => void deleteRecord(record)}><Trash2 size={14} /></button></div><label className="idea-label">Shelf<select value={record.category} onChange={(event) => updateDraft(record.id, { category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="idea-label">A note to future you<input value={record.note} onChange={(event) => updateDraft(record.id, { note: event.target.value })} placeholder="What should you remember?" maxLength={120} /></label><label className="idea-label screenshot-tag-input"><span><Tag size={12} /> Tags</span><input value={record.tags.join(", ")} onChange={(event) => updateDraft(record.id, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12) })} placeholder="receipt, café, size…" maxLength={100} /></label><div className="screenshot-card-foot"><small>Added {new Date(record.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small><button type="button" className="screenshot-save" onClick={() => void saveRecord(record)}><Check size={13} /> Save details</button></div></div></article>)}</div> : <div className="screenshot-empty"><div className="screenshot-empty-icon"><Camera size={24} /></div><h3>{records.length ? "Nothing on this shelf yet" : "Start with one screenshot"}</h3><p>{records.length ? "Try another category or search term." : "Choose a few images you want to find again. They stay in this browser, with notes and tags you control."}</p><button type="button" className="idea-button idea-button-primary" onClick={() => fileInput.current?.click()}><Plus size={15} /> Choose local images</button></div>}
        </section>
        {message && <p className="idea-status" role="status">{message}</p>}
      </div>
    </StandaloneAppShell>
  );
}
