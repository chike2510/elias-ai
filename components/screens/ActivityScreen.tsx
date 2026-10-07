"use client";

import "@/components/brain.css";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { ErrorCard } from "@/components/chat/ChatView";
import { api, STATUS_TEXT } from "@/components/screens/activityText";

type Entry = { id: number; tool: string; argsSummary: string; status: string; result: string | null; approvalId: string | null; conversationId: string | null; origin: string; createdAt: string };

const DOT: Record<string, string> = { ok: "ok", error: "error", blocked: "error", declined: "warn", pending_approval: "pending" };

/** Activity: every action Elias took that changed something (sent, saved, scheduled, deployed), with redacted details. */
export default function ActivityScreen() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); void api<{ entries: Entry[] }>("/api/assistant/activity").then((data) => setEntries(data.entries)).catch((err) => setError(err.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const days = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries || []) {
      const day = new Date(entry.createdAt).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
      map.set(day, [...(map.get(day) || []), entry]);
    }
    return [...map.entries()];
  }, [entries]);

  return <AppShell title="Activity">
    <main className="el-page">
      <Link href="/you" className="el-back-link"><ArrowLeft size={16} /> You</Link>
      <header className="el-page-head"><h1>Activity</h1><p>Everything Elias did that changed something: emails, calendar, memory, schedules, deploys. Sensitive values are redacted.</p></header>
      {error ? <ErrorCard text={error} onRetry={load} /> : null}
      {!entries && !error ? <ListSkeleton rows={6} /> : null}
      {entries && !entries.length ? <p className="el-empty-line"><ShieldCheck size={16} /> No actions yet. When Elias sends, saves or schedules something, it shows up here.</p> : null}
      {days.map(([day, items]) => <section key={day} aria-label={day}>
        <h2 className="el-day">{day}</h2>
        <ul className="el-activity-list">{items.map((entry) => <li key={entry.id} className="el-activity-row">
          <span className={`el-status-dot ${DOT[entry.status] || "info"}`} aria-hidden="true" />
          <span className="el-activity-main">
            <strong>{STATUS_TEXT.tool(entry.tool)} · {STATUS_TEXT.status(entry.status)}</strong>
            {entry.argsSummary ? <code>{entry.argsSummary}</code> : null}
            {entry.result && entry.status !== "ok" ? <code>{entry.result}</code> : null}
            <small>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {entry.origin}{entry.approvalId && (entry.status === "ok" || entry.status === "error") ? " · approved by you" : ""}</small>
          </span>
        </li>)}</ul>
      </section>)}
    </main>
  </AppShell>;
}
