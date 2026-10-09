"use client";

import Link from "next/link";
import { CalendarClock, ChevronRight, Clock3, LoaderCircle, Pause, Play, Plug, Sparkles, Trash2, Wand2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorCard } from "@/components/chat/ChatView";
import AppShell, { ListSkeleton } from "@/components/AppShell";
import { api, userTimezone } from "@/lib/chatClient";
import type { AutomationPlan } from "@/lib/automationPlan";

type Automation = { id: string; name: string; prompt: string; when: string; status: string; kind: string; nextRunAt: string | null; lastRunAt: string | null; lastResult: string | null; conversationId: string | null };
type Draft = { plan: AutomationPlan; when: string; nextRunAt: string; timezone: string };

const EXAMPLES = [
  "Every weekday at 7am, send me my agenda and anything urgent in my email",
  "Every Friday at 5pm, summarise the week's tech news in 5 bullets",
  "Every 3 hours, check if the price of a PS5 on Jumia drops below ₦500,000",
  "Tomorrow at 9am, remind me to call the bank",
];
const NEED_LABEL: Record<string, string> = { google: "Google (Gmail and Calendar)", github: "GitHub", browser: "the remote browser" };

function nextLabel(iso: string | null) {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Today, ${time}`;
  if (date.toDateString() === new Date(Date.now() + 86_400_000).toDateString()) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/** /automations: say what you want in plain words, confirm the plan, and Elias runs it on schedule. */
export default function AutomationsScreen() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"plan" | "save" | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [items, setItems] = useState<Automation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try { setItems((await api<{ automations: Automation[] }>("/api/assistant/automations")).automations); }
    catch (err) { setLoadError((err as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function plan(event?: React.FormEvent) {
    event?.preventDefault();
    if (text.trim().length < 4 || busy) return;
    setBusy("plan"); setError(null); setQuestion(null); setDraft(null); setNotice(null);
    try {
      const data = await api<{ plan?: AutomationPlan; when?: string; nextRunAt?: string; timezone?: string; question?: string }>("/api/assistant/automations/plan", { method: "POST", body: JSON.stringify({ text, timezone: userTimezone() }) });
      if (data.question) setQuestion(data.question);
      else if (data.plan) setDraft({ plan: data.plan, when: data.when || "", nextRunAt: data.nextRunAt || "", timezone: data.timezone || userTimezone() });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function confirm() {
    if (!draft || busy) return;
    setBusy("save"); setError(null);
    try {
      const data = await api<{ kind: "job" | "schedule"; job?: { conversationId: string } }>("/api/assistant/automations", { method: "POST", body: JSON.stringify({ plan: draft.plan, timezone: draft.timezone }) });
      setNotice(data.kind === "job" ? "Started. The result will land in your chat." : `Saved. First run: ${nextLabel(draft.nextRunAt)}.`);
      setDraft(null); setText(""); await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function setStatus(item: Automation, status: "active" | "paused") {
    try { await api(`/api/assistant/schedules/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); } catch (err) { setError((err as Error).message); }
  }
  async function remove(item: Automation) {
    if (!window.confirm(`Delete “${item.name}”?`)) return;
    try { await api(`/api/assistant/schedules/${item.id}`, { method: "DELETE" }); await load(); } catch (err) { setError((err as Error).message); }
  }

  return <AppShell title="Automations">
    <main className="el-page v4a-page">
      <header className="el-page-head"><h1>Automations</h1><p>Tell Elias what to do and when, in your own words. You'll see the plan before anything is set up.</p></header>

      <form className="v4a-ask" onSubmit={(event) => void plan(event)}>
        <label className="el-field"><span>What should happen?</span>
          <textarea rows={3} maxLength={1500} value={text} placeholder="e.g. Every weekday at 7am, send me my agenda and anything urgent in my email" onChange={(event) => { setText(event.target.value); setQuestion(null); }} />
        </label>
        <button type="submit" className="el-btn el-btn-primary v4a-go" disabled={busy !== null || text.trim().length < 4}>{busy === "plan" ? <><LoaderCircle size={16} className="el-spin" /> Planning…</> : <><Wand2 size={16} /> Plan it</>}</button>
        {!text && !draft ? <div className="v4a-examples">{EXAMPLES.map((example) => <button key={example} type="button" className="v4a-example" onClick={() => setText(example)}>{example}</button>)}</div> : null}
      </form>

      {question ? <p className="v4a-question" role="status"><Sparkles size={16} /> {question}</p> : null}
      {error ? <p className="el-error-text" role="alert">{error}</p> : null}
      {notice ? <p className="v4a-notice" role="status">{notice}</p> : null}

      {draft ? <article className="v4a-plan" aria-label="Automation plan">
        <div className="v4a-plan-head"><span className="v4a-plan-icon">{draft.plan.mode === "now" ? <Zap size={18} /> : <CalendarClock size={18} />}</span><div><small>Plan</small><strong>{draft.plan.name}</strong></div></div>
        <p className="v4a-plan-summary">{draft.plan.summary}</p>
        <dl className="v4a-plan-rows">
          <div><dt>When</dt><dd>{draft.when}{draft.plan.mode === "schedule" && draft.nextRunAt ? <small>First run {nextLabel(draft.nextRunAt)}</small> : null}</dd></div>
          <div><dt>What Elias does</dt><dd>{draft.plan.prompt}</dd></div>
          <div><dt>Where you get it</dt><dd>Your chat, with a notification</dd></div>
        </dl>
        {draft.plan.needs.length ? <p className="v4a-needs"><Plug size={15} /> Works best with {draft.plan.needs.map((need) => NEED_LABEL[need] || need).join(" and ")} connected. <Link href="/connectors">Connectors</Link></p> : null}
        <p className="el-fineprint">Anything that sends, books, pays or deletes still waits for your OK.</p>
        <div className="v4a-plan-actions">
          <button type="button" className="el-btn" onClick={() => setDraft(null)}>Change it</button>
          <button type="button" className="el-btn el-btn-primary" disabled={busy !== null} onClick={() => void confirm()}>{busy === "save" ? "Saving…" : draft.plan.mode === "now" ? "Run it now" : "Turn it on"}</button>
        </div>
      </article> : null}

      <section className="el-section">
        <div className="el-section-head"><h2>Your automations</h2></div>
        {!items && loadError ? <ErrorCard text={loadError} onRetry={() => void load()} /> : !items ? <ListSkeleton rows={3} /> : !items.length ? <p className="el-empty-line"><Clock3 size={16} /> Nothing yet. Describe one above.</p> : <ul className="el-list">{items.map((item) => {
          const paused = item.status === "paused";
          return <li key={item.id} className="el-list-item">
            <div className="el-list-row static">
              <span className={`el-list-icon ${paused ? "v4a-paused" : ""}`}><CalendarClock size={17} /></span>
              <span className="el-list-text">
                <strong className="el-wrap">{item.name}</strong>
                <small>{item.when}{paused ? " · Paused" : item.nextRunAt ? ` · Next ${nextLabel(item.nextRunAt)}` : ""}</small>
                {item.lastResult ? <small className="el-clamp">Last: {item.lastResult.replace(/[*#`>_]/g, "")}</small> : null}
              </span>
              <span className="el-list-actions">
                <button type="button" className="el-icon-btn" aria-label={paused ? `Resume ${item.name}` : `Pause ${item.name}`} onClick={() => void setStatus(item, paused ? "active" : "paused")}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>
                <button type="button" className="el-icon-btn danger" aria-label={`Delete ${item.name}`} onClick={() => void remove(item)}><Trash2 size={17} /></button>
              </span>
            </div>
          </li>;
        })}</ul>}
      </section>

      <section className="el-section">
        <Link className="v4a-advanced" href="/automations/advanced"><span><strong>Advanced: webhook automations</strong><small>Trigger Elias from another app with a webhook and a custom tool list.</small></span><ChevronRight size={18} /></Link>
      </section>
    </main>
  </AppShell>;
}
