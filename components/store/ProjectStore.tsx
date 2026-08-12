"use client";

import JSZip from "jszip";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ProjectFile } from "@/lib/types";

const starter: ProjectFile[] = [
  { path:"app/page.tsx", language:"tsx", content:`export default function Home() {
  return (
    <main>
      <h1>StoreOS</h1>
      <p>The AI that runs your store.</p>
    </main>
  );
}`},
  { path:"components/Navbar.tsx", language:"tsx", content:`export function Navbar() {
  return <nav>StoreOS</nav>;
}`},
  { path:"lib/api.ts", language:"ts", content:`export async function getProducts() {
  const response = await fetch("/api/products");
  return response.json();
}`},
  { path:"styles/globals.css", language:"css", content:`:root { color-scheme: dark; }
body { margin: 0; font-family: Inter, sans-serif; }`},
  { path:"package.json", language:"json", content:`{
  "name": "storeos",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build" }
}`}
];

type Store = {
  files: ProjectFile[];
  activeFile: string;
  setActiveFile: (path:string)=>void;
  updateFile: (path:string, content:string)=>void;
  addFile: (path:string)=>void;
  exportZip: ()=>Promise<void>;
};

const Ctx=createContext<Store|null>(null);

export function ProjectStoreProvider({children}:{children:React.ReactNode}) {
  const [files,setFiles]=useState<ProjectFile[]>(starter);
  const [activeFile,setActiveFile]=useState(starter[0].path);

  useEffect(()=>{
    try {
      const saved=localStorage.getItem("elias-storeos-files");
      if(saved) setFiles(JSON.parse(saved));
    } catch {}
  },[]);

  useEffect(()=>{ localStorage.setItem("elias-storeos-files",JSON.stringify(files)); },[files]);

  const value=useMemo<Store>(()=>({
    files, activeFile,
    setActiveFile,
    updateFile:(path,content)=>setFiles(v=>v.map(f=>f.path===path?{...f,content}:f)),
    addFile:(path)=>setFiles(v=>v.some(f=>f.path===path)?v:[...v,{path,content:"",language:path.split(".").pop()}]),
    exportZip:async()=>{
      const zip=new JSZip();
      files.forEach(f=>zip.file(f.path,f.content));
      const blob=await zip.generateAsync({type:"blob"});
      const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="storeos-elias.zip";a.click();URL.revokeObjectURL(url);
    }
  }),[files,activeFile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectStore() {
  const ctx=useContext(Ctx);
  if(!ctx) throw new Error("ProjectStoreProvider missing");
  return ctx;
}