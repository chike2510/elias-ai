"use client";

import JSZip from "jszip";
import Link from "next/link";
import { Archive, Camera, FileCode2, FilePlus2, Folder, GitCommitHorizontal, Github, Globe2, Link2, ListChecks, LoaderCircle, Mic, Search, Send, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { readApiResponse } from "@/lib/clientApi";
import { getProject, getProjectFiles, makeId, saveArtifact, saveProject, syncProjectFiles, type ProjectFileRecord } from "@/lib/persistence";
import type { AgentAction, AgentRequest, ToolResult } from "@/lib/types";

type FileItem = ProjectFileRecord;
type LogItem = { role: "user" | "assistant" | "tool" | "error"; text: string };

function inferTask(value: string): "code" | "research" | "study" | "general" {
  const text = value.toLowerCase();
  if (/research|latest|today|current|news|search the web|source/.test(text)) return "research";
  if (/study|exam|notes|flashcard|pdf|chapter|document/.test(text)) return "study";
  if (/build|code|bug|debug|tsx|jsx|html|css|typescript|javascript|repository|github|refactor|implement/.test(text)) return "code";
  return "general";
}

function safePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

function mergeFiles(oldFiles: FileItem[], additions: FileItem[]) {
  const map = new Map(oldFiles.map((file) => [file.path, file]));
  additions.forEach((file) => map.set(file.path, file));
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export default function AgentWorkspace({ initialProjectId }: { initialProjectId?: string }) {
  const [projectId] = useState(() => {
    if (typeof window === "undefined") return initialProjectId || "project_current";
    const params = new URLSearchParams(window.location.search);
    return initialProjectId || params.get("project") || "project_current";
  });
  const [sourceTaskId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("task") || "");
  const [projectName, setProjectName] = useState("New coding workspace");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("");
  const [messages, setMessages] = useState<LogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("ready");
  const [activePane, setActivePane] = useState<"files" | "preview" | "agent">("files");
  const [githubCommitOpen, setGithubCommitOpen] = useState(false);
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubCommitMessage, setGithubCommitMessage] = useState("Update from Elias");
  const [githubCommitBusy, setGithubCommitBusy] = useState(false);
  const [githubCommitError, setGithubCommitError] = useState("");
  const workspaceRef = useRef<FileItem[]>([]);
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => { workspaceRef.current = files; }, [files]);
    useEffect(() => {
    void hydrate();
  }, [projectId, sourceTaskId]);
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setTimeout(() => { void syncProjectFiles(projectId, files); }, 500);
    return () => window.clearTimeout(timer);
  }, [files, projectId]);

  async function hydrate() {
    try {
      if (sourceTaskId) {
        const data = await readApiResponse<{ task: { title: string; workspace: FileItem[]; objective: string } }>(await fetch(`/api/tasks/${encodeURIComponent(sourceTaskId)}`, { cache: "no-store" }));
        const imported = data.task.workspace.map((file) => ({ ...file, key: `${projectId}:${file.path}`, projectId, updatedAt: Date.now() }));
        if (imported.length) {
          setProjectName(data.task.title);
          setFiles(imported);
          setActive(imported[0].path);
          setTask(data.task.objective);
          setStatus("task workspace loaded");
          return;
        }
      }
      const existing = await getProject(projectId);
      if (existing) setProjectName(existing.name);
      else await saveProject({ id: projectId, name: projectName, createdAt: Date.now(), updatedAt: Date.now() });
      const storedFiles = await getProjectFiles(projectId);
      const starter = storedFiles.length ? storedFiles : [{ key: `${projectId}:README.md`, projectId, path: "README.md", content: "# New ELIAS workspace\n\nImport a project ZIP or add files, then ask ELIAS to build something.", updatedAt: Date.now() }];
      setFiles(starter);
      setActive(starter[0].path);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "storage unavailable");
    }
  }

  const current = files.find((file) => file.path === active) ?? files[0];
  const visible = useMemo(() => files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())), [files, query]);

  async function addZip(file: File) {
    try {
      const zip = await JSZip.loadAsync(file);
      const additions: FileItem[] = [];
      for (const [rawPath, entry] of Object.entries(zip.files)) {
        if (entry.dir || rawPath.includes("/.git/") || rawPath.startsWith(".git/")) continue;
        const path = safePath(rawPath);
        if (!path || path.length > 240) continue;
        try {
          const content = await entry.async("string");
          if (content.includes("\u0000")) continue;
          additions.push({ key: `${projectId}:${path}`, projectId, path, content, updatedAt: Date.now() });
        } catch { /* binary entry */ }
      }
      if (!additions.length) { setStatus("no editable text files found in ZIP"); return; }
      setFiles((old) => mergeFiles(old, additions));
      setActive(additions[0].path);
      setStatus(`${additions.length} files imported`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ZIP import failed");
    }
  }

  async function addLoose(list: FileList | null) {
    if (!list) return;
    const additions: FileItem[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 15_000_000) continue;
      const path = safePath(file.webkitRelativePath || file.name);
      if (!path) continue;
      try { additions.push({ key: `${projectId}:${path}`, projectId, path, content: await file.text(), updatedAt: Date.now() }); } catch { /* unreadable */ }
    }
    if (additions.length) { setFiles((old) => mergeFiles(old, additions)); setActive(additions[0].path); setStatus(`${additions.length} files added`); }
  }

  function applyActions(actions: AgentAction[]) {
    setFiles((oldFiles) => {
      let next = [...oldFiles];
      for (const action of actions) {
        const path = safePath(action.path);
        if (!path) continue;
        if (action.type === "write_file" && typeof action.content === "string") {
          const item = { key: `${projectId}:${path}`, projectId, path, content: action.content, updatedAt: Date.now() };
          const index = next.findIndex((file) => file.path === path);
          if (index >= 0) next[index] = item; else next.push(item);
          setActive(path);
        }
        if (action.type === "append_file" && typeof action.content === "string") {
          const index = next.findIndex((file) => file.path === path);
          if (index >= 0) next[index] = { ...next[index], content: next[index].content + action.content, updatedAt: Date.now() };
        }
        if (action.type === "edit_file") {
          const index = next.findIndex((file) => file.path === path);
          if (index >= 0 && action.find) {
            const replacement = action.all ? next[index].content.split(action.find).join(action.replace) : next[index].content.replace(action.find, action.replace);
            next[index] = { ...next[index], content: replacement, updatedAt: Date.now() };
            setActive(path);
          }
        }
        if (action.type === "delete_file") { next = next.filter((file) => file.path !== path); if (active === path) setActive(next[0]?.path || ""); }
        if (action.type === "rename_file") {
          const to = safePath(action.to);
          if (!to) continue;
          next = next.map((file) => file.path === path ? { ...file, key: `${projectId}:${to}`, path: to, updatedAt: Date.now() } : file);
          if (active === path) setActive(to);
        }
      }
      return next.sort((a, b) => a.path.localeCompare(b.path));
    });
  }

  async function executeRequest(request: AgentRequest): Promise<ToolResult> {
    const startedAt = Date.now();
    if (request.type === "inspect_project") return { type: request.type, result: { projectId, projectName, fileCount: workspaceRef.current.length, totalChars: workspaceRef.current.reduce((sum, file) => sum + file.content.length, 0) }, startedAt, completedAt: Date.now() };
    if (request.type === "list_files") return { type: request.type, result: workspaceRef.current.filter((file) => !request.prefix || file.path.startsWith(request.prefix)).map((file) => file.path), startedAt, completedAt: Date.now() };
    if (request.type === "read_file") {
      const path = safePath(request.path);
      const file = path ? workspaceRef.current.find((item) => item.path === path) : undefined;
      return { type: request.type, path: request.path, content: file?.content, error: file ? undefined : "file not found", startedAt, completedAt: Date.now() };
    }
    if (request.type === "search_files") {
      const needle = request.query.toLowerCase();
      return { type: request.type, query: request.query, result: workspaceRef.current.filter((file) => file.content.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle)).map((file) => file.path), startedAt, completedAt: Date.now() };
    }
    if (request.type === "inspect_dependencies") {
      const pkg = workspaceRef.current.find((file) => file.path === "package.json");
      return { type: request.type, result: pkg ? pkg.content.slice(0, 40_000) : "package.json not found", startedAt, completedAt: Date.now() };
    }
    if (request.type === "search_web") {
      const result = await readApiResponse<{ results?: unknown }>(await fetch("/api/web/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: request.query }) }));
      return { type: request.type, query: request.query, result, startedAt, completedAt: Date.now() };
    }
    if (request.type === "fetch_url") {
      const result = await readApiResponse<{ url?: string; content?: string }>(await fetch("/api/web/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: request.url }) }));
      return { type: request.type, url: request.url, result, startedAt, completedAt: Date.now() };
    }
    if (request.type !== "create_artifact") {
      return { type: request.type, error: "Unsupported tool request.", startedAt, completedAt: Date.now() };
    }
    const artifactId = makeId("artifact");
    await saveArtifact({ id: artifactId, projectId, name: request.name, type: request.mimeType || "text/plain", createdAt: Date.now(), text: request.content });
    return { type: request.type, result: { artifactId, name: request.name }, startedAt, completedAt: Date.now() };
  }

  async function run() {
    const prompt = task.trim();
    if (!prompt || busy) return;
    setTask(""); setBusy(true); setStatus("starting"); setMessages((current) => [...current, { role: "user", text: prompt }]);
    const conversation: { role: string; content: string }[] = [{ role: "user", content: prompt }];
    let toolResults: ToolResult[] = [];
    try {
      for (let step = 1; step <= 12; step += 1) {
        setStatus(`working · ${step}/12`);
        const data = await readApiResponse<{ message?: string; requests?: AgentRequest[]; actions?: AgentAction[]; done?: boolean; provider?: string; model?: string }>(await fetch("/api/agent/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: prompt, taskType: inferTask(prompt), files: workspaceRef.current.map(({ path, content }) => ({ path, content })), messages: conversation, toolResults }) }));
        if (data.message) { setMessages((current) => [...current, { role: "assistant", text: `${data.message}${data.provider ? ` · ${data.provider}/${data.model || "model"}` : ""}` }]); conversation.push({ role: "assistant", content: data.message }); }
        const results: ToolResult[] = [];
        for (const request of data.requests || []) {
          setMessages((current) => [...current, { role: "tool", text: `${request.type}${"path" in request && request.path ? ` · ${request.path}` : ""}` }]);
          try { results.push(await executeRequest(request)); } catch (error) { results.push({ type: request.type, error: error instanceof Error ? error.message : "tool failed", completedAt: Date.now() }); }
        }
        if (data.actions?.length) { applyActions(data.actions); setMessages((current) => [...current, { role: "tool", text: `applied ${data.actions?.length} file action(s)` }]); }
        toolResults = [...toolResults, ...results];
        if (results.length) conversation.push({ role: "tool", content: JSON.stringify(results).slice(0, 100_000) });
        if (data.actions?.length) conversation.push({ role: "tool", content: `Applied actions: ${JSON.stringify(data.actions).slice(0, 20_000)}` });
        if (data.done) { setStatus("completed"); break; }
      }
    } catch (error) {
      setStatus("error"); setMessages((current) => [...current, { role: "error", text: error instanceof Error ? error.message : "ELIAS could not complete the task." }]);
    } finally { setBusy(false); }
  }

  async function openTaskWorkspace() {
    const prompt = task.trim() || "Inspect this project, identify the highest-value engineering improvements, and implement the safest changes with validation evidence.";
    try {
      setStatus("creating task");
      const data = await readApiResponse<{ task: { id: string } }>(await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: prompt, kind: "code", taskType: "code", projectId, workspace: workspaceRef.current.map(({ path, content }) => ({ path, content })) }),
      }));
      window.location.href = `/chat?prompt=${encodeURIComponent(prompt)}`;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create task");
    }
  }

  async function commitWorkspaceToGitHub() {
    const target = githubRepo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
    const [owner, repo] = target.split("/");
    if (!owner || !repo || target.split("/").length !== 2) { setGithubCommitError("Enter a repository as owner/name or a GitHub repository URL."); return; }
    if (!workspaceRef.current.length) { setGithubCommitError("Add at least one workspace file before committing."); return; }
    setGithubCommitBusy(true); setGithubCommitError(""); setStatus("preparing GitHub approval");
    const payload = { action: "commit_files", owner, repo, branch: githubBranch.trim() || "main", message: githubCommitMessage.trim() || "Update from Elias", files: workspaceRef.current.map(({ path, content }) => ({ path, content })) };
    try {
      const proposal = await readApiResponse<{ proposalId: string; expiresAt: number }>(await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, phase: "prepare" }) }));
      const approved = window.confirm(`Approve this real GitHub write?\n\nRepository: ${owner}/${repo}\nBranch: ${payload.branch}\nFiles: ${payload.files.length}\nCommit message: ${payload.message}\n\nThe approval expires in ${Math.max(1, Math.ceil((proposal.expiresAt - Date.now()) / 60_000))} minutes and is bound to these exact file contents.`);
      if (!approved) { setStatus("GitHub commit not approved"); return; }
      setStatus("committing to GitHub");
      const result = await readApiResponse<{ message?: string; commitSha?: string; url?: string }>(await fetch("/api/github/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, phase: "execute", proposalId: proposal.proposalId, confirm: "CONFIRM_GITHUB_COMMIT_FILES" }) }));
      setMessages((current) => [...current, { role: "tool", text: result.url ? `${result.message || "GitHub commit completed."} ${result.url}` : result.message || `Committed ${workspaceRef.current.length} files to ${owner}/${repo}.` }]);
      setStatus("committed to GitHub"); setGithubCommitOpen(false);
    } catch (error) { setGithubCommitError(error instanceof Error ? error.message : "GitHub commit failed."); setStatus("GitHub commit failed"); }
    finally { setGithubCommitBusy(false); }
  }

  async function downloadZip() {
    const zip = new JSZip();
    workspaceRef.current.forEach((file) => zip.file(file.path, file.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const name = `${projectName || "elias-project"}.zip`;
    await saveArtifact({ id: makeId("artifact"), projectId, name, type: "application/zip", createdAt: Date.now(), blob });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
    setStatus("ZIP exported");
  }

  const activity = messages.slice(-4);

  return (
    <AppShell title={projectName}>
      <main className="screen agent-workspace workspace-destination agent-workbench">
        <header className="screen-header agent-head">
          <div className="screen-header-copy">
            <span className="eyebrow">CODE WORKSPACE</span>
            <h1>{projectName}</h1>
            <p className="screen-description">Inspect, understand, change, and verify a project with Elias.</p>
          </div>
          <span className={`agent-state ${busy ? "working" : "ready"}`}><Sparkles size={13} /> {busy ? "working" : "ready"}</span>
        </header>

        <section className="agent-objective panel quiet-card">
          <div className="agent-objective-top">
            <div className="agent-objective-label"><Sparkles size={15} /> <span>What should Elias do?</span></div>
            <span className="agent-mode-chip"><Sparkles size={12} /> multi-model</span>
          </div>
          <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={3} placeholder="Review this project, fix the highest-risk issue, and show me the diff." />
          <div className="agent-objective-footer">
            <span className="agent-context-chip"><Folder size={14} /> {projectName} · {files.length} files</span>
            <div className="agent-objective-actions">
              <Link href="/projects" className="agent-secondary-action"><Link2 size={14} /> Connect project</Link>
              <button type="button" className="primary agent-start-button" disabled={busy || !task.trim()} onClick={() => void run()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}{busy ? "Working…" : "Start task"}</button>
            </div>
          </div>
        </section>

        <section className="agent-workbench-card quiet-card" aria-label="Project workbench">
          <nav className="agent-workbench-tabs" aria-label="Workbench views">
            <button type="button" className={activePane === "files" ? "active" : ""} onClick={() => setActivePane("files")}><FileCode2 size={15} /> Files</button>
            <button type="button" className={activePane === "preview" ? "active" : ""} onClick={() => setActivePane("preview")}><Globe2 size={15} /> Preview</button>
            <button type="button" className={activePane === "agent" ? "active" : ""} onClick={() => setActivePane("agent")}><Sparkles size={15} /> Agent</button>
          </nav>
          <div className="agent-workbench-body" data-pane={activePane}>
            <section className="agent-files-panel" data-panel="files">
              <div className="agent-panel-heading"><span>Files <small>· {files.length}</small></span><button type="button" aria-label="Add files" onClick={() => filesInput.current?.click()}><FilePlus2 size={14} /></button></div>
              <div className="agent-file-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a file" /></div>
              <div className="agent-file-list">{visible.map((file) => <button type="button" key={file.key} className={file.path === active ? "selected" : ""} onClick={() => { setActive(file.path); setActivePane("files"); }}><FileCode2 size={14} /><span>{file.path}</span><small>{file.content.length > 1000 ? `${Math.round(file.content.length / 1000)}k` : `${file.content.length}b`}</small></button>)}</div>
              {!visible.length ? <div className="agent-panel-empty"><Search size={20} /><span>No matching files.</span></div> : null}
            </section>

            <section className="agent-editor-panel" data-panel="preview">
              <div className="agent-editor-heading"><span><FileCode2 size={14} /> {current?.path || "No file selected"}</span><span>{current?.content.length || 0} chars</span></div>
              <div className="agent-editor-view" data-view="editor"><textarea spellCheck={false} value={current?.content || ""} onChange={(event) => { if (!current) return; setFiles((old) => old.map((file) => file.path === current.path ? { ...file, content: event.target.value, updatedAt: Date.now() } : file)); }} /></div>
              <div className="agent-preview-view" data-view="preview"><div className="agent-preview-label">Read-only preview</div><pre>{current?.content || "Select a file to preview it."}</pre></div>
              <button type="button" className="agent-editor-link" onClick={() => setActivePane("files")}>Open full editor <span>↗</span></button>
            </section>

            <section className="agent-agent-panel" data-panel="agent">
              <div className="agent-panel-heading"><span><Sparkles size={14} /> Agent activity</span><span className="tiny-live">{messages.length ? `${messages.length} events` : "ready"}</span></div>
              <div className="agent-log">{activity.length ? activity.map((message, index) => <div className={`log ${message.role}`} key={`${message.role}-${index}`}><small>{message.role === "assistant" ? "ELIAS" : message.role === "tool" ? "TOOL" : message.role === "error" ? "ERROR" : "YOU"}</small><p>{message.text}</p></div>) : <div className="agent-empty"><Sparkles size={24} /><b>Give Elias a real task</b><small>Import your codebase, then ask Elias to inspect, research, edit, and iterate.</small></div>}</div>
              <div className="agent-input"><textarea rows={2} value={task} onChange={(event) => setTask(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void run(); } }} placeholder="Ask Elias about this project…" /><div><Link href="/studio?mode=voice" aria-label="Voice"><Mic size={15} /></Link><button type="button" className="agent-send" disabled={busy || !task.trim()} onClick={() => void run()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}</button></div></div>
            </section>
          </div>
        </section>

        <section className="agent-progress-strip"><span><ListChecks size={14} /> {busy ? "Agent activity" : "Plan"}</span><small>{files.length} workspace files · {status}</small><span className={`agent-progress-dot ${busy ? "working" : ""}`} /></section>

        {githubCommitOpen ? <section className="agent-github-commit panel" aria-label="Commit workspace to GitHub"><div className="agent-github-commit-head"><div><span className="eyebrow">GITHUB WRITE</span><strong><Github size={15} /> Commit workspace changes</strong></div><button type="button" className="icon-btn" aria-label="Close GitHub commit form" onClick={() => { setGithubCommitOpen(false); setGithubCommitError(""); }}>×</button></div><p>Send the current {files.length} workspace file{files.length === 1 ? "" : "s"} to a connected repository. Elias will show a final confirmation before GitHub changes.</p><div className="agent-github-commit-fields"><label>Repository<input value={githubRepo} onChange={(event) => setGithubRepo(event.target.value)} placeholder="owner/repository" /></label><label>Branch<input value={githubBranch} onChange={(event) => setGithubBranch(event.target.value)} placeholder="main" /></label><label>Commit message<input value={githubCommitMessage} onChange={(event) => setGithubCommitMessage(event.target.value)} placeholder="Update from Elias" /></label></div>{githubCommitError ? <p className="connector-help upload-error">{githubCommitError}</p> : null}<div className="agent-github-commit-actions"><button type="button" className="secondary" onClick={() => setGithubCommitOpen(false)}>Cancel</button><button type="button" className="primary" disabled={githubCommitBusy} onClick={() => void commitWorkspaceToGitHub()}>{githubCommitBusy ? <LoaderCircle className="spin" size={14} /> : <GitCommitHorizontal size={14} />}{githubCommitBusy ? "Committing…" : "Review and commit"}</button></div></section> : null}

        <div className="agent-utility-row" aria-label="Workspace actions">
          <button type="button" className="agent-utility-button agent-github-utility" onClick={() => { setGithubCommitOpen(true); setGithubCommitError(""); }}><GitCommitHorizontal size={14} /> Commit to GitHub</button>
          <button type="button" className="agent-utility-button" onClick={() => zipInput.current?.click()}><Archive size={14} /> Import ZIP</button>
          <button type="button" className="agent-utility-button" onClick={() => filesInput.current?.click()}><Upload size={14} /> Add files</button>
          <button type="button" className="agent-utility-button" onClick={() => void downloadZip()}><Archive size={14} /> Export ZIP</button>
          <button type="button" className="agent-utility-button" onClick={() => void openTaskWorkspace()}><Sparkles size={14} /> Open in Chat</button>
          <input ref={zipInput} hidden type="file" accept=".zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addZip(file); event.currentTarget.value = ""; }} />
          <input ref={filesInput} hidden type="file" multiple onChange={(event) => { void addLoose(event.target.files); event.currentTarget.value = ""; }} />
          <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; if (file) setMessages((current) => [...current, { role: "tool", text: `received ${file.name}; image analysis is not configured in this deployment` }]); event.currentTarget.value = ""; }} />
        </div>
      </main>
    </AppShell>
  );
}
