"use client";

import { Camera, Link2, Mic, Plus, Send, Upload } from "lucide-react";
import { useRef, useState } from "react";

export default function Composer({ onSubmit, initial = "", placeholder = "Ask Elias anything, or describe an outcome…" }: {
  onSubmit: (value: string) => void; initial?: string; placeholder?: string;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return <div className="composer">
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      rows={2}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const v = value.trim();
          if (v) { onSubmit(v); setValue(""); }
        }
      }}
    />
    <input ref={inputRef} type="file" multiple hidden onChange={() => {}} />
    <div className="composer-actions">
      <button className="round-action" aria-label="Add an attachment" onClick={() => inputRef.current?.click()}><Plus size={21}/></button>
      <div className="media-actions">
        <button onClick={() => inputRef.current?.click()}><Upload size={16}/> <span>Upload</span></button>
        <button onClick={() => alert("Camera opens from the Studio screen.")}><Camera size={16}/> <span>Camera</span></button>
        <button onClick={() => window.location.href="/studio"}><Mic size={16}/> <span>Voice</span></button>
        <button onClick={() => setValue((v) => `${v} `)}><Link2 size={16}/> <span>URL</span></button>
      </div>
      <button className="send-btn" aria-label="Send objective" onClick={() => { const v = value.trim(); if (v) { onSubmit(v); setValue(""); } }}><Send size={18}/></button>
    </div>
  </div>
}