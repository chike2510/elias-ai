"use client";

import Link from "next/link";
import { Camera, ChevronRight, FileText, FolderPlus, Globe2, Link2, Mic, Paperclip, Plus, Send, X } from "lucide-react";
import { useRef, useState } from "react";

export default function Composer({ onSubmit, initial = "", placeholder = "How can I help you today?" }: { onSubmit: (value: string) => void; initial?: string; placeholder?: string }) {
  const [value, setValue] = useState(initial);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  function submit() { const next = value.trim(); if (next) { onSubmit(next); setValue(""); } }
  function seed(next: string) { setValue((current) => `${current}${current ? " " : ""}${next}`); setMenuOpen(false); }
  return <div className="composer clean-composer">
    <textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} />
    <input ref={inputRef} type="file" multiple hidden onChange={() => setMenuOpen(false)} />
    <div className="composer-actions clean-composer-actions">
      <div className="composer-plus-wrap"><button className="round-action clean-plus" type="button" aria-label="Add to chat" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19} /> : <Plus size={20} />}</button>{menuOpen ? <div className="composer-popover-backdrop" role="presentation" onMouseDown={() => setMenuOpen(false)}><section className="composer-popover" role="dialog" aria-label="Add to chat" onMouseDown={(event) => event.stopPropagation()}><div className="composer-popover-head"><strong>Add to chat</strong><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close add menu"><X size={15} /></button></div><button className="composer-menu-row" type="button" onClick={() => inputRef.current?.click()}><Paperclip size={17} /><span>Add files or photos</span></button><Link className="composer-menu-row" href="/projects" onClick={() => setMenuOpen(false)}><FolderPlus size={17} /><span>Add to project</span><ChevronRight size={14} /></Link><Link className="composer-menu-row" href="/skills" onClick={() => setMenuOpen(false)}><FileText size={17} /><span>Skills</span><ChevronRight size={14} /></Link><Link className="composer-menu-row" href="/connectors" onClick={() => setMenuOpen(false)}><Link2 size={17} /><span>Add connector</span><ChevronRight size={14} /></Link><button className="composer-menu-row" type="button" onClick={() => seed("Search the web for")}><Globe2 size={17} /><span>Web search</span><span className="composer-check">✓</span></button><div className="composer-menu-rule" /><div className="composer-menu-label">Model</div><button className="composer-menu-row composer-model-row" type="button" onClick={() => setMenuOpen(false)}><span className="composer-model-mark">A</span><span><strong>Auto</strong><small>Best model for the task</small></span><ChevronRight size={14} /></button><Link className="composer-menu-row" href="/studio?mode=voice" onClick={() => setMenuOpen(false)}><Mic size={17} /><span>Voice</span><ChevronRight size={14} /></Link><Link className="composer-menu-row" href="/studio?mode=camera" onClick={() => setMenuOpen(false)}><Camera size={17} /><span>Camera</span><ChevronRight size={14} /></Link></section></div> : null}</div>
      <button className="composer-mode" type="button" onClick={() => setMenuOpen(true)}>Chat <ChevronRight size={12} /></button><button className="composer-model" type="button" onClick={() => setMenuOpen(true)}>Auto</button><Link href="/studio?mode=voice" className="composer-voice" aria-label="Voice"><Mic size={18} /></Link><button className="send-btn clean-send" type="button" aria-label="Send message" disabled={!value.trim()} onClick={submit}><Send size={18} /></button>
    </div>
  </div>;
}
