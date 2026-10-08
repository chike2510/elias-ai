"use client";

import Link from "next/link";
import { Check, Copy, GitBranch, Globe2, Mail, Pause, Play, Plus, RefreshCcw, ShieldCheck, Sparkles, Trash2, Webhook, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import ScreenHeader from "@/components/ScreenHeader";

type Automation = {
  id: string;
  name: string;
  description: string;
  objective: string;
  instructions: string;
  trigger: "webhook" | "manual";
  approvalPolicy: "always" | "risky" | "never";
  allowedTools: string[];
  preferredProvider?: string;
  preferredModel?: string;
  status: "active" | "paused";
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
  hasWebhookSecret: boolean;
};

const toolOptions = [
  { value: "email.read", label: "Read email", icon: Mail },
  { value: "email.draft", label: "Draft replies", icon: Mail },
  { value: "sheets.read", label: "Read sheets", icon: Workflow },
  { value: "sheets.draft", label: "Draft sheet updates", icon: Workflow },
  { value: "github.repository", label: "Read GitHub context", icon: GitBranch },
  { value: "web.search", label: "Search the web", icon: Globe2 },
  { value: "document.retrieval", label: "Use task context", icon: Sparkles },
];

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: { message?: string } };
  return value.error?.message || fallback;
}

export default function AutomationBuilderScreen() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ secret?: string; url?: string } | null>(null);
  const [sampleEvent, setSampleEvent] = useState('{\n  "subject": "New support request",\n  "body": "A customer needs help with their account."\n}');
  const [form, setForm] = useState({ name: "", description: "", objective: "Classify the incoming request and prepare a helpful response.", instructions: "Read the event, identify the request type, retrieve relevant approved context, and draft a concise response. Do not send messages or change records without explicit approval.", trigger: "webhook" as "webhook" | "manual", approvalPolicy: "risky" as "always" | "risky" | "never", allowedTools: ["document.retrieval", "email.read", "email.draft"] });

  async function load() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/automations", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload, "Could not load automations.")); setAutomations(payload.automations || []); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load automations."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function toggleTool(value: string) { setForm((current) => ({ ...current, allowedTools: current.allowedTools.includes(value) ? current.allowedTools.filter((tool) => tool !== value) : [...current.allowedTools, value] })); }
  async function create() {
    if (!form.name.trim() || !form.objective.trim() || !form.instructions.trim() || creating) return;
    setCreating(true); setError(""); setCreated(null);
    try { const response = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload, "Could not create automation.")); setCreated({ secret: payload.webhookSecret, url: payload.webhookUrl }); setForm((current) => ({ ...current, name: "", description: "" })); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create automation."); }
    finally { setCreating(false); }
  }
  async function run(automation: Automation) {
    setRunning(automation.id); setError("");
    try { let event: unknown = {}; try { event = JSON.parse(sampleEvent); } catch { throw new Error("The sample event must be valid JSON."); } const response = await fetch(`/api/automations/${automation.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event }) }); const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload, "Could not run automation.")); window.location.href = `/tasks?id=${encodeURIComponent(payload.taskId)}`; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not run automation."); setRunning(null); }
  }
  async function toggleStatus(automation: Automation) { const response = await fetch(`/api/automations/${automation.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: automation.status === "active" ? "paused" : "active" }) }); if (response.ok) await load(); else setError(errorMessage(await response.json(), "Could not update automation.")); }
  async function remove(automation: Automation) { if (!window.confirm(`Delete ${automation.name}?`)) return; const response = await fetch(`/api/automations/${automation.id}`, { method: "DELETE" }); if (response.ok) await load(); else setError(errorMessage(await response.json(), "Could not delete automation.")); }
  async function copy(value: string) { await navigator.clipboard?.writeText(value); }

  const activeCount = useMemo(() => automations.filter((automation) => automation.status === "active").length, [automations]);
  return <AppShell title="Advanced automations" back="/automations"><main className="screen automation-screen">
    <ScreenHeader title="Advanced automations" back="/automations" />
    <section className="automation-hero panel"><div className="automation-hero-icon"><Workflow size={24} /></div><div><span className="eyebrow">AI IN THE MIDDLE</span><h1>Build a controlled automation</h1><p>Connect an event to ELIAS, let it read and decide, then draft a result with an explicit approval brake before anything external happens.</p></div><div className="automation-hero-stats"><strong>{activeCount}</strong><span>active workflows</span></div></section>
    {error ? <div className="inline-error"><span>{error}</span></div> : null}
    {created ? <section className="automation-secret panel"><div><ShieldCheck size={18} /><div><strong>Automation created</strong><small>Copy the webhook secret now. It is shown only once.</small></div></div><div className="automation-secret-values">{created.url ? <label>Webhook URL<div><code>{created.url}</code><button type="button" onClick={() => void copy(created.url!)} aria-label="Copy webhook URL"><Copy size={14} /></button></div></label> : null}{created.secret ? <label>Webhook secret<div><code>{created.secret}</code><button type="button" onClick={() => void copy(created.secret!)} aria-label="Copy webhook secret"><Copy size={14} /></button></div></label> : null}</div></section> : null}
    <div className="automation-layout"><section className="automation-builder panel"><div className="panel-head"><span><Sparkles size={16} /><strong>New automation</strong></span><small>TRIGGER → READ → DECIDE → DRAFT → APPROVE</small></div><div className="automation-form-grid"><label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Support inbox triage" /></label><label>Trigger<select value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value as "webhook" | "manual" })}><option value="webhook">Webhook event</option><option value="manual">Manual only</option></select></label></div><label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Classify requests and draft safe replies." /></label><label>Objective<textarea rows={3} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></label><label>Instructions<textarea rows={6} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label><div className="automation-form-section"><div className="automation-section-label"><strong>Allowed context and tools</strong><small>Only selected capabilities are advertised to the agent.</small></div><div className="automation-tool-grid">{toolOptions.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={form.allowedTools.includes(value) ? "selected" : ""} onClick={() => toggleTool(value)}><Icon size={15} /><span>{label}</span>{form.allowedTools.includes(value) ? <Check size={14} /> : null}</button>)}</div></div><div className="automation-form-section"><div className="automation-section-label"><strong>Approval brake</strong><small>Choose when ELIAS must pause before an external side effect.</small></div><div className="automation-policy-grid">{([{ value: "always", label: "Always approve", detail: "Safest for new workflows" }, { value: "risky", label: "Approve risky actions", detail: "Recommended default" }, { value: "never", label: "Pre-approved", detail: "For trusted, reversible work" }] as const).map((policy) => <button key={policy.value} type="button" className={form.approvalPolicy === policy.value ? "selected" : ""} onClick={() => setForm({ ...form, approvalPolicy: policy.value })}><strong>{policy.label}</strong><small>{policy.detail}</small></button>)}</div></div><button type="button" className="primary wide" disabled={creating || !form.name.trim() || !form.objective.trim()} onClick={() => void create()}><Plus size={16} /> {creating ? "Creating…" : "Create automation"}</button></section>
    <aside className="automation-side"><section className="automation-event panel"><div className="panel-head"><span><Webhook size={16} /><strong>Test event</strong></span><small>JSON PAYLOAD</small></div><p>Use this sample to run a workflow before connecting an external system.</p><textarea value={sampleEvent} onChange={(event) => setSampleEvent(event.target.value)} rows={9} /><small className="automation-hint">A webhook can represent an email provider, form submission, support inbox, or another event source.</small></section><section className="automation-safety panel"><ShieldCheck size={18} /><div><strong>Safe by design</strong><p>Every run becomes a normal ELIAS task with evidence, approvals, and a downloadable result. Incoming event data is treated as untrusted context.</p></div></section></aside></div>
    <section className="automation-list-section"><div className="section-heading"><div><span className="eyebrow">YOUR WORKFLOWS</span><h2>Automations</h2></div><button type="button" className="secondary" onClick={() => void load()}><RefreshCcw size={14} /> Refresh</button></div>{loading ? <div className="panel automation-empty">Loading automations…</div> : automations.length ? <div className="automation-list">{automations.map((automation) => <article className="automation-card panel" key={automation.id}><div className="automation-card-top"><div className="automation-card-icon"><Workflow size={17} /></div><div className="automation-card-copy"><div><h3>{automation.name}</h3><span className={`automation-status ${automation.status}`}>{automation.status}</span></div><p>{automation.description || automation.objective}</p></div></div><div className="automation-card-meta"><span>{automation.trigger === "webhook" ? "Webhook trigger" : "Manual trigger"}</span><span>{automation.approvalPolicy === "always" ? "Approval always" : automation.approvalPolicy === "risky" ? "Approval for risky actions" : "Pre-approved"}</span><span>{automation.runCount} runs</span></div><div className="automation-card-actions"><button type="button" className="primary" disabled={running === automation.id} onClick={() => void run(automation)}><Play size={14} /> {running === automation.id ? "Starting…" : "Test run"}</button><button type="button" className="secondary" onClick={() => void toggleStatus(automation)}>{automation.status === "active" ? <Pause size={14} /> : <Play size={14} />} {automation.status === "active" ? "Pause" : "Resume"}</button><button type="button" className="icon-btn danger" onClick={() => void remove(automation)} aria-label={`Delete ${automation.name}`}><Trash2 size={15} /></button></div></article>)}</div> : <div className="panel automation-empty"><Workflow size={22} /><strong>No automations yet</strong><p>Create your first workflow above. Start with a webhook and keep approval set to “Approve risky actions” until the workflow is proven.</p></div>}</section>
    <p className="automation-footnote">Experiential Labs is the preferred model gateway when <code>EXPERIENTIAL_API_KEY</code> is configured. ELIAS keeps its existing provider fallback chain if it is unavailable.</p>
  </main></AppShell>;
}
