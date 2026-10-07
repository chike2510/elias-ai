"use client";

import { ArrowLeft, Bell, Check, Mail, Share } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, userTimezone } from "@/lib/chatClient";
import { enablePush, permission, pushSupport, type PushSupport } from "@/lib/pushClient";

type State = {
  onboarding: { needed: boolean; preferredName: string | null; timezone: string | null; city: string | null; briefTime: string | null };
  google: { configured: boolean; connected: boolean; email: string | null };
  push: { configured: boolean };
  suggestedName: string | null;
};

/** Quick preference questions. Each answer is saved as one memory sentence. */
const QUESTIONS: Array<{ id: string; question: string; options: Array<{ label: string; statement: string }> }> = [
  { id: "style", question: "How should I write to you?", options: [
    { label: "Short and direct", statement: "Prefers short, direct replies." },
    { label: "A bit more detail", statement: "Prefers replies with a bit more detail and reasoning." },
  ] },
  { id: "focus", question: "What will you mostly use me for?", options: [
    { label: "Work & email", statement: "Mostly uses Elias for work and email." },
    { label: "Study", statement: "Mostly uses Elias for studying." },
    { label: "Building & code", statement: "Mostly uses Elias for building software and coding." },
    { label: "Life admin", statement: "Mostly uses Elias for personal errands and life admin." },
  ] },
  { id: "units", question: "Temperatures in…", options: [
    { label: "°C", statement: "Prefers temperatures in Celsius." },
    { label: "°F", statement: "Prefers temperatures in Fahrenheit." },
  ] },
  { id: "proactive", question: "Should I suggest things before you ask?", options: [
    { label: "Yes, nudge me", statement: "Welcomes proactive suggestions and nudges." },
    { label: "Only when I ask", statement: "Prefers Elias to act only when asked, with few unprompted suggestions." },
  ] },
];

const STEPS = ["You", "Your day", "Connect", "Preferences"];

function timezones(current: string) {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") || [];
    return list.includes(current) ? list : [current, ...list];
  } catch { return [current]; }
}

export default function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(() => Math.min(3, Math.max(0, Number(params.get("step")) || 0)));
  const [name, setName] = useState("");
  const detected = useMemo(() => userTimezone(), []);
  const [timezone, setTimezone] = useState(detected);
  const [briefTime, setBriefTime] = useState("08:00");
  const [city, setCity] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<{ support: PushSupport; on: boolean; message: string | null }>({ support: "unsupported", on: false, message: null });

  useEffect(() => {
    setPush({ support: pushSupport(), on: permission() === "granted", message: null });
    void api<State & { ok: true }>("/api/assistant/onboarding").then((data) => {
      setState(data);
      setName(data.onboarding.preferredName || (data.suggestedName || "").split(" ")[0] || "");
      if (data.onboarding.timezone && data.onboarding.timezone !== detected) setTimezone(data.onboarding.timezone);
      if (data.onboarding.briefTime) setBriefTime(data.onboarding.briefTime);
      setCity(data.onboarding.city || (detected.split("/").pop() || "").replace(/_/g, " "));
    }).catch((err) => setLoadError((err as Error).message));
  }, [detected]);

  async function post(body: Record<string, unknown>) {
    return api("/api/assistant/onboarding", { method: "POST", body: JSON.stringify(body) });
  }

  async function next() {
    setError(null); setBusy(true);
    try {
      if (step === 0) { if (!name.trim()) throw new Error("Tell me what to call you."); await post({ action: "profile", preferredName: name }); }
      if (step === 1) await post({ action: "routine", timezone, briefTime, city });
      if (step === 3) {
        const statements = QUESTIONS.map((q) => q.options.find((option) => option.label === answers[q.id])?.statement).filter(Boolean).map((statement) => ({ statement }));
        if (note.trim()) statements.push({ statement: note.trim() });
        if (statements.length) await post({ action: "preferences", answers: statements });
        await post({ action: "complete" });
        router.replace("/");
        return;
      }
      setStep((current) => current + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function skip() {
    setBusy(true);
    await post({ action: "skip" }).catch(() => undefined);
    router.replace("/");
  }

  async function turnOnPush() {
    setPush((current) => ({ ...current, message: null }));
    const result = await enablePush().catch((err) => ({ ok: false as const, reason: (err as Error).message }));
    setPush((current) => ({ ...current, on: result.ok, message: result.ok ? null : result.reason }));
  }

  if (loadError) return <main className="el-onboard"><p className="el-error-text" role="alert">{loadError}</p><button type="button" className="el-btn" onClick={() => router.replace("/")}>Go to chat</button></main>;

  return <main className="el-onboard">
    <header className="el-onboard-head">
      {step > 0 ? <button type="button" className="el-icon-btn" aria-label="Back" onClick={() => { setError(null); setStep(step - 1); }}><ArrowLeft size={18} /></button> : <span className="el-onboard-spacer" />}
      <ol className="el-onboard-dots" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>{STEPS.map((label, index) => <li key={label} className={index === step ? "on" : index < step ? "done" : ""} />)}</ol>
      <button type="button" className="el-btn el-btn-ghost el-btn-sm el-onboard-skip" onClick={() => void skip()} disabled={busy}>Skip</button>
    </header>

    <section className="el-onboard-body">
      {!state ? <div className="el-skeleton" style={{ height: 120, width: "100%" }} /> : null}

      {state && step === 0 ? <>
        <img src="/branding/elias-logo.png" alt="" className="el-onboard-mark" />
        <h1>Hi, I'm Elias.</h1>
        <p>I'll keep track of your day, your inbox and the errands you hand me. First, what should I call you?</p>
        <label className="el-field"><span>Your name</span><input value={name} autoComplete="given-name" maxLength={60} placeholder="e.g. Chike" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void next(); }} /></label>
      </> : null}

      {state && step === 1 ? <>
        <h1>Your day</h1>
        <p>I send a short brief each morning: weather, calendar, important email and reminders.</p>
        <label className="el-field"><span>Timezone {timezone === detected ? "(detected)" : ""}</span>
          <select className="el-select" value={timezone} onChange={(event) => setTimezone(event.target.value)}>{timezones(timezone).map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}{zone === detected ? " (detected)" : ""}</option>)}</select>
        </label>
        <label className="el-field"><span>Brief time</span><input type="time" value={briefTime} required onChange={(event) => setBriefTime(event.target.value)} /></label>
        <label className="el-field"><span>Weather for</span><input value={city} placeholder="City, e.g. Makurdi" autoComplete="address-level2" onChange={(event) => setCity(event.target.value)} /></label>
      </> : null}

      {state && step === 2 ? <>
        <h1>Connect</h1>
        <p>Both are optional, and you can change them later on the You page.</p>
        <ul className="el-list">
          <li><div className="el-list-row static">
            <span className="el-list-icon"><Mail size={17} /></span>
            <span className="el-list-text"><strong>Google</strong><small>{state.google.connected ? `Connected${state.google.email ? ` as ${state.google.email}` : ""}` : state.google.configured ? "Gmail and Calendar, for your brief and errands" : "Not configured yet on this server"}</small></span>
            {state.google.connected ? <span className="el-state on"><Check size={13} /> On</span>
              : state.google.configured ? <a className="el-btn el-btn-primary el-btn-sm" href={`/api/connect/google?return=${encodeURIComponent("/welcome?step=2")}`}>Connect</a>
              : <span className="el-state na">Not set up</span>}
          </div></li>
          <li><div className="el-list-row static">
            <span className="el-list-icon"><Bell size={17} /></span>
            <span className="el-list-text"><strong>Notifications</strong><small>{!state.push.configured ? "Not configured yet on this server" : push.support === "ios-needs-install" ? "Add Elias to your Home Screen first" : push.support === "unsupported" ? "Not supported in this browser" : "Brief, reminders, approvals and finished jobs"}</small></span>
            {push.on ? <span className="el-state on"><Check size={13} /> On</span>
              : state.push.configured && push.support === "supported" ? <button type="button" className="el-btn el-btn-primary el-btn-sm" onClick={() => void turnOnPush()}>Turn on</button>
              : <span className="el-state na">{push.support === "ios-needs-install" ? "Install first" : "Not available"}</span>}
          </div></li>
        </ul>
        {push.support === "ios-needs-install" ? <p className="el-hint"><Share size={15} /> On iPhone: tap Share, then “Add to Home Screen”, and open Elias from your Home Screen to allow notifications.</p> : null}
        {push.message ? <p className="el-fineprint" role="status">{push.message}</p> : null}
      </> : null}

      {state && step === 3 ? <>
        <h1>A few quick ones</h1>
        <p>Tap whatever fits. I'll remember it.</p>
        {QUESTIONS.map((q) => <fieldset key={q.id} className="el-onboard-q"><legend>{q.question}</legend>
          <div className="el-chips">{q.options.map((option) => <button type="button" key={option.label} aria-pressed={answers[q.id] === option.label} className={`el-chip ${answers[q.id] === option.label ? "on" : ""}`} onClick={() => setAnswers((current) => ({ ...current, [q.id]: current[q.id] === option.label ? "" : option.label }))}>{option.label}</button>)}</div>
        </fieldset>)}
        <label className="el-field"><span>Anything else I should know? (optional)</span><input value={note} maxLength={300} placeholder="e.g. I'm a student at UniAbuja, exams in November" onChange={(event) => setNote(event.target.value)} /></label>
      </> : null}

      {error ? <p className="el-error-text" role="alert">{error}</p> : null}
    </section>

    <footer className="el-onboard-foot">
      <button type="button" className="el-btn el-btn-primary el-btn-lg" disabled={busy || !state} onClick={() => void next()}>{busy ? "Saving…" : step === 3 ? "Finish" : step === 2 ? "Continue" : "Next"}</button>
    </footer>
  </main>;
}
