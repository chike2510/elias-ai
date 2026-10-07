"use client";

import { Brain, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api, type MemoryChip } from "@/lib/chatClient";

/** Bottom sheet to edit or forget one memory saved during a turn. */
export default function MemorySheet({ memory, onClose, onChanged }: { memory: MemoryChip; onClose: () => void; onChanged: (memory: MemoryChip | null) => void }) {
  const [text, setText] = useState(memory.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try { await api(`/api/assistant/memories/${memory.id}`, { method: "PATCH", body: JSON.stringify({ content: text }) }); onChanged({ ...memory, content: text }); onClose(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function forget() {
    setBusy(true); setError(null);
    try { await api(`/api/assistant/memories/${memory.id}`, { method: "DELETE" }); onChanged(null); onClose(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return <div className="el-overlay el-overlay-sheet" onClick={onClose}>
    <section className="el-sheet" role="dialog" aria-modal="true" aria-label="Memory" onClick={(event) => event.stopPropagation()}>
      <span className="el-sheet-grip" aria-hidden="true" />
      <header className="el-sheet-head"><Brain size={18} /><strong>Saved to memory</strong><button type="button" className="el-icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <p className="el-muted">Elias uses this quietly in future chats. Fix it or forget it.</p>
      <textarea className="el-textarea" rows={3} value={text} onChange={(event) => setText(event.target.value)} aria-label="Memory text" />
      {error ? <p className="el-error-text" role="alert">{error}</p> : null}
      <div className="el-sheet-actions">
        <button type="button" className="el-btn el-btn-lg el-btn-danger" disabled={busy} onClick={() => void forget()}><Trash2 size={17} /> Forget</button>
        <button type="button" className="el-btn el-btn-lg el-btn-primary" disabled={busy || !text.trim() || text === memory.content} onClick={() => void save()}>Save</button>
      </div>
    </section>
  </div>;
}
