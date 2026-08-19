"use client";

import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Filter, Search, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { SKILL_REGISTRY, type SkillDefinition, type SkillStatus } from "@/lib/skills";

function statusLabel(status: SkillStatus) { return status === "needs_approval" ? "Needs approval" : status[0].toUpperCase() + status.slice(1); }

export default function SkillsScreen() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "official" | "community">("all");
  const [skills, setSkills] = useState(SKILL_REGISTRY);
  const visible = useMemo(() => skills.filter((skill) => (filter === "all" || skill.category === filter) && `${skill.name} ${skill.description} ${skill.tools.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [filter, query, skills]);
  function toggle(skill: SkillDefinition) { setSkills((current) => current.map((item) => item.id === skill.id ? { ...item, status: item.status === "enabled" ? "disabled" : "enabled" } : item)); }
  return <AppShell title="Skills"><main className="screen skills-screen"><div className="mobile-screen-heading"><Link href="/profile" aria-label="Back to profile"><ArrowLeft size={19} /></Link><h1>Skills</h1><Link className="icon-btn" href="/improvements" aria-label="Skill evaluations"><Filter size={19} /></Link></div><div className="searchbox skills-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" /></div><div className="skill-filter-row">{([["all", "All"], ["official", "Official"], ["community", "Community"]] as const).map(([value, label]) => <button type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div><section className="skill-list">{visible.map((skill) => <article className="skill-card" key={skill.id}><div className="skill-card-head"><div><h2>{skill.name}</h2><span className={`skill-badge ${skill.category}`}>{skill.category === "official" ? "Official" : "Community"}</span></div><button type="button" className={`skill-toggle ${skill.status === "enabled" ? "on" : ""}`} aria-label={`${skill.status === "enabled" ? "Disable" : "Enable"} ${skill.name}`} onClick={() => toggle(skill)}><span /></button></div><p>{skill.description}</p><div className="skill-meta"><span><ShieldCheck size={12} /> {statusLabel(skill.status)}</span><span><Users size={12} /> {skill.contributors.length} contributor{skill.contributors.length === 1 ? "" : "s"}</span><span>{Math.round(skill.evaluation.passRate * 100)}% eval</span></div><div className="skill-footer"><small>{skill.version} · Updated {skill.updatedAt}</small><span>{skill.permissions.length} permissions · {skill.tools.length} tools</span><ChevronRight size={15} /></div>{skill.status === "needs_approval" ? <button type="button" className="secondary skill-approval" onClick={() => toggle(skill)}><Check size={13} /> Approve and enable</button> : null}</article>)}</section>{!visible.length ? <div className="empty-projects panel"><b>No skills found</b><small>Try another search.</small></div> : null}</main></AppShell>;
}
