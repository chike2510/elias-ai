"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Clock3, MapPin, Pause, Pencil, Play, Plus, ShieldCheck, SquareKanban, Sun, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import TaskWorkspace from "@/components/screens/TaskWorkspace";
import JobsSection from "@/components/screens/JobsSection";
import NewTaskSheet from "@/components/screens/NewTaskSheet";
import { ErrorCard } from "@/components/chat/ChatView";
import { api, userTimezone, type Approval } from "@/lib/chatClient";

type Schedule = { id: string; name: string; prompt: string; when: string; status: string; kind: string; nextRunAt: string | null; lastRunAt: string | null; lastResult: string | null; timezone: string; spec: { type: string; time?: string }; conversationId: string | null };

function nextLabel(iso: string | null) {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/** /tasks: scheduled tasks (incl. the daily brief), approvals waiting, and the task workbench. */
export default function TasksScreen() {
  const params = useSearchParams();
  const workbench = params.get("view") === "workbench" || params.get("id") || params.get("prompt") || (params.get("owner") && params.get("repo"));
  if (workbench) return <TaskWorkspace />;
  return <TasksHome />;
}

function TasksHome() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [jobsKey, setJobsKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [scheduleData, approvalData, settings] = await Promise.all([
        api<{ schedules: Schedule[] }>(`/api/assistant/schedules?timezone=${encodeURIComponent(userTimezone())}`),
        api<{ approvals: Approval[] }>("/api/assistant/approvals"),
        api<{ settings: { city: string | null } }>("/api/assistant/settings").catch(() => ({ settings: { city: null } })),
      ]);
      setSchedules(scheduleData.schedules);
      setApprovals(approvalData.approvals.filter((item) => item.status === "pending"));
      setCity(settings.settings.city);
    } catch (err) { setError((err as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const data = await api<{ schedule: Schedule }>(`/api/assistant/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    setSchedules((current) => body.status === "cancelled" ? (current || []).filter((item) => item.id !== id) : (current || []).map((item) => item.id === id ? { ...item, ...data.schedule } : item));
  }

  return <AppShell title="Tasks">
    <main className="el-page">
      <header className="el-page-head"><h1>Tasks</h1><p>What Elias is working on, what it does on a schedule, and what's waiting on your OK.</p></header>
      <button type="button" className="el-btn el-btn-primary el-btn-lg v4-new-task" onClick={() => setSheet(true)}><Plus size={18} /> New task</button>
      {error ? <ErrorCard text={error} onRetry={() => void load()} /> : null}

      {approvals?.length ? <section className="el-section">
        <h2>Waiting on you</h2>
        {approvals?.length ? <ul className="el-list">{approvals.map((item) => <li key={item.id}><Link className="el-list-row" href={item.conversationId ? `/chat?id=${item.conversationId}` : "/"}>
          <span className="el-list-icon warn"><ShieldCheck size={17} /></span>
          <span className="el-list-text"><strong>{item.details.kind === "email" ? `Email to ${item.details.to}` : item.details.kind === "event" ? `Invite: ${item.details.title}` : item.summary.split("\n")[0]}</strong><small>Tap to review in chat</small></span>
          <ChevronRight size={17} className="el-list-trail" />
        </Link></li>)}</ul> : null}
      </section> : null}

      <JobsSection composer={false} reloadKey={jobsKey} title="Working on" />

      <section className="el-section">
        <h2>Scheduled</h2>
        {!schedules && !error ? <ListSkeleton rows={3} /> : null}
        {schedules && !schedules.length ? <p className="el-empty-line"><Clock3 size={16} /> Nothing scheduled. Ask in chat: “every Monday at 9, summarise my week”.</p> : null}
        {schedules?.length ? <ul className="el-list">{schedules.map((item) => <li key={item.id} className="el-list-item">
          <div className="el-list-row static">
            <span className={`el-list-icon ${item.kind === "daily_brief" ? "accent" : ""}`}>{item.kind === "daily_brief" ? <Sun size={17} /> : <Clock3 size={17} />}</span>
            <span className="el-list-text"><strong>{item.name}</strong><small>{item.status === "paused" ? "Paused" : `Next: ${nextLabel(item.nextRunAt)}`} · {item.when}</small>{item.kind === "daily_brief" ? <small>Calendar, important email, reminders and weather{city ? ` for ${city}` : ""}</small> : <small className="el-clamp">{item.prompt}</small>}</span>
            <span className="el-list-actions">
              {(item.spec.type === "daily" || item.spec.type === "weekly") ? <button type="button" className="el-icon-btn" aria-label={`Edit ${item.name}`} onClick={() => setEditing(editing === item.id ? null : item.id)}><Pencil size={16} /></button> : null}
              <button type="button" className="el-icon-btn" aria-label={item.status === "paused" ? `Resume ${item.name}` : `Pause ${item.name}`} onClick={() => void patch(item.id, { status: item.status === "paused" ? "active" : "paused" }).catch((err) => setError(err.message))}>{item.status === "paused" ? <Play size={16} /> : <Pause size={16} />}</button>
              <button type="button" className="el-icon-btn danger" aria-label={`Remove ${item.name}`} onClick={() => { if (window.confirm(`Remove “${item.name}”?`)) void patch(item.id, { status: "cancelled" }).catch((err) => setError(err.message)); }}><Trash2 size={16} /></button>
            </span>
          </div>
          {editing === item.id ? <ScheduleEditor schedule={item} city={city} onClose={() => setEditing(null)} onSave={async (body, newCity) => {
            await patch(item.id, body);
            if (newCity !== undefined && newCity !== city) { await api("/api/assistant/settings", { method: "PATCH", body: JSON.stringify({ city: newCity }) }); setCity(newCity); }
            setEditing(null);
          }} /> : null}
          {item.lastResult && item.conversationId ? <Link className="el-list-foot" href={`/chat?id=${item.conversationId}`}>Last run: {item.lastResult.slice(0, 90)}{item.lastResult.length > 90 ? "…" : ""}</Link> : null}
        </li>)}</ul> : null}
      </section>

      <section className="el-section">
        <h2>Workbench</h2>
        <ul className="el-list"><li><Link className="el-list-row" href="/tasks?view=workbench">
          <span className="el-list-icon"><SquareKanban size={17} /></span>
          <span className="el-list-text"><strong>Task workbench</strong><small>Plan a task step by step, with files and checkpoints</small></span>
          <ChevronRight size={17} className="el-list-trail" />
        </Link></li></ul>
      </section>
      {sheet ? <NewTaskSheet onClose={() => setSheet(false)} onStarted={() => setJobsKey((value) => value + 1)} /> : null}
    </main>
  </AppShell>;
}

function ScheduleEditor({ schedule, city, onSave, onClose }: { schedule: Schedule; city: string | null; onSave: (body: Record<string, unknown>, city?: string) => Promise<void>; onClose: () => void }) {
  const [time, setTime] = useState(schedule.spec.time || "08:00");
  const [name, setName] = useState(schedule.name);
  const [place, setPlace] = useState(city || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="el-editor" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError(null);
    void onSave({ time, name, timezone: userTimezone() }, schedule.kind === "daily_brief" && place.trim() ? place.trim() : undefined).catch((err) => setError((err as Error).message)).finally(() => setBusy(false));
  }}>
    <label className="el-field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label className="el-field"><span>Time ({userTimezone()})</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
    {schedule.kind === "daily_brief" ? <label className="el-field"><span><MapPin size={13} /> Weather for</span><input value={place} placeholder="City, e.g. Owerri" onChange={(event) => setPlace(event.target.value)} /></label> : null}
    {error ? <p className="el-error-text" role="alert">{error}</p> : null}
    <div className="el-editor-actions"><button type="button" className="el-btn" onClick={onClose}><X size={16} /> Cancel</button><button type="submit" className="el-btn el-btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
  </form>;
}
