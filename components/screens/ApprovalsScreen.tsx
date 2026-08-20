"use client";

import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Clock3, ExternalLink, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { readApiResponse } from "@/lib/clientApi";
import type { TaskRecord } from "@/lib/task";

export default function ApprovalsScreen() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  async function load() { try { const response = await readApiResponse<{ tasks?: TaskRecord[] }>(await fetch("/api/tasks", { cache: "no-store" })); setTasks(response.tasks || []); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load approvals."); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);
  const approvals = useMemo(() => tasks.flatMap((task) => task.approvals.filter((approval) => approval.status === "pending").map((approval) => ({ task, approval }))), [tasks]);
  async function decide(taskId: string, action: "approve" | "reject", approvalId: string) { setBusy(true); try { await readApiResponse(await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, value: approvalId }) })); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Approval action failed."); setBusy(false); } }
  return <AppShell title="Approvals"><main className="screen approvals-screen"><div className="mobile-screen-heading"><Link href="/profile" aria-label="Back to profile"><ArrowLeft size={19} /></Link><h1>approval inbox</h1><span className="improvement-mark"><ShieldCheck size={16} /></span></div><section className="approval-hero"><div><p className="eyebrow">ELIAS / human control</p><h2>Review before Elias acts.</h2><p>Every permission-sensitive task step and external side effect should be visible here before it continues.</p></div><LockKeyhole size={35} /></section><div className="approval-metrics"><div><b>{approvals.length}</b><span>pending approvals</span></div><div><b>{tasks.length}</b><span>active task records</span></div><div><b>100%</b><span>confirmation required</span></div></div>{error ? <p className="inline-error"><CircleAlert size={14} />{error}</p> : null}<section className="approval-list">{busy && !approvals.length ? <div className="panel approval-empty"><Clock3 size={22} /><strong>Loading approval state…</strong></div> : approvals.length ? approvals.map(({ task, approval }) => <article className="panel approval-inbox-row" key={`${task.id}-${approval.id}`}><div className="approval-inbox-main"><span className="approval-risk"><LockKeyhole size={12} /> {approval.permission}</span><strong>{approval.question}</strong><p>{task.title}</p><small>{task.kind} task · {new Date(approval.createdAt).toLocaleString()}</small></div><div className="approval-actions"><button className="secondary" disabled={busy} onClick={() => void decide(task.id, "reject", approval.id)}><X size={14} /> reject</button><button className="primary" disabled={busy} onClick={() => void decide(task.id, "approve", approval.id)}><Check size={14} /> approve</button><Link className="icon-btn" href="/chat" aria-label="Open task"><ExternalLink size={14} /></Link></div></article>) : <div className="panel approval-empty"><ShieldCheck size={28} /><strong>No pending approvals</strong><small>Elias is not waiting for a permission-sensitive decision. When an action needs you, it will appear here.</small></div>}</section></main></AppShell>;
}
