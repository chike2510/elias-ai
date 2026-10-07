"use client";

import "@/components/brain.css";
import { Brain, Check, CheckCircle2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { ErrorCard } from "@/components/chat/ChatView";
import { api } from "@/lib/chatClient";

type Memory = { id: string; kind: string; content: string; entity?: string | null; source: string; updatedAt: string; confirmedAt?: string | null };

/** Category order and labels for grouping (matches the server's memory kinds). */
const GROUPS: Array<{ kind: string; label: string }> = [
  { kind: "person", label: "People" }, { kind: "place", label: "Places" }, { kind: "project", label: "Projects" },
  { kind: "preference", label: "Preferences" }, { kind: "profile", label: "About you" }, { kind: "fact", label: "Facts" },
];
const label = (kind: string) => GROUPS.find((group) => group.kind === kind)?.label || "Facts";

/** What Elias remembers (server memory, shared with the chat), grouped by category. Edit, re-file or forget anything. */
export default function MemoryScreen() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ content: "", kind: "fact", entity: "" });
  const [adding, setAdding] = useState("");
  const [addKind, setAddKind] = useState("fact");
  const [filter, setFilter] = useState<string>("all");
  const load = useCallback(() => { setError(null); void api<{ memories: Memory[] }>("/api/assistant/memories").then((data) => setMemories(data.memories)).catch((err) => setError(err.message)); }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => GROUPS.map((group) => ({ ...group, items: (memories || []).filter((item) => (GROUPS.some((g) => g.kind === item.kind) ? item.kind : "fact") === group.kind) })).filter((group) => group.items.length), [memories]);
  const visible = filter === "all" ? groups : groups.filter((group) => group.kind === filter);

  async function save(id: string) {
    const body = { content: draft.content, kind: draft.kind, entity: draft.entity.trim() || null };
    const data = await api<{ memory: Memory | null }>(`/api/assistant/memories/${id}`, { method: "PATCH", body: JSON.stringify(body) }).catch((err) => { setError(err.message); return null; });
    if (data?.memory) setMemories((current) => current?.map((item) => item.id === id ? data.memory! : item) || null);
    setEditing(null);
  }
  async function forget(id: string) {
    setMemories((current) => current?.filter((item) => item.id !== id) || null);
    await api(`/api/assistant/memories/${id}`, { method: "DELETE" }).catch((err) => setError(err.message));
  }
  async function add() {
    if (!adding.trim()) return;
    const data = await api<{ memory: Memory }>("/api/assistant/memories", { method: "POST", body: JSON.stringify({ content: adding, kind: addKind }) }).catch((err) => { setError(err.message); return null; });
    if (data) { setMemories((current) => [data.memory, ...(current || []).filter((item) => item.id !== data.memory.id)]); setAdding(""); }
  }

  return <AppShell title="Memory">
    <main className="el-page">
      <header className="el-page-head"><h1>Memory</h1><p>What Elias knows about you, by category. It learns from your chats and checks in every Sunday; fix or forget anything.</p></header>
      <form className="el-add-row" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <input value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="Add something, e.g. “I'm vegetarian”" aria-label="New memory" />
        <select className="el-mem-kind" value={addKind} onChange={(event) => setAddKind(event.target.value)} aria-label="Category">{GROUPS.map((group) => <option key={group.kind} value={group.kind}>{group.label}</option>)}</select>
        <button type="submit" className="el-btn el-btn-primary" disabled={!adding.trim()} aria-label="Add memory"><Plus size={16} /></button>
      </form>
      {groups.length > 1 ? <div className="el-mem-filters" role="tablist" aria-label="Filter by category">
        <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All {memories?.length || 0}</button>
        {groups.map((group) => <button type="button" role="tab" key={group.kind} aria-selected={filter === group.kind} className={filter === group.kind ? "active" : ""} onClick={() => setFilter(group.kind)}>{group.label} {group.items.length}</button>)}
      </div> : null}
      {error ? <ErrorCard text={error} onRetry={load} /> : null}
      {!memories && !error ? <ListSkeleton rows={6} /> : null}
      {memories && !memories.length ? <p className="el-empty-line"><Brain size={16} /> Nothing saved yet. Tell Elias about yourself in chat.</p> : null}
      {visible.map((group) => <section key={group.kind} className="el-mem-group" aria-label={group.label}>
        <h2>{group.label} <small>{group.items.length}</small></h2>
        <ul className="el-list">{group.items.map((item) => <li key={item.id} className="el-list-item">
          {editing === item.id ? <div className="el-editor">
            <textarea className="el-textarea" rows={3} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} aria-label="Edit memory" />
            <div className="el-editor-fields">
              <select className="el-mem-kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })} aria-label="Category">{GROUPS.map((g) => <option key={g.kind} value={g.kind}>{g.label}</option>)}</select>
              <input className="el-mem-entity-input" value={draft.entity} onChange={(event) => setDraft({ ...draft, entity: event.target.value })} placeholder="About (e.g. Bola)" aria-label="Who or what it's about" />
            </div>
            <div className="el-editor-actions"><button type="button" className="el-btn" onClick={() => setEditing(null)}><X size={16} /> Cancel</button><button type="button" className="el-btn el-btn-primary" onClick={() => void save(item.id)} disabled={!draft.content.trim()}><Check size={16} /> Save</button></div>
          </div> : <div className="el-list-row static">
            <span className="el-list-text">
              {item.entity ? <span className="el-mem-entity">{item.entity}</span> : null}
              <strong className="el-wrap">{item.content}</strong>
              <small>{item.confirmedAt ? <span className="el-mem-confirmed"><CheckCircle2 size={12} /> Confirmed · </span> : null}{item.source === "auto" ? "Learned from chat" : item.source === "import" ? "Imported" : "Saved"} · {new Date(item.updatedAt).toLocaleDateString()}</small>
            </span>
            <span className="el-list-actions">
              <button type="button" className="el-icon-btn" aria-label="Edit memory" onClick={() => { setEditing(item.id); setDraft({ content: item.content, kind: item.kind, entity: item.entity || "" }); }}><Pencil size={16} /></button>
              <button type="button" className="el-icon-btn danger" aria-label={`Forget: ${label(item.kind)}`} onClick={() => void forget(item.id)}><Trash2 size={16} /></button>
            </span>
          </div>}
        </li>)}</ul>
      </section>)}
    </main>
  </AppShell>;
}
