"use client";

import { AlertCircle, ArrowUp, CheckCircle2, ChevronDown, CircleDashed, ExternalLink, FileCode2, GitBranch, GitPullRequest, LoaderCircle, Play, Search, Square, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import ApprovalCard from "@/components/chat/ApprovalCard";
import { MessageCard } from "@/components/chat/Cards";
import MarkdownMessage from "@/components/MarkdownMessage";
import { DiffView } from "@/components/code/DiffView";
import { api, userTimezone, type Approval, type Card, type StoredMessage, type TurnEvent } from "@/lib/chatClient";
import type { DiffFile } from "@/lib/assistant/code/cards";
import type { VerifyState } from "@/lib/assistant/code/github";

type Tab = "files" | "diff" | "checks" | "agent";
type SetView = { repo: string; baseBranch: string; branch: string | null; baseSha: string; commits: Array<{ sha: string; message: string; at: string }>; prNumber: number | null; verify: VerifyState | null; maxAttempts: number };
type State = { conversationId?: string | null; set: SetView | null; files?: DiffFile[]; diff?: string; added?: number; removed?: number };
type Repo = { fullName: string; private: boolean; description: string; defaultBranch: string; canWrite: boolean; updatedAt?: string };
type Msg = { key: string; role: "user" | "assistant"; content: string; cards: Card[]; approvalIds: string[]; status?: "streaming" | "error"; statusLine?: string };

const KEY = "elias:code:conversation";
const TABS: Array<{ id: Tab; label: string }> = [{ id: "files", label: "Files" }, { id: "diff", label: "Diff" }, { id: "checks", label: "Checks" }, { id: "agent", label: "Agent" }];

function fromStored(message: StoredMessage): Msg | null {
  if (message.role === "event") return null;
  return { key: `m${message.id}`, role: message.role, content: message.content, cards: (message.meta.cards as Card[]) || [], approvalIds: (message.meta.approvals as string[]) || [] };
}

/** Streams one code-mode turn from /api/code/chat (SSE). */
async function streamCode(body: Record<string, unknown>, onEvent: (event: TurnEvent) => void, signal: AbortSignal) {
  const response = await fetch("/api/code/chat", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ ...body, stream: true, timezone: userTimezone() }), signal });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message || `Elias couldn't answer (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, cut).split("\n").find((item) => item.startsWith("data:"));
      buffer = buffer.slice(cut + 2);
      if (!line) continue;
      try { const event = JSON.parse(line.slice(5).trim()) as TurnEvent | { type: "ping" }; if (event.type !== "ping") onEvent(event); } catch { /* partial */ }
    }
  }
}

function CiPill({ verify, sha }: { verify: VerifyState | null | undefined; sha?: string }) {
  if (!verify || (sha && verify.sha !== sha)) return <span className="v4c-pill">No checks yet</span>;
  const Icon = verify.status === "passed" ? CheckCircle2 : verify.status === "failed" ? XCircle : CircleDashed;
  return <span className={`v4c-pill v4c-pill-${verify.status}`}><Icon size={13} aria-hidden /> {verify.status === "passed" ? "Passing" : verify.status === "failed" ? "Failing" : verify.status === "running" ? "Running" : "No CI"}</span>;
}

export default function CodeWorkspace() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>("agent");
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "open" | "verify" | "chat">("");
  const conversationRef = useRef<string | null>(null);

  const load = useCallback(async (id: string | null) => {
    try {
      const data = await api<State & { ok: boolean }>(`/api/code/state${id ? `?conversationId=${encodeURIComponent(id)}` : ""}`);
      const resolved = id || data.conversationId || null;
      conversationRef.current = resolved;
      setConversationId(resolved);
      setState(data);
      if (resolved) { try { localStorage.setItem(KEY, resolved); } catch { /* private mode */ } }
      if (!data.set) setPickerOpen(true);
    } catch (error) { setNotice((error as Error).message); setState({ set: null }); }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("c");
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    void load(fromUrl || saved);
  }, [load]);

  useEffect(() => {
    if (!conversationId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("c") !== conversationId) { url.searchParams.set("c", conversationId); window.history.replaceState(null, "", url.toString()); }
  }, [conversationId]);

  async function openRepo(repo: string) {
    setBusy("open"); setNotice(null);
    try {
      const data = await api<State & { conversationId: string }>("/api/code/state", { method: "POST", body: JSON.stringify({ action: "open", repo, conversationId: state?.set?.repo === repo ? conversationId : undefined, timezone: userTimezone() }) });
      conversationRef.current = data.conversationId;
      setConversationId(data.conversationId);
      try { localStorage.setItem(KEY, data.conversationId); } catch { /* ignore */ }
      setState(data); setPickerOpen(false); setTab("files");
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(""); }
  }

  async function runChecks() {
    if (!conversationId) return;
    setBusy("verify"); setNotice(null); setTab("checks");
    try {
      const data = await api<State>("/api/code/state", { method: "POST", body: JSON.stringify({ action: "verify", conversationId, timezone: userTimezone() }) });
      setState((prev) => ({ ...prev, ...data }));
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(""); }
  }

  const agentRef = useRef<{ send: (text: string) => void } | null>(null);
  function openPr() { setTab("agent"); setTimeout(() => agentRef.current?.send("Open a pull request for this branch with a clear title and a short summary of what changed and how it was tested."), 0); }

  const set = state?.set || null;
  const staged = state?.files?.length || 0;
  const canCheck = Boolean(set?.branch && set.commits.length && !staged);
  const prUrl = set?.prNumber ? `https://github.com/${set.repo}/pull/${set.prNumber}` : null;

  return <AppShell title="Code">
    <main className="v4c-ws">
      <header className="v4c-head">
        <button type="button" className="v4c-repo" onClick={() => setPickerOpen(true)} aria-label={set ? `Repository ${set.repo}, change` : "Pick a repository"}>
          <FileCode2 size={17} aria-hidden />
          <span className="v4c-repo-name">{set ? set.repo.split("/")[1] : "Pick a repo"}</span>
          <ChevronDown size={15} aria-hidden />
        </button>
        {set ? <span className="v4c-branch" title={set.branch || set.baseBranch}><GitBranch size={13} aria-hidden /> {set.branch ? set.branch.replace(/^elias\//, "") : set.baseBranch}</span> : null}
        {set ? <CiPill verify={set.verify} sha={set.baseSha} /> : null}
      </header>
      {notice ? <div className="el-notice warn" role="status"><AlertCircle size={16} /><span>{notice}</span><button type="button" className="el-icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div> : null}
      <nav className="v4c-tabs" role="tablist" aria-label="Workspace">
        {TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "on" : ""} onClick={() => setTab(item.id)}>
          {item.label}{item.id === "diff" && staged ? <b className="v4c-badge">{staged}</b> : null}
        </button>)}
      </nav>
      <section className="v4c-pane" role="tabpanel">
        {!state ? <div className="v4c-empty"><LoaderCircle className="v4c-spin" size={20} /> Loading…</div>
          : tab === "files" ? <FilesTab conversationId={conversationId} set={set} staged={state.files || []} onPick={() => setPickerOpen(true)} />
          : tab === "diff" ? <DiffTab state={state} conversationId={conversationId} onChanged={setState} />
          : tab === "checks" ? <ChecksTab set={set} busy={busy === "verify"} />
          : null}
        <AgentTab hidden={tab !== "agent"} conversationId={conversationId} repo={set?.repo} handle={agentRef}
          onConversation={(id) => { if (id !== conversationRef.current) { conversationRef.current = id; setConversationId(id); try { localStorage.setItem(KEY, id); } catch { /* ignore */ } } }}
          onTurnDone={() => void load(conversationRef.current)} onBusy={(value) => setBusy(value ? "chat" : "")} />
      </section>
      {set ? <footer className="v4c-actions">
        <button type="button" className="el-btn" disabled={!canCheck || busy !== ""} onClick={() => void runChecks()} title={canCheck ? "Run CI on the pushed branch" : staged ? "Commit staged changes first" : "Nothing pushed yet"}>
          {busy === "verify" ? <LoaderCircle className="v4c-spin" size={16} /> : <Play size={16} />} Run checks
        </button>
        {prUrl ? <a className="el-btn el-btn-primary" href={prUrl} target="_blank" rel="noreferrer"><GitPullRequest size={16} /> PR #{set.prNumber}</a>
          : <button type="button" className="el-btn el-btn-primary" disabled={!set.branch || !set.commits.length || busy !== ""} onClick={openPr}><GitPullRequest size={16} /> Open PR</button>}
      </footer> : null}
    </main>
    {pickerOpen ? <RepoPicker current={set?.repo} busy={busy === "open"} onPick={(repo) => void openRepo(repo)} onClose={() => setPickerOpen(false)} /> : null}
  </AppShell>;
}

function RepoPicker({ current, busy, onPick, onClose }: { current?: string; busy: boolean; onPick: (repo: string) => void; onClose: () => void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    fetch("/api/github/repos", { cache: "no-store" }).then(async (response) => {
      const data = await response.json().catch(() => null) as { repositories?: Repo[]; message?: string } | null;
      if (!response.ok) throw new Error(data?.message || "Couldn't load your repos.");
      setRepos(data?.repositories || []);
    }).catch((err: Error) => setError(err.message));
  }, []);
  const typed = /^[\w.-]+\/[\w.-]+$/.test(query.trim()) ? query.trim() : "";
  const shown = (repos || []).filter((repo) => repo.fullName.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 60);
  return <div className="el-overlay el-overlay-sheet" onClick={onClose}>
    <div className="el-sheet v4c-sheet" role="dialog" aria-modal="true" aria-label="Pick a repository" onClick={(event) => event.stopPropagation()}>
      <span className="el-sheet-grip" aria-hidden="true" />
      <div className="el-sheet-head"><FileCode2 size={18} /><strong>Repository</strong><button type="button" className="el-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      <label className="v4c-search"><Search size={16} aria-hidden /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or type owner/repo" aria-label="Search repositories" /></label>
      {error ? <div className="el-notice warn"><AlertCircle size={16} /><span>{error}</span><a href="/api/connect/github">Connect GitHub</a></div> : null}
      <ul className="v4c-repos">
        {typed && !shown.some((repo) => repo.fullName === typed) ? <li><button type="button" disabled={busy} onClick={() => onPick(typed)}><span className="v4c-repo-title">Open {typed}</span></button></li> : null}
        {!repos && !error ? <li className="v4c-empty"><LoaderCircle className="v4c-spin" size={18} /> Loading repos…</li> : null}
        {shown.map((repo) => <li key={repo.fullName}><button type="button" disabled={busy} aria-current={repo.fullName === current} onClick={() => onPick(repo.fullName)}>
          <span className="v4c-repo-title">{repo.fullName}{repo.private ? <small> · private</small> : null}{!repo.canWrite ? <small> · read-only</small> : null}</span>
          <span className="v4c-repo-desc">{repo.description}</span>
        </button></li>)}
      </ul>
      {busy ? <div className="v4c-empty"><LoaderCircle className="v4c-spin" size={18} /> Opening…</div> : null}
    </div>
  </div>;
}

function FilesTab({ conversationId, set, staged, onPick }: { conversationId: string | null; set: SetView | null; staged: DiffFile[]; onPick: () => void }) {
  const [paths, setPaths] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repoKey = `${set?.repo}@${set?.baseSha}:${staged.length}`;
  useEffect(() => {
    if (!conversationId || !set) return;
    setPaths(null); setError(null);
    api<{ paths: string[] }>("/api/code/state", { method: "POST", body: JSON.stringify({ action: "tree", conversationId }) }).then((data) => setPaths(data.paths)).catch((err: Error) => setError(err.message));
  }, [conversationId, repoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = useMemo(() => new Map(staged.map((file) => [file.path, file.status])), [staged]);
  if (!set) return <div className="v4c-empty"><p>Pick a repo to start.</p><button type="button" className="el-btn el-btn-primary" onClick={onPick}>Pick a repo</button></div>;
  async function read(path: string) {
    try { const data = await api<{ path: string; content: string }>("/api/code/state", { method: "POST", body: JSON.stringify({ action: "read", conversationId, path }) }); setOpen(data); }
    catch (err) { setError((err as Error).message); }
  }
  if (open) return <div className="v4c-viewer">
    <div className="v4c-viewer-head"><button type="button" className="el-btn" onClick={() => setOpen(null)}>Back</button><code title={open.path}>{open.path}</code></div>
    <pre className="v4c-code">{open.content.split("\n").map((line, index) => <span key={index}><i>{index + 1}</i>{line || " "}{"\n"}</span>)}</pre>
  </div>;
  const q = query.trim().toLowerCase();
  const shown = (paths || []).filter((path) => !q || path.toLowerCase().includes(q));
  const deleted = staged.filter((file) => file.status === "deleted").map((file) => file.path);
  return <div>
    <label className="v4c-search"><Search size={16} aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a file" aria-label="Find a file" /></label>
    {error ? <div className="el-notice warn"><AlertCircle size={16} /><span>{error}</span></div> : null}
    {!paths && !error ? <div className="v4c-empty"><LoaderCircle className="v4c-spin" size={18} /> Loading files…</div> : null}
    <ul className="v4c-tree">
      {[...shown.filter((path) => status.has(path)), ...deleted.filter((path) => !q || path.includes(q)), ...shown.filter((path) => !status.has(path))].slice(0, 400).map((path) => {
        const mark = status.get(path);
        return <li key={path}><button type="button" disabled={mark === "deleted"} onClick={() => void read(path)}>
          {mark ? <b className={`v4c-mark v4c-ic-${mark}`}>{mark === "added" ? "A" : mark === "deleted" ? "D" : "M"}</b> : null}
          <span className="v4c-path">{path}</span>
        </button></li>;
      })}
    </ul>
    {shown.length > 400 ? <p className="v4c-hint">{shown.length - 400} more; search to narrow.</p> : null}
  </div>;
}

function DiffTab({ state, conversationId, onChanged }: { state: State; conversationId: string | null; onChanged: (state: State) => void }) {
  const set = state.set;
  const files = state.files || [];
  const last = set?.commits[set.commits.length - 1];
  async function discard() {
    if (!conversationId || !window.confirm("Discard all staged changes? This can't be undone.")) return;
    const data = await api<State>("/api/code/state", { method: "POST", body: JSON.stringify({ action: "discard", conversationId }) }).catch(() => null);
    if (data) onChanged({ ...state, ...data });
  }
  return <div>
    {files.length ? <>
      <div className="v4c-row"><span>{files.length} file{files.length === 1 ? "" : "s"} staged · <b className="v4c-add">+{state.added}</b> <b className="v4c-del">−{state.removed}</b></span><button type="button" className="el-btn" onClick={() => void discard()}>Discard</button></div>
      <div className="el-card v4c-card"><DiffView files={files} diff={state.diff} openFirst /></div>
    </> : <div className="v4c-empty"><p>No uncommitted changes.</p>{last ? <p className="v4c-hint">Last commit <code>{last.sha.slice(0, 7)}</code> {last.message}</p> : <p className="v4c-hint">Ask the agent for a change; edits show up here before they're committed.</p>}</div>}
    {set?.commits.length ? <ul className="v4c-commits" aria-label="Commits on this branch">{[...set.commits].reverse().map((commit) => <li key={commit.sha}><a href={`https://github.com/${set.repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer"><code>{commit.sha.slice(0, 7)}</code> <span>{commit.message}</span></a></li>)}</ul> : null}
  </div>;
}

function ChecksTab({ set, busy }: { set: SetView | null; busy: boolean }) {
  if (!set) return <div className="v4c-empty"><p>Pick a repo first.</p></div>;
  const verify = set.verify;
  const current = verify && verify.sha === set.baseSha;
  return <div>
    {busy ? <div className="v4c-empty"><LoaderCircle className="v4c-spin" size={20} /> Waiting for CI…</div> : null}
    {!verify ? <div className="v4c-empty"><p>No checks yet.</p><p className="v4c-hint">{set.branch ? "Tap Run checks to run CI on the pushed branch." : "Checks run after the agent commits to an elias/ branch."}</p></div> : <>
      <div className={`el-card v4c-card v4c-ci v4c-ci-${verify.status}`}>
        {verify.status === "passed" ? <CheckCircle2 size={18} /> : verify.status === "failed" ? <XCircle size={18} /> : <CircleDashed size={18} />}
        <span>{verify.summary}{!current ? " (older commit)" : ""}</span>
        {verify.runUrl ? <a href={verify.runUrl} target="_blank" rel="noreferrer">Logs</a> : null}
      </div>
      {verify.status === "failed" ? <p className="v4c-hint">Failed attempts: {verify.attempt} of {set.maxAttempts}. The agent fixes and re-runs up to {set.maxAttempts} times.</p> : null}
      {verify.previewUrl ? <a className="el-btn v4c-preview" href={verify.previewUrl} target="_blank" rel="noreferrer">Open preview <ExternalLink size={15} /></a> : null}
      {(verify.failures || []).map((failure, index) => <pre key={index} className="v4c-log el-card">{failure}</pre>)}
    </>}
  </div>;
}

function AgentTab({ hidden, conversationId, repo, handle, onConversation, onTurnDone, onBusy }: { hidden: boolean; conversationId: string | null; repo?: string; handle: React.MutableRefObject<{ send: (text: string) => void } | null>; onConversation: (id: string) => void; onTurnDone: () => void; onBusy: (busy: boolean) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef<string | null>(null);

  const loadThread = useCallback(async (id: string) => {
    const data = await api<{ messages: StoredMessage[]; approvals: Approval[] }>(`/api/assistant/conversations/${encodeURIComponent(id)}`).catch(() => null);
    if (!data) return;
    loadedRef.current = id;
    setMessages(data.messages.map(fromStored).filter((item): item is Msg => Boolean(item)));
    setApprovals(data.approvals);
  }, []);
  useEffect(() => { if (conversationId && conversationId !== loadedRef.current && !busy) void loadThread(conversationId); }, [conversationId, busy, loadThread]);
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, hidden]);

  const patchLast = (fn: (message: Msg) => Msg) => setMessages((current) => current.map((message, index) => index === current.length - 1 ? fn(message) : message));
  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput(""); setBusy(true); onBusy(true);
    setMessages((current) => [...current, { key: `u${Date.now()}`, role: "user", content: text, cards: [], approvalIds: [] }, { key: `a${Date.now()}`, role: "assistant", content: "", cards: [], approvalIds: [], status: "streaming", statusLine: "Thinking…" }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamCode({ text, conversationId: conversationId || undefined, repo }, (event) => {
        if (event.type === "conversation") { loadedRef.current = event.conversationId; onConversation(event.conversationId); }
        else if (event.type === "status") patchLast((message) => ({ ...message, statusLine: event.label }));
        else if (event.type === "delta") patchLast((message) => ({ ...message, content: message.content + event.text }));
        else if (event.type === "reset") patchLast((message) => ({ ...message, content: "" }));
        else if (event.type === "card") patchLast((message) => ({ ...message, cards: [...message.cards.filter((card) => card.kind !== event.card.kind), event.card] }));
        else if (event.type === "approval") { setApprovals((current) => [...current.filter((item) => item.id !== event.approval.id), event.approval]); patchLast((message) => ({ ...message, approvalIds: [...message.approvalIds, event.approval.id] })); }
        else if (event.type === "done") patchLast((message) => ({ ...message, content: event.result.reply, status: undefined }));
        else if (event.type === "error") patchLast((message) => ({ ...message, content: event.message, status: "error" }));
      }, controller.signal);
    } catch (error) {
      if ((error as Error).name !== "AbortError") patchLast((message) => ({ ...message, content: (error as Error).message, status: "error" }));
    } finally {
      patchLast((message) => message.status === "streaming" ? { ...message, status: undefined } : message);
      setBusy(false); onBusy(false); abortRef.current = null; onTurnDone();
    }
  }
  handle.current = { send: (text) => void send(text) };

  async function decide(approval: Approval, decision: "approve" | "decline", edits?: Record<string, unknown>) {
    setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, status: decision === "approve" ? "running" : "declined" } : item));
    try { await api(`/api/assistant/approvals/${approval.id}`, { method: "POST", body: JSON.stringify({ decision, edits, timezone: userTimezone() }) }); }
    catch (error) { setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, status: "pending" } : item)); window.alert((error as Error).message); }
    if (conversationId) await loadThread(conversationId);
    onTurnDone();
  }
  const byId = new Map(approvals.map((item) => [item.id, item]));

  return <div className="v4c-agent" hidden={hidden}>
    <div className="v4c-thread" ref={threadRef} aria-live="polite">
      {!messages.length ? <div className="v4c-empty"><p>{repo ? `Tell me what to change in ${repo.split("/")[1]}.` : "Pick a repo, then tell me what to build or fix."}</p><p className="v4c-hint">I read the code, edit on an elias/ branch, run CI and show you the diff. PRs and merges wait for your OK.</p></div> : null}
      {messages.map((message) => message.role === "user"
        ? <div key={message.key} className="el-row user"><div className="el-bubble user">{message.content}</div></div>
        : <div key={message.key} className="el-row assistant">
          {message.status === "error" ? <div className="el-notice warn"><AlertCircle size={16} /><span>{message.content}</span></div>
            : message.content ? <div className="el-bubble assistant"><MarkdownMessage content={message.content} /></div> : null}
          {message.status === "streaming" ? <div className="el-typing" role="status"><span className="el-dots" aria-hidden="true"><i /><i /><i /></span>{message.statusLine}</div> : null}
          {message.cards.map((card, index) => <MessageCard key={`${card.kind}-${index}`} card={card} />)}
          {message.approvalIds.map((id) => byId.get(id)).filter((item): item is Approval => Boolean(item)).map((approval) => <ApprovalCard key={approval.id} approval={approval} onDecide={(decision, edits) => decide(approval, decision, edits)} />)}
        </div>)}
    </div>
    <form className="el-composer v4c-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <div className="el-composer-box">
        <textarea value={input} rows={1} maxLength={12000} placeholder={repo ? "Describe a change" : "Pick a repo first"} aria-label="Message the coding agent" enterKeyHint="send" onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { event.preventDefault(); void send(); } }} />
        {busy ? <button type="button" className="el-send stop" onClick={() => abortRef.current?.abort()} aria-label="Stop"><Square size={15} fill="currentColor" /></button>
          : <button type="submit" className="el-send" disabled={!input.trim()} aria-label="Send"><ArrowUp size={20} strokeWidth={2.2} /></button>}
      </div>
    </form>
  </div>;
}
