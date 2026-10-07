"use client";

import { Brain, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { ErrorCard } from "@/components/chat/ChatView";
import { api } from "@/lib/chatClient";

type Memory = { id: string; kind: string; content: string; source: string; updatedAt: string };

/** What Elias remembers (server memory, shared with the chat). Edit or forget anything. */
export default function MemoryScreen() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState("");
  const load = useCallback(() => { setError(null); void api<{ memories: Memory[] }>("/api/assistant/memories").then((data) => setMemories(data.memories)).catch((err) => setError(err.message)); }, []);
  useEffect(() => { load(); }, [load]);

  async function save(id: string) {
    await api(`/api/assistant/memories/${id}`, { method: "PATCH", body: JSON.stringify({ content: draft }) }).catch((err) => setError(err.message));
    setMemories((current) => current?.map((item) => item.id === id ? { ...item, content: draft } : item) || null);
    setEditing(null);
  }
  async function forget(id: string) {
    setMemories((current) => current?.filter((item) => item.id !== id) || null);
    await api(`/api/assistant/memories/${id}`, { method: "DELETE" }).catch((err) => setError(err.message));
  }
  async function add() {
    if (!adding.trim()) return;
    const data = await api<{ memory: Memory }>("/api/assistant/memories", { method: "POST", body: JSON.stringify({ content: adding, kind: "fact" }) }).catch((err) => { setError(err.message); return null; });
    if (data) { setMemories((current) => [data.memory, ...(current || []).filter((item) => item.id !== data.memory.id)]); setAdding(""); }
  }

  return <AppShell title="Memory">
    <main className="el-page">
      <header className="el-page-head"><h1>Memory</h1><p>What Elias knows about you. It learns from your chats; fix or forget anything.</p></header>
      <form className="el-add-row" onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <input value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="Add something, e.g. “I'm vegetarian”" aria-label="New memory" />
        <button type="submit" className="el-btn el-btn-primary" disabled={!adding.trim()}><Plus size={16} /> Add</button>
      </form>
      {error ? <ErrorCard text={error} onRetry={load} /> : null}
      {!memories && !error ? <ListSkeleton rows={6} /> : null}
      {memories && !memories.length ? <p className="el-empty-line"><Brain size={16} /> Nothing saved yet. Tell Elias about yourself in chat.</p> : null}
      {memories?.length ? <ul className="el-list">{memories.map((item) => <li key={item.id} className="el-list-item">
        {editing === item.id ? <div className="el-editor">
          <textarea className="el-textarea" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Edit memory" />
          <div className="el-editor-actions"><button type="button" className="el-btn" onClick={() => setEditing(null)}><X size={16} /> Cancel</button><button type="button" className="el-btn el-btn-primary" onClick={() => void save(item.id)} disabled={!draft.trim()}><Check size={16} /> Save</button></div>
        </div> : <div className="el-list-row static">
          <span className="el-tag">{item.kind}</span>
          <span className="el-list-text"><strong className="el-wrap">{item.content}</strong><small>{item.source === "auto" ? "Learned from chat" : item.source === "import" ? "Imported" : "Saved"} · {new Date(item.updatedAt).toLocaleDateString()}</small></span>
          <span className="el-list-actions">
            <button type="button" className="el-icon-btn" aria-label="Edit memory" onClick={() => { setEditing(item.id); setDraft(item.content); }}><Pencil size={16} /></button>
            <button type="button" className="el-icon-btn danger" aria-label="Forget memory" onClick={() => void forget(item.id)}><Trash2 size={16} /></button>
          </span>
        </div>}
      </li>)}</ul> : null}
    </main>
  </AppShell>;
}
