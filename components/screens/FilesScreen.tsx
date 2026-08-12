"use client";

import JSZip from "jszip";
import { useRef, useState } from "react";
import { Archive, Download, FileCode2, FileText, Image, UploadCloud } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

export default function FilesScreen() {
  const [items,setItems] = useState([
    "storeos-v2.zip","architecture.md","dashboard.tsx","api-client.ts","research-report.pdf","study-plan.md"
  ]);
  const input=useRef<HTMLInputElement>(null);

  async function zipSelected() {
    const zip = new JSZip();
    items.forEach((x) => zip.file(x, `ELIAS artifact placeholder for ${x}\n`));
    const blob = await zip.generateAsync({type:"blob"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="elias-artifacts.zip"; a.click(); URL.revokeObjectURL(url);
  }

  return <AppShell title="Files">
    <main className="screen">
      <ScreenHeader title="Artifacts / files" />
      <div className="file-actions"><button className="secondary" onClick={()=>input.current?.click()}><UploadCloud size={16}/> upload</button><button className="primary" onClick={zipSelected}><Archive size={16}/> download ZIP</button></div>
      <input ref={input} hidden type="file" multiple onChange={(e)=>setItems((x)=>[...x,...Array.from(e.target.files||[]).map(f=>f.name)])}/>
      <div className="filter-row"><b>All</b><span>Code</span><span>Documents</span><span>Images</span><span>ZIPs</span></div>
      <div className="file-list">{items.map((x,i)=><div className="file-row" key={`${x}-${i}`}><span className="file-icon">{x.endsWith(".zip")?<Archive size={17}/>:x.match(/\.(png|jpg|jpeg|webp)$/i)?<Image size={17}/>:x.match(/\.(tsx|ts|jsx|js|css|html)$/i)?<FileCode2 size={17}/>:<FileText size={17}/>}</span><span><strong>{x}</strong><small>{i<2?"generated":"available"}</small></span><button aria-label={`download ${x}`}><Download size={16}/></button></div>)}</div>
      <div className="storage-bar"><div><span>workspace storage</span><b>2.4 GB / 10 GB</b></div><div><i style={{width:"24%"}}/></div></div>
    </main>
  </AppShell>;
}