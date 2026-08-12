import Link from "next/link";
import { Code2, FileText, Globe2, Plus, Search } from "lucide-react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

const projects = [
  {name:"StoreOS",type:"E-commerce platform",meta:"Next.js · Qwen · Supabase",icon:Code2,href:"/projects/storeos"},
  {name:"Edge X",type:"Analytics dashboard",meta:"Prediction · live updates",icon:Globe2,href:"/projects"},
  {name:"CSC 428 Study Guide",type:"Study materials",meta:"Documents · revision",icon:FileText,href:"/study"},
  {name:"Personal Portfolio",type:"Web project",meta:"Next.js · Tailwind",icon:Code2,href:"/projects"}
];

export default function ProjectsScreen() {
  return <AppShell title="Projects">
    <main className="screen">
      <ScreenHeader title="Projects" />
      <div className="searchbox"><Search size={17}/><input placeholder="Search projects..." /></div>
      <div className="filter-row"><b>All</b><span>Recent</span><span>Code</span><span>Research</span></div>
      <div className="project-list">
        {projects.map((p) => { const Icon=p.icon; return <Link href={p.href} key={p.name} className="project-row">
          <span className="project-icon"><Icon size={18}/></span>
          <span className="project-copy"><strong>{p.name}</strong><small>{p.type} · {p.meta}</small></span>
          <span className="live-dot"/>
        </Link> })}
      </div>
      <button className="primary wide"><Plus size={17}/> New project</button>
    </main>
  </AppShell>;
}