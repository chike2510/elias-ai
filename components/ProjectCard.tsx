import Link from "next/link";
import { Code2, FileText, Globe2 } from "lucide-react";

const icons = { code: Code2, research: Globe2, study: FileText };
export default function ProjectCard({name, type, time, href="/projects/storeos"}: {name:string; type:string; time:string; href?:string}) {
  const Icon = icons[type as keyof typeof icons] || Code2;
  return <Link href={href} className="project-row">
    <span className="project-icon"><Icon size={18}/></span>
    <span className="project-copy"><strong>{name}</strong><small>{type}</small></span>
    <span className="project-time">{time}</span>
  </Link>
}