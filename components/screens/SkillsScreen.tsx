"use client";

import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Filter, Search, ShieldCheck, Sparkles, Users, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { SKILL_REGISTRY, type SkillDefinition, type SkillStatus } from "@/lib/skills";

function statusLabel(status: SkillStatus) { return status === "needs_approval" ? "Needs approval" : status[0].toUpperCase() + status.slice(1); }

export default function SkillsScreen() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "official" | "community">("all");
  const [skills, setSkills] = useState(SKILL_REGISTRY);
  const visible = useMemo(() => skills.filter((skill) => (filter === "all" || skill.category === filter) && `${skill.name} ${skill.description} ${skill.tools.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [filter, query, skills]);
  const enabledCount = skills.filter((skill) => skill.status === "enabled").length;
  const approvalCount = skills.filter((skill) => skill.status === "needs_approval").length;

  function toggle(skill: SkillDefinition) { setSkills((current) => current.map((item) => item.id === skill.id ? { ...item, status: item.status === "enabled" ? "disabled" : "enabled" } : item)); }

  return <AppShell title="Skills"><main className="screen skills-screen workspace-destination">
    <header className="screen-header skills-header">
      <div className="skills-header-copy screen-header-copy">
        <Link href="/profile" className="skills-back"><ArrowLeft size={16} /> Profile</Link>
        <span className="eyebrow">CAPABILITY LAYER</span>
        <h1>Skills</h1>
        <p className="screen-description">Equip Elias with focused capabilities, tools, and permissions.</p>
      </div>
      <Link className="skills-evaluation-link" href="/improvements"><Filter size={16} /><span>Evaluations</span><ChevronRight size={15} /></Link>
    </header>

    <section className="skills-summary quiet-card" aria-label="Skill summary">
      <div><strong>{skills.length}</strong><span>available</span></div>
      <div><strong>{enabledCount}</strong><span>enabled</span></div>
      <div><strong>{approvalCount}</strong><span>needs review</span></div>
    </section>

    <div className="skills-toolbar workspace-toolbar-row">
      <label className="searchbox skills-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills, tools, or capability" /></label>
      <div className="skill-filter-row" role="tablist" aria-label="Filter skills">{([['all', 'All'], ['official', 'Official'], ['community', 'Community']] as const).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>
    </div>

    <div className="skills-results-head"><span>{visible.length} {visible.length === 1 ? "skill" : "skills"}</span><small>Choose a capability to inspect its tools and permissions.</small></div>
    <section className="skill-list" aria-label="Available skills">{visible.map((skill) => <article className={`skill-card quiet-card ${skill.status}`} key={skill.id}>
      <div className="skill-card-head"><div className="skill-title-wrap"><span className="skill-icon"><Sparkles size={17} /></span><div><h2>{skill.name}</h2><span className={`skill-badge ${skill.category}`}>{skill.category === "official" ? "Official" : "Community"}</span></div></div><button type="button" className={`skill-toggle ${skill.status === "enabled" ? "on" : ""}`} aria-label={`${skill.status === "enabled" ? "Disable" : "Enable"} ${skill.name}`} onClick={() => toggle(skill)}><span /></button></div>
      <p className="skill-description">{skill.description}</p>
      <div className="skill-meta"><span><ShieldCheck size={12} /> {statusLabel(skill.status)}</span><span><Users size={12} /> {skill.contributors.length} contributor{skill.contributors.length === 1 ? "" : "s"}</span><span><Wrench size={12} /> {skill.tools.length} tools</span></div>
      <div className="skill-footer"><small>{skill.version} · Updated {skill.updatedAt}</small><span>{skill.permissions.length} permissions</span><ChevronRight size={15} /></div>
      {skill.status === "needs_approval" ? <button type="button" className="secondary skill-approval" onClick={() => toggle(skill)}><Check size={13} /> Approve and enable</button> : null}
    </article>)}</section>
    {!visible.length ? <div className="empty-state panel"><Sparkles size={20} /><b>No skills found</b><small>Try another search or filter.</small></div> : null}
  </main></AppShell>;
}
