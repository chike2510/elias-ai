"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Heart, Layers, Plus, RefreshCw, Shirt, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
import StandaloneAppShell from "./StandaloneAppShell";
import { buildOutfit, type OutfitContext, type OutfitSuggestion, type WardrobeItem } from "@/lib/standaloneExperiences.mjs";

const closetKey = "elias-idea-outfit-closet-v1";
const looksKey = "elias-idea-outfit-saved-v1";
const seedCloset: WardrobeItem[] = [
  { id: "w1", name: "Soft white tee", category: "top", color: "#f0eee6", warmth: 1, vibe: "Relaxed" },
  { id: "w2", name: "Blue stripe shirt", category: "top", color: "#7b98ad", warmth: 1, vibe: "Classic" },
  { id: "w3", name: "Olive knit", category: "top", color: "#9b9a72", warmth: 2, vibe: "Relaxed" },
  { id: "w4", name: "Black wide-leg trouser", category: "bottom", color: "#303036", warmth: 1, vibe: "Polished" },
  { id: "w5", name: "Straight blue denim", category: "bottom", color: "#58738b", warmth: 1, vibe: "Relaxed" },
  { id: "w6", name: "Sand linen skirt", category: "bottom", color: "#c7ad85", warmth: 1, vibe: "Classic" },
  { id: "w7", name: "Denim jacket", category: "layer", color: "#56738c", warmth: 2, vibe: "Relaxed" },
  { id: "w8", name: "Camel trench", category: "layer", color: "#aa8865", warmth: 3, vibe: "Polished" },
  { id: "w9", name: "Navy midi dress", category: "dress", color: "#424d66", warmth: 1, vibe: "Polished" },
  { id: "w10", name: "White sneakers", category: "shoe", color: "#e7e5de", warmth: 1, vibe: "Relaxed" },
  { id: "w11", name: "Leather loafers", category: "shoe", color: "#684a3a", warmth: 1, vibe: "Classic" },
  { id: "w12", name: "Canvas tote", category: "accessory", color: "#c9b996", warmth: 0, vibe: "Relaxed" },
];
const categories: Array<{ value: WardrobeItem["category"]; label: string }> = [
  { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }, { value: "dress", label: "Dress" },
  { value: "layer", label: "Layer" }, { value: "shoe", label: "Shoes" }, { value: "accessory", label: "Accessory" },
];
const iconFor = (category: WardrobeItem["category"]) => category === "shoe" || category === "accessory" ? ShoppingBag : category === "layer" ? Layers : Shirt;

type SavedLook = { id: string; name: string; items: WardrobeItem[]; note: string };

export default function OutfitPlanner() {
  const [closet, setCloset] = useState(seedCloset);
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);
  const [ready, setReady] = useState(false);
  const [context, setContext] = useState<OutfitContext>({ weather: "Mild", vibe: "Relaxed", occasion: "Everyday" });
  const [suggestion, setSuggestion] = useState<OutfitSuggestion | null>(null);
  const [variation, setVariation] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<WardrobeItem["category"]>("top");
  const [newColor, setNewColor] = useState("#d8c5af");
  const [newVibe, setNewVibe] = useState("Relaxed");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const closetSaved = localStorage.getItem(closetKey);
      const looksSaved = localStorage.getItem(looksKey);
      if (closetSaved) setCloset(JSON.parse(closetSaved) as WardrobeItem[]);
      if (looksSaved) setSavedLooks(JSON.parse(looksSaved) as SavedLook[]);
    } catch {
      setMessage("Your saved closet could not be read. The sample wardrobe is ready instead.");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(closetKey, JSON.stringify(closet));
    localStorage.setItem(looksKey, JSON.stringify(savedLooks));
  }, [closet, savedLooks, ready]);

  const counts = useMemo(() => categories.map(({ value, label }) => ({ label, count: closet.filter((item) => item.category === value).length })), [closet]);

  function suggestLook() {
    const next = buildOutfit(closet, context, variation);
    setSuggestion(next);
    setVariation((value) => value + 1);
    setMessage(next ? "A new combination is ready from your closet." : "Add a few wardrobe pieces to start planning.");
  }

  function saveLook() {
    if (!suggestion) return;
    const look: SavedLook = { id: `look-${Date.now()}`, name: `${context.vibe} ${context.occasion.toLowerCase()}`, items: suggestion.items, note: suggestion.note };
    setSavedLooks((current) => [look, ...current].slice(0, 8));
    setMessage("Look saved on this device.");
  }

  function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const item: WardrobeItem = { id: `item-${Date.now()}`, name, category: newCategory, color: newColor, warmth: newCategory === "layer" ? 2 : 1, vibe: newVibe };
    setCloset((current) => [item, ...current]);
    setNewName("");
    setShowAdd(false);
    setMessage(`${name} added to your local closet.`);
  }

  function removeItem(id: string) {
    setCloset((current) => current.filter((item) => item.id !== id));
    setMessage("Piece removed from this device's closet.");
  }

  return (
    <StandaloneAppShell active="/outfit">
      <div className="idea-page outfit-page">
        <div className="idea-page-heading">
          <div><p className="idea-eyebrow">01 / STYLE ROUTINE</p><h1>Get dressed, <em>with less guesswork.</em></h1><p>Start with the pieces you already own. Pick a mood, then make a fresh combination from your closet.</p></div>
          <div className="idea-heading-note"><Sparkles size={17} /><span>Suggestions run in this browser. No wardrobe photos leave your device.</span></div>
        </div>

        <div className="outfit-layout">
          <section className="idea-panel outfit-controls" aria-labelledby="outfit-controls-title">
            <div className="idea-section-title"><span className="idea-step">01</span><div><h2 id="outfit-controls-title">Set the scene</h2><p>A few simple cues are enough.</p></div></div>
            <label className="idea-label">Weather<select value={context.weather} onChange={(event) => setContext({ ...context, weather: event.target.value as OutfitContext["weather"] })}><option>Mild</option><option>Cool</option><option>Warm</option></select></label>
            <label className="idea-label">Today’s feel<select value={context.vibe} onChange={(event) => setContext({ ...context, vibe: event.target.value })}><option>Relaxed</option><option>Classic</option><option>Polished</option></select></label>
            <label className="idea-label">For<select value={context.occasion} onChange={(event) => setContext({ ...context, occasion: event.target.value })}><option>Everyday</option><option>Work</option><option>Weekend</option><option>Dinner</option></select></label>
            <button className="idea-button idea-button-primary idea-full-button" type="button" onClick={suggestLook}><Sparkles size={16} /> Mix an outfit</button>
            <p className="idea-muted-note">A transparent rule-based preview—not a generative styling model yet.</p>
          </section>

          <section className="idea-panel outfit-result" aria-live="polite" aria-labelledby="outfit-result-title">
            <div className="idea-section-title"><span className="idea-step">02</span><div><h2 id="outfit-result-title">Your combination</h2><p>{suggestion ? "A considered mix from your pieces." : "Choose a few cues and make a look."}</p></div></div>
            {suggestion ? <>
              <div className="outfit-board">{suggestion.items.map((item) => {
                const Icon = iconFor(item.category);
                return <div className="outfit-piece" key={item.id}><div className="outfit-piece-color" style={{ backgroundColor: item.color }}><Icon size={27} strokeWidth={1.35} /></div><span><small>{categories.find((category) => category.value === item.category)?.label}</small><strong>{item.name}</strong></span></div>;
              })}</div>
              <p className="outfit-note">{suggestion.note}</p>
              <div className="idea-button-row"><button className="idea-button idea-button-primary" onClick={saveLook} type="button"><Heart size={15} /> Save this look</button><button className="idea-button idea-button-quiet" onClick={suggestLook} type="button"><RefreshCw size={15} /> Try another</button></div>
            </> : <div className="outfit-empty"><div className="outfit-empty-orbit"><Shirt size={27} /></div><p>Your next favourite combination is already in your closet.</p><button type="button" className="idea-button idea-button-primary" onClick={suggestLook}>Build my first look</button></div>}
            {message && <p className="idea-status" role="status">{message}</p>}
          </section>
        </div>

        <section className="idea-panel closet-panel">
          <div className="idea-section-title closet-heading"><span className="idea-step">03</span><div><h2>Your sample closet</h2><p>Starter pieces are examples; add, remove, and adapt them to your own wardrobe.</p></div><button type="button" className="idea-button idea-button-secondary" onClick={() => setShowAdd((value) => !value)}><Plus size={15} /> Add a piece</button></div>
          <div className="closet-counts">{counts.map((count) => <span key={count.label}>{count.count} {count.label.toLowerCase()}{count.count === 1 ? "" : "s"}</span>)}</div>
          {showAdd && <form className="closet-add-form" onSubmit={addItem}>
            <label className="idea-label">Piece name<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. striped cotton shirt" maxLength={48} required /></label>
            <label className="idea-label">Type<select value={newCategory} onChange={(event) => setNewCategory(event.target.value as WardrobeItem["category"])}>{categories.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="idea-label">Colour<input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} /></label>
            <label className="idea-label">Feel<select value={newVibe} onChange={(event) => setNewVibe(event.target.value)}><option>Relaxed</option><option>Classic</option><option>Polished</option></select></label>
            <button className="idea-button idea-button-primary closet-add-submit" type="submit"><Check size={15} /> Add to closet</button>
          </form>}
          <div className="wardrobe-grid">{closet.map((item) => {
            const Icon = iconFor(item.category);
            return <article className="wardrobe-card" key={item.id}><div className="wardrobe-card-visual" style={{ background: `linear-gradient(140deg, ${item.color}, #fff9 150%)` }}><Icon size={26} strokeWidth={1.4} /><button type="button" className="wardrobe-remove" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}><Trash2 size={14} /></button></div><strong>{item.name}</strong><span>{categories.find((category) => category.value === item.category)?.label} · {item.vibe}</span></article>;
          })}</div>
          {savedLooks.length > 0 && <div className="saved-looks"><h3><Heart size={15} /> Saved looks</h3><div>{savedLooks.map((look) => <button type="button" key={look.id} onClick={() => { setSuggestion({ items: look.items, note: look.note }); setMessage(`Showing ${look.name}.`); }}><span>{look.name}</span><span>{look.items.length} pieces</span></button>)}</div></div>}
        </section>
      </div>
    </StandaloneAppShell>
  );
}
