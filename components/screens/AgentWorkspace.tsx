"use client";

import JSZip from "jszip";
import Link from "next/link";
import {
  Archive,
  Camera,
  FileCode2,
  FilePlus2,
  LoaderCircle,
  Mic,
  Search,
  Send,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  getProject,
  getProjectFiles,
  makeId,
  saveArtifact,
  saveProject,
  syncProjectFiles,
  type ProjectFileRecord,
} from "@/lib/persistence";

type FileItem = ProjectFileRecord;
type ToolResult = {
  type: string;
  path?: string;
  query?: string;
  url?: string;
  content?: string;
  result?: unknown;
  error?: string;
};

function inferTask(value: string): "code" | "research" | "study" | "general" {
  const text = value.toLowerCase();
  if (/research|latest|today|current|news|search the web|source/.test(text)) return "research";
  if (/study|exam|notes|flashcard|pdf|chapter|document/.test(text)) return "study";
  if (/build|code|bug|debug|tsx|jsx|html|css|typescript|javascript|repository|github|refactor|implement/.test(text)) return "code";
  return "general";
}

function mergeFiles(oldFiles: FileItem[], additions: FileItem[]) {
  const map = new Map(oldFiles.map((file) => [file.path, file]));
  additions.forEach((file) => map.set(file.path, file));
  return [...map.values()];
}

export default function AgentWorkspace({ initialProjectId }: { initialProjectId?: string }) {
  const [projectId] = useState(() => {
    if (typeof window === "undefined") return initialProjectId || "project_current";
    const params = new URLSearchParams(window.location.search);
    return initialProjectId || params.get("project") || "project_current";
  });

  const [projectName, setProjectName] = useState("New coding workspace");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("ready");

  const workspaceRef = useRef<FileItem[]>([]);
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    workspaceRef.current = files;
  }, [files]);

  useEffect(() => {
    void hydrate();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !files.length) return;
    const timer = window.setTimeout(async () => {
      await syncProjectFiles(projectId, files);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [files, projectId]);

  async function hydrate() {
    try {
      const existing = await getProject(projectId);
      if (existing) setProjectName(existing.name);
      else {
        const project = {
          id: projectId,
          name: "New coding workspace",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveProject(project);
      }

      const storedFiles = await getProjectFiles(projectId);
      if (storedFiles.length) {
        setFiles(storedFiles);
        setActive(storedFiles[0].path);
      } else {
        const starter: FileItem[] = [
          {
            key: `${projectId}:README.md`,
            projectId,
            path: "README.md",
            content:
              "# New ELIAS workspace\n\nImport a project ZIP or add files, then ask ELIAS to build something.",
            updatedAt: Date.now(),
          },
        ];
        setFiles(starter);
        setActive("README.md");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "storage unavailable");
    }
  }

  const current = files.find((file) => file.path === active) ?? files[0];
  const visible = useMemo(
    () =>
      files.filter((file) =>
        file.path.toLowerCase().includes(query.toLowerCase()),
      ),
    [files, query],
  );

  async function addZip(file: File) {
    const zip = await JSZip.loadAsync(file);
    const additions: FileItem[] = [];

    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (path.includes("/.git/") || path.startsWith(".git/")) continue;

      try {
        const content = await entry.async("string");
        additions.push({
          key: `${projectId}:${path}`,
          projectId,
          path,
          content,
          updatedAt: Date.now(),
        });
      } catch {
        // Skip binary assets in the editable text workspace.
      }
    }

    if (!additions.length) {
      setStatus("no editable text files found in ZIP");
      return;
    }

    const next = mergeFiles(workspaceRef.current, additions);
    setFiles(next);
    setActive(additions[0].path);
    setStatus(`${additions.length} files imported`);
  }

  async function addLoose(list: FileList | null) {
    if (!list) return;

    const additions: FileItem[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 15_000_000) continue;
      try {
        additions.push({
          key: `${projectId}:${file.webkitRelativePath || file.name}`,
          projectId,
          path: file.webkitRelativePath || file.name,
          content: await file.text(),
          updatedAt: Date.now(),
        });
      } catch {
        // Ignore unreadable/binary files in this editor.
      }
    }

    if (additions.length) {
      const next = mergeFiles(workspaceRef.current, additions);
      setFiles(next);
      setActive(additions[0].path);
      setStatus(`${additions.length} files added`);
    }
  }

  function applyActions(actions: Array<Record<string, unknown>>) {
    setFiles((currentFiles) => {
      let next = [...currentFiles];

      for (const action of actions) {
        const type = String(action.type ?? "");

        if (type === "write_file" && typeof action.path === "string") {
          const path = action.path;
          const content = String(action.content ?? "");
          const item: FileItem = {
            key: `${projectId}:${path}`,
            projectId,
            path,
            content,
            updatedAt: Date.now(),
          };
          const index = next.findIndex((file) => file.path === path);
          if (index >= 0) next[index] = item;
          else next.push(item);
          setActive(path);
        }

        if (type === "append_file" && typeof action.path === "string") {
          const index = next.findIndex((file) => file.path === action.path);
          if (index >= 0) {
            next[index] = {
              ...next[index],
              content:
                next[index].content + String(action.content ?? ""),
              updatedAt: Date.now(),
            };
          }
        }

        if (type === "delete_file" && typeof action.path === "string") {
          next = next.filter((file) => file.path !== action.path);
          if (active === action.path) {
            setActive(next[0]?.path || "");
          }
        }

        if (
          type === "rename_file" &&
          typeof action.path === "string" &&
          typeof action.to === "string"
        ) {
          next = next.map((file) =>
            file.path === action.path
              ? {
                  ...file,
                  key: `${projectId}:${action.to}`,
                  path: action.to as string,
                  updatedAt: Date.now(),
                }
              : file,
          );
          if (active === action.path) setActive(action.to as string);
        }
      }

      return next;
    });
  }

  async function run() {
    const prompt = task.trim();
    if (!prompt || busy) return;

    setTask("");
    setBusy(true);
    setStatus("starting");

    setMessages((current) => [
      ...current,
      { role: "user", text: prompt },
    ]);

    const conversation: { role: string; content: string }[] = [
      { role: "user", content: prompt },
    ];
    let toolResults: ToolResult[] = [];

    try {
      for (let step = 1; step <= 12; step += 1) {
        setStatus(`working · ${step}/12`);

        const snapshot = workspaceRef.current;

        const response = await fetch("/api/agent/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: prompt,
            taskType: inferTask(prompt),
            files: snapshot.map((file) => ({
              path: file.path,
              content: file.content,
            })),
            messages: conversation,
            toolResults,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "ELIAS agent step failed.");
        }

        if (data.message) {
          setMessages((current) => [
            ...current,
            { role: "assistant", text: data.message },
          ]);
          conversation.push({
            role: "assistant",
            content: data.message,
          });
        }

        const results: ToolResult[] = [];

        for (const request of data.requests || []) {
          if (request.type === "read_file" && request.path) {
            const file = workspaceRef.current.find(
              (item) => item.path === request.path,
            );
            results.push(
              file
                ? { type: "read_file", path: request.path, content: file.content }
                : {
                    type: "read_file",
                    path: request.path,
                    error: "file not found",
                  },
            );
          }

          if (request.type === "search_web" && request.query) {
            const searchResponse = await fetch("/api/web/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: request.query }),
            });
            results.push({
              type: "search_web",
              query: request.query,
              result: await searchResponse.json(),
            });
          }

          if (request.type === "get_url" && request.url) {
            const urlResponse = await fetch("/api/web/open", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: request.url }),
            });
            results.push({
              type: "get_url",
              url: request.url,
              result: await urlResponse.json(),
            });
          }
        }

        if (Array.isArray(data.actions) && data.actions.length) {
          applyActions(data.actions);
        }

        toolResults = [...toolResults, ...results];

        if (results.length) {
          conversation.push({
            role: "tool",
            content: JSON.stringify(results).slice(0, 100_000),
          });
        }

        if (Array.isArray(data.actions) && data.actions.length) {
          conversation.push({
            role: "tool",
            content: `Applied ${data.actions.length} workspace action(s): ${JSON.stringify(
              data.actions,
            ).slice(0, 20_000)}`,
          });
        }

        if (data.done) {
          setStatus("completed");
          break;
        }
      }
    } catch (error) {
      setStatus("error");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "ELIAS could not complete the task.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip() {
    const zip = new JSZip();

    workspaceRef.current.forEach((file) => {
      zip.file(file.path, file.content);
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const artifactId = makeId("artifact");

    await saveArtifact({
      id: artifactId,
      projectId,
      name: `${projectName || "elias-project"}.zip`,
      type: "application/zip",
      createdAt: Date.now(),
      blob,
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName || "elias-project"}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);

    setStatus("ZIP exported");
  }

  return (
    <AppShell title={projectName}>
      <main className="screen agent-workspace">
        <div className="agent-head">
          <div>
            <p className="eyebrow">ELIAS / autonomous workspace</p>
            <h1>{projectName}</h1>
            <span className="agent-subtitle">
              code, research, inspect, modify and package.
            </span>
          </div>
          <span className={`agent-state ${status}`}>
            {busy ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}
            {status}
          </span>
        </div>

        <div className="workspace-toolbar">
          <button onClick={() => zipInput.current?.click()}>
            <Archive size={14} />
            import ZIP
          </button>
          <button onClick={() => filesInput.current?.click()}>
            <Upload size={14} />
            add files
          </button>
          <button onClick={() => cameraInput.current?.click()}>
            <Camera size={14} />
            photo
          </button>
          <button onClick={() => void downloadZip()}>
            <Archive size={14} />
            export ZIP
          </button>
          <Link href="/chat">
            <Mic size={14} />
            chat
          </Link>

          <input
            ref={zipInput}
            hidden
            type="file"
            accept=".zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addZip(file);
            }}
          />
          <input
            ref={filesInput}
            hidden
            type="file"
            multiple
            onChange={(event) => void addLoose(event.target.files)}
          />
          <input
            ref={cameraInput}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setMessages((current) => [
                ...current,
                {
                  role: "assistant",
                  text: `received ${file.name}. image analysis will use a vision-capable route when configured.`,
                },
              ]);
            }}
          />
        </div>

        <div className="workspace">
          <aside className="workspace-files">
            <div className="workspace-pane-title">
              <span>files · {files.length}</span>
              <button onClick={() => filesInput.current?.click()}>
                <FilePlus2 size={14} />
              </button>
            </div>

            <div className="file-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="find file"
              />
            </div>

            <div className="file-tree">
              {visible.map((file) => (
                <button
                  key={file.key}
                  className={file.path === active ? "selected" : ""}
                  onClick={() => setActive(file.path)}
                >
                  <FileCode2 size={13} />
                  <span>{file.path}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="workspace-editor">
            <div className="editor-top">
              <span>{current?.path || "no file selected"}</span>
              <span>{current?.content.length || 0} chars</span>
            </div>
            <textarea
              spellCheck={false}
              value={current?.content || ""}
              onChange={(event) => {
                if (!current) return;
                setFiles((old) =>
                  old.map((file) =>
                    file.path === current.path
                      ? { ...file, content: event.target.value, updatedAt: Date.now() }
                      : file,
                  ),
                );
              }}
            />
          </section>

          <aside className="workspace-agent">
            <div className="workspace-pane-title">
              <span>
                <Sparkles size={14} />
                ELIAS
              </span>
              <span className="tiny-live">multi-model</span>
            </div>

            <div className="agent-log">
              {messages.length ? (
                messages.map((message, index) => (
                  <div className={`log ${message.role}`} key={index}>
                    <small>{message.role === "assistant" ? "ELIAS" : "YOU"}</small>
                    <p>{message.text}</p>
                  </div>
                ))
              ) : (
                <div className="agent-empty">
                  <Sparkles size={24} />
                  <b>give ELIAS a real task</b>
                  <small>
                    Import your codebase, then ask it to inspect, research, edit
                    and iterate.
                  </small>
                </div>
              )}
            </div>

            <div className="agent-input">
              <textarea
                rows={3}
                value={task}
                onChange={(event) => setTask(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void run();
                  }
                }}
                placeholder="e.g. refactor the auth flow across the whole project..."
              />

              <div>
                <button
                  title="upload photo"
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera size={15} />
                </button>
                <button
                  title="voice"
                  onClick={() => {
                    window.location.href = "/studio";
                  }}
                >
                  <Mic size={15} />
                </button>
                <button
                  className="agent-send"
                  disabled={busy}
                  onClick={() => void run()}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
