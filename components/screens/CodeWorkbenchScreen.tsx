"use client";

import { Download, FileCode2, FilePlus2, Play, Save, Terminal, WandSparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";
import { useProjectStore } from "@/components/store/ProjectStore";

export default function CodeWorkbenchScreen() {
  const { files, activeFile, setActiveFile, updateFile, exportZip } = useProjectStore();
  const current = files.find((f) => f.path === activeFile) || files[0];

  return <AppShell title="StoreOS · code">
    <main className="screen code-screen">
      <ScreenHeader title="StoreOS / code" back="/projects/storeos" />
      <div className="code-toolbar"><span>{current?.path}</span><div><button onClick={() => alert("Build execution will be connected to your sandbox in the next infrastructure layer.")}><Play size={16}/></button><button onClick={() => exportZip()}><Download size={16}/></button></div></div>
      <div className="code-layout">
        <aside className="file-tree">{files.map((f) => <button className={f.path===activeFile?"selected":""} key={f.path} onClick={() => setActiveFile(f.path)}><FileCode2 size={14}/>{f.path}</button>)}<button className="new-file"><FilePlus2 size={14}/> new file</button></aside>
        <section className="editor-wrap">
          <textarea spellCheck={false} value={current?.content || ""} onChange={(e) => current && updateFile(current.path, e.target.value)} />
          <div className="editor-status"><span><Save size={13}/> autosave in local workspace</span><span><Terminal size={13}/> TypeScript</span></div>
        </section>
      </div>
      <section className="agent-dock"><div><WandSparkles size={16}/><span>ELIAS agent</span><small>ask it to edit the current repository</small></div><button onClick={() => window.location.href="/agent/storeos"}>view agent</button></section>
    </main>
  </AppShell>;
}