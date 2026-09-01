import { fetchUrl, searchWeb } from "@/lib/webSearch";
import { runWorkspaceValidation } from "@/lib/execution";
import type { AgentAction, AgentRequest, ToolResult, WorkspaceFile } from "@/lib/types";
import type { CreateTaskInput, PermissionLevel, TaskRecord } from "@/lib/task";
import {
  buildPlan,
  createTask,
  inferTaskKind,
  inferTaskType,
} from "@/lib/task";
import {
  createStoredTask,
  createTaskCheckpoint,
  restoreTaskCheckpoint,
  getStoredTask,
  grantTaskPermission,
  recordTaskEvent,
  recordToolResult,
  requestTaskApproval,
  resolveTaskApproval,
  setTaskStatus,
  updateStoredTask,
} from "@/lib/taskStore";
import { runAgentStep } from "@/lib/agent";
import { artifactMime, formatTextArtifact, textToDocx, textToPdf, textToPptx } from "@/lib/artifacts";
import { performBrowserAction } from "@/lib/browser/browserManager";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";

const MAX_STEPS = 12;
const MAX_FILE_CHARS = 1_000_000;

function safePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

function hasPermission(task: TaskRecord, permission: PermissionLevel) {
  return task.permissions.some((item) => item.level === permission && item.granted);
}
function isBrowserRequest(request: AgentRequest): request is Extract<AgentRequest, { type: `browser_${string}` }> {
  return request.type.startsWith("browser_");
}

function repositoryReference(objective: string) {
  const url = objective.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (url) return { owner: url[1], repo: url[2].replace(/\.git$/i, "") };
  const pair = objective.match(/(?:repository|repo)\s+(?:called\s+|named\s+)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  return pair ? { owner: pair[1], repo: pair[2] } : undefined;
}

function referencesRepository(objective: string) {
  return /\b(?:github|repository|repo|codebase|code base)\b/i.test(objective);
}

const TEXT_FILE = /\.(?:md|mdx|txt|json|ya?ml|toml|ini|env(?:\.example)?|js|jsx|ts|tsx|mjs|cjs|css|scss|html|xml|svg|py|rb|go|rs|java|kt|swift|php|sql|sh|bash|zsh|dockerfile|gitignore)$/i;

async function hydrateRepositoryWorkspace(task: TaskRecord) {
  if (task.workspace.length || !referencesRepository(task.objective)) return false;
  const reference = repositoryReference(task.objective);
  if (!reference) throw new Error("This task references a repository, but no GitHub owner/repository was specified. Open the repository workspace and use Ask Elias, or include a URL such as https://github.com/owner/repo.");
  const token = await getGitHubToken(await getSession());
  if (!token) throw new Error(`GitHub is not connected for ${reference.owner}/${reference.repo}. Connect GitHub before asking Elias to analyze a repository.`);
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
  const base = `https://api.github.com/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}`;
  const repoResponse = await fetch(base, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!repoResponse.ok) throw new Error(`GitHub repository lookup failed for ${reference.owner}/${reference.repo} (${repoResponse.status}).`);
  const repo = await repoResponse.json() as { default_branch?: string };
  const branch = repo.default_branch || "main";
  const treeResponse = await fetch(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!treeResponse.ok) throw new Error(`GitHub file tree lookup failed for ${reference.owner}/${reference.repo} (${treeResponse.status}).`);
  const tree = await treeResponse.json() as { truncated?: boolean; tree?: Array<{ path?: string; type?: string; size?: number }> };
  const paths = (tree.tree || []).filter((item) => item.type === "blob" && typeof item.path === "string" && TEXT_FILE.test(item.path) && (item.size || 0) <= 180_000).map((item) => item.path as string);
  const prioritized = paths.sort((left, right) => Number(/(^|\/)(readme|package\.json|tsconfig\.json|next\.config|app|src|lib|components)(\.|\/|$)/i.test(right)) - Number(/(^|\/)(readme|package\.json|tsconfig\.json|next\.config|app|src|lib|components)(\.|\/|$)/i.test(left))).slice(0, 60);
  const files: WorkspaceFile[] = [];
  for (let start = 0; start < prioritized.length; start += 8) {
    const batch = await Promise.all(prioritized.slice(start, start + 8).map(async (path) => {
      const response = await fetch(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return undefined;
      const payload = await response.json() as { type?: string; content?: string; encoding?: string };
      if (payload.type !== "file" || typeof payload.content !== "string") return undefined;
      const content = payload.encoding === "base64" ? Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8") : payload.content;
      return { path, content: content.slice(0, MAX_FILE_CHARS), size: content.length };
    }));
    files.push(...batch.filter((file): file is { path: string; content: string; size: number } => Boolean(file)));
  }
  if (!files.length) throw new Error(`GitHub returned no readable text files for ${reference.owner}/${reference.repo}; refusing to generate a report from an empty workspace.`);
  await updateStoredTask(task.id, (current) => { if (!current.workspace.length) current.workspace = files; });
  await recordTaskEvent(task.id, { kind: "tool", label: "Repository workspace loaded", status: "completed", detail: `Loaded ${files.length} text files from ${reference.owner}/${reference.repo} on ${branch}${tree.truncated ? " (GitHub tree was truncated)" : ""}.`, evidence: { type: "json", value: { repository: `${reference.owner}/${reference.repo}`, branch, fileCount: files.length, paths: files.map((file) => file.path) } } });
  return true;
}

function permissionForRequest(request: AgentRequest): PermissionLevel {
  if (request.type === "search_web" || request.type === "fetch_url") return "network";
  if (request.type === "run_validation") return "execute";
  if (request.type === "create_artifact") return "artifact";
  return "read";
}

function applyAction(task: TaskRecord, action: AgentAction): { path?: string; changed: boolean; detail: string } {
  const path = safePath(action.path);
  if (!path) return { changed: false, detail: "Rejected an unsafe workspace path." };
  const index = task.workspace.findIndex((file) => file.path === path);

  if (action.type === "write_file") {
    if (action.content.length > MAX_FILE_CHARS) return { path, changed: false, detail: "Rejected an oversized file write." };
    const next: WorkspaceFile = { path, content: action.content, size: action.content.length };
    if (index >= 0) task.workspace[index] = next;
    else task.workspace.push(next);
    return { path, changed: true, detail: `Wrote ${path}.` };
  }

  if (action.type === "append_file") {
    if (index < 0) return { path, changed: false, detail: `Cannot append; ${path} does not exist.` };
    const content = task.workspace[index].content + action.content;
    if (content.length > MAX_FILE_CHARS) return { path, changed: false, detail: "Rejected an oversized file append." };
    task.workspace[index] = { ...task.workspace[index], content, size: content.length };
    return { path, changed: true, detail: `Appended ${path}.` };
  }

  if (action.type === "edit_file") {
    if (index < 0) return { path, changed: false, detail: `Cannot edit; ${path} does not exist.` };
    const content = action.all ? task.workspace[index].content.split(action.find).join(action.replace) : task.workspace[index].content.replace(action.find, action.replace);
    if (content === task.workspace[index].content) return { path, changed: false, detail: `No matching text was found in ${path}.` };
    task.workspace[index] = { ...task.workspace[index], content, size: content.length };
    return { path, changed: true, detail: `Edited ${path}.` };
  }

  if (action.type === "delete_file") {
    if (index < 0) return { path, changed: false, detail: `Cannot delete; ${path} does not exist.` };
    task.workspace.splice(index, 1);
    return { path, changed: true, detail: `Deleted ${path}.` };
  }

  const to = safePath(action.to);
  if (!to) return { path, changed: false, detail: "Rejected an unsafe rename destination." };
  if (index < 0) return { path, changed: false, detail: `Cannot rename; ${path} does not exist.` };
  if (task.workspace.some((file) => file.path === to)) return { path, changed: false, detail: `Cannot rename; ${to} already exists.` };
  task.workspace[index] = { ...task.workspace[index], path, size: task.workspace[index].content.length };
  task.workspace[index].path = to;
  return { path: to, changed: true, detail: `Renamed ${path} to ${to}.` };
}

export async function createTaskRecord(input: CreateTaskInput) {
  const kind = input.kind || inferTaskKind(input.objective);
  const task = createTask({ ...input, kind, taskType: input.taskType || inferTaskType(kind) });
  return await createStoredTask(task);
}

export async function getTask(id: string) {
  return await getStoredTask(id);
}

export function listTasks(projectId?: string, conversationId?: string) {
  return import("@/lib/taskStore").then(({ listStoredTasks }) => listStoredTasks(projectId, conversationId));
}

export async function updateTaskAction(id: string, action: "start" | "pause" | "cancel" | "approve" | "reject" | "restore_checkpoint", value?: string) {
  if (action === "start") return await setTaskStatus(id, "queued");
  if (action === "pause") return await setTaskStatus(id, "paused");
  if (action === "cancel") return await setTaskStatus(id, "cancelled");
  if (action === "approve" || action === "reject") {
    if (!value) throw new Error("approvalId is required.");
    return await resolveTaskApproval(id, value, action === "approve");
  }
  if (!value) throw new Error("checkpointId is required.");
  return await restoreTaskCheckpoint(id, value);
}

async function executeRequest(task: TaskRecord, request: AgentRequest): Promise<ToolResult> {
  const startedAt = Date.now();
  const permission = permissionForRequest(request);
  if (!hasPermission(task, permission)) {
    const approval = await requestTaskApproval(task.id, permission, `ELIAS wants permission to ${permission === "network" ? "access public web sources" : permission === "execute" ? "run validation commands" : permission === "artifact" ? "create a downloadable artifact" : "modify the workspace"}.`);
    return { id: request.id, type: request.type, error: `Waiting for approval: ${approval.id}`, startedAt, completedAt: Date.now() };
  }

  if (request.type === "inspect_project") return { id: request.id, type: request.type, result: { fileCount: task.workspace.length, totalChars: task.workspace.reduce((sum, file) => sum + file.content.length, 0), paths: task.workspace.map((file) => file.path) }, startedAt, completedAt: Date.now() };
  if (request.type === "list_files") return { id: request.id, type: request.type, result: task.workspace.filter((file) => !request.prefix || file.path.startsWith(request.prefix)).map((file) => file.path), startedAt, completedAt: Date.now() };
  if (request.type === "read_file") {
    const path = safePath(request.path);
    const file = path ? task.workspace.find((item) => item.path === path) : undefined;
    return { id: request.id, type: request.type, path: request.path, content: file?.content, error: file ? undefined : "file not found", startedAt, completedAt: Date.now() };
  }
  if (request.type === "search_files") {
    const query = request.query.toLowerCase();
    return { id: request.id, type: request.type, query: request.query, result: task.workspace.filter((file) => file.path.toLowerCase().includes(query) || file.content.toLowerCase().includes(query)).map((file) => file.path), startedAt, completedAt: Date.now() };
  }
  if (request.type === "inspect_dependencies") {
    const packageFile = task.workspace.find((file) => file.path === "package.json");
    return { id: request.id, type: request.type, result: packageFile ? packageFile.content.slice(0, 40_000) : "package.json not found", startedAt, completedAt: Date.now() };
  }
  if (request.type === "run_validation") return runWorkspaceValidation(task.workspace, request.check);
  if (request.type === "search_web") {
    try {
      return { id: request.id, type: request.type, query: request.query, result: await searchWeb(request.query), startedAt, completedAt: Date.now() };
    } catch (error) {
      return { id: request.id, type: request.type, query: request.query, error: error instanceof Error ? error.message : "Web search failed.", startedAt, completedAt: Date.now() };
    }
  }
  if (request.type === "fetch_url") {
    try {
      return { id: request.id, type: request.type, url: request.url, content: await fetchUrl(request.url), startedAt, completedAt: Date.now() };
    } catch (error) {
      return { id: request.id, type: request.type, url: request.url, error: error instanceof Error ? error.message : "Source could not be opened.", startedAt, completedAt: Date.now() };
    }
  }
  if (isBrowserRequest(request)) {
    const sessionId = request.sessionId || task.browserSessionId;
    if (!sessionId) return { id: request.id, type: request.type, error: "No connected browser session is linked to this task.", startedAt, completedAt: Date.now() };
    const action = request.type === "browser_navigate" ? { type: "navigate" as const, url: request.url } : request.type === "browser_click" ? { type: "click" as const, selector: request.selector } : request.type === "browser_type" ? { type: "type" as const, selector: request.selector, text: request.text } : request.type === "browser_scroll" ? { type: "scroll" as const, direction: request.direction, amount: request.amount } : request.type === "browser_screenshot" ? { type: "screenshot" as const } : { type: "extract" as const, selector: request.selector };
    try {
      const result = await performBrowserAction(sessionId, action);
      return { id: request.id, type: request.type, result: result.content || result.summary, url: request.type === "browser_navigate" ? request.url : undefined, startedAt, completedAt: Date.now() };
    } catch (error) {
      return { id: request.id, type: request.type, error: error instanceof Error ? error.message : "Browser action failed.", startedAt, completedAt: Date.now() };
    }
  }

  const artifactId = `artifact_${crypto.randomUUID()}`;
  const extension = request.name.split(".").pop()?.toLowerCase();
  const officeDoc = extension === "docx";
  const officeSlides = extension === "pptx";
  const pdf = extension === "pdf" || request.mimeType === "application/pdf";
  const binary = pdf || officeDoc || officeSlides;
  const encoding = binary ? "base64" as const : (request.encoding || "utf8") as "utf8" | "base64";
  const content = pdf ? await textToPdf(request.content) : officeDoc ? await textToDocx(request.content) : officeSlides ? await textToPptx(request.content) : request.encoding === "base64" ? request.content : await formatTextArtifact(request.name, request.content);
  const type = request.mimeType || artifactMime(request.name);
  await updateStoredTask(task.id, (current) => {
    current.artifacts.push({ id: artifactId, taskId: task.id, name: request.name, type, encoding, size: content.length, createdAt: Date.now(), preview: request.content.slice(0, 2_000), content });
  });
  return { id: request.id, type: request.type, result: { artifactId, name: request.name, type, encoding }, startedAt, completedAt: Date.now() };
}

function wantsDeliverable(objective: string) {
  return /pdf|download|report|document|memo|artifact|deliverable|file/i.test(objective);
}

function providerRefusedArtifact(message: string) {
  return /do not have access|don't have access|cannot (create|generate|provide)|can't (create|generate|provide)|unable to (create|generate|provide)|text-based ai|only generate text/i.test(message);
}

function stripArtifactRefusal(message: string) {
  return message
    .replace(/^\s*[^\n]*(?:cannot|can't|unable to|do not have access|don't have access)[^\n]*\n*/i, "")
    .replace(/^\s*However,?\s+(?:I can|here is|the following)[^\n]*\n*/i, "")
    .trim();
}

async function createFallbackArtifact(task: TaskRecord, message: string) {
  if (!wantsDeliverable(task.objective) || !message.trim() || providerRefusedArtifact(message)) return null;
  const requested = task.objective.match(/\b(docx|pptx|pdf|html|css|tsx|ts|jsx|js|md)\b/i)?.[1]?.toLowerCase() || "md";
  const artifactId = `artifact_${crypto.randomUUID()}`;
  const name = `elias-deliverable.${requested}`;
  const isPdf = requested === "pdf";
  const content = requested === "docx" ? await textToDocx(message) : requested === "pptx" ? await textToPptx(message) : isPdf ? await textToPdf(message) : await formatTextArtifact(name, message);
  const encoding = isPdf || requested === "docx" || requested === "pptx" ? "base64" as const : "utf8" as const;
  const type = artifactMime(name);
  await updateStoredTask(task.id, (current) => {
    current.artifacts.push({ id: artifactId, taskId: task.id, name, type, encoding, size: content.length, createdAt: Date.now(), preview: message.slice(0, 2_000), content });
  });
  await recordTaskEvent(task.id, { kind: "action", label: "Deliverable created", status: "completed", detail: `Created ${name} from the verified agent response.`, evidence: { type: "artifact", value: { artifactId, name } } });
  return artifactId;
}

export async function runTaskStep(id: string): Promise<TaskRecord> {
  let task = await getStoredTask(id);
  if (!task) throw new Error("Task not found.");
  if (["cancelled", "completed"].includes(task.status)) return task;
  if (task.approvals.some((approval) => approval.status === "pending")) return await setTaskStatus(id, "waiting_approval");

  await setTaskStatus(id, "planning");
  await recordTaskEvent(id, { kind: "plan", label: "Task plan loaded", status: "completed", detail: `${task.plan.length} planned steps.` });
  task = (await getStoredTask(id))!;
  const currentStep = task.plan.find((step) => step.status === "pending" || step.status === "active") || task.plan.at(-1);
  if (currentStep) {
    await updateStoredTask(id, (current) => {
      const step = current.plan.find((item) => item.id === currentStep.id);
      if (step) { step.status = "active"; step.updatedAt = Date.now(); }
      current.currentStepId = currentStep.id;
    });
  }

  await setTaskStatus(id, "running");
  task = (await getStoredTask(id))!;
  try {
    await hydrateRepositoryWorkspace(task);
    task = (await getStoredTask(id))!;
    const output = await runAgentStep({ task: task.objective, browserSessionId: task.browserSessionId, taskType: task.taskType, preferredProvider: task.preferredProvider, preferredModel: task.preferredModel, files: task.workspace, messages: task.events.filter((event) => event.kind === "message").map((event) => ({ role: "assistant", content: event.detail || event.label })), toolResults: task.toolResults });
    if (output.message) await recordTaskEvent(id, { kind: "message", label: "Agent response", status: "completed", detail: output.message, stepId: currentStep?.id, evidence: { type: "text", value: output.message } });

    const results: ToolResult[] = [];
    for (const request of output.requests) {
      await recordTaskEvent(id, { kind: "tool", label: `Tool started: ${request.type}`, status: "started", detail: "Awaiting execution.", stepId: currentStep?.id, toolId: request.id });
      const current = await getStoredTask(id);
      if (!current) throw new Error("Task disappeared during execution.");
      const result = await executeRequest(current, request);
      results.push(result);
      await recordToolResult(id, result);
      await recordTaskEvent(id, { kind: result.error ? "error" : "tool", label: result.error ? `Tool failed: ${request.type}` : `Tool completed: ${request.type}`, status: result.error ? "failed" : "completed", detail: result.error || "Evidence recorded.", stepId: currentStep?.id, toolId: request.id, evidence: { type: "json", value: result } });
    }

    if (output.actions.length) {
      const currentForActions = (await getStoredTask(id))!;
      if (!hasPermission(currentForActions, "write")) {
        const approval = await requestTaskApproval(id, "write", "ELIAS wants permission to modify files in the task workspace.");
        await recordTaskEvent(id, { kind: "tool", label: "Workspace changes waiting for approval", status: "started", detail: approval.question, stepId: currentStep?.id });
        return await setTaskStatus(id, "waiting_approval");
      }
      await createTaskCheckpoint(id, "Before workspace mutation", "before_mutation", currentForActions.workspace);
      const actionResults: Array<{ changed: boolean; detail: string; path?: string }> = [];
      await updateStoredTask(id, (current) => {
        for (const action of output.actions) actionResults.push(applyAction(current, action));
      });
      for (const result of actionResults) {
        await recordTaskEvent(id, { kind: result.changed ? "action" : "error", label: result.changed ? "Workspace changed" : "Workspace action rejected", status: result.changed ? "completed" : "failed", detail: result.detail, stepId: currentStep?.id, evidence: { type: result.changed ? "diff" : "text", value: result } });
      }
      await createTaskCheckpoint(id, "After workspace mutation", "after_mutation", (await getStoredTask(id))!.workspace);
    }

    task = (await getStoredTask(id))!;
    if (!output.requests.length && !output.actions.length && output.done && output.message) {
      if (referencesRepository(task.objective) && task.workspace.length === 0 && wantsDeliverable(task.objective)) {
        const message = "Repository context is empty, so ELIAS will not generate a report. Connect a repository or retry with a GitHub URL.";
        await recordTaskEvent(id, { kind: "error", label: "Report blocked: repository context empty", status: "failed", detail: message, stepId: currentStep?.id });
        return await setTaskStatus(id, "failed", message);
      }
      if (wantsDeliverable(task.objective) && providerRefusedArtifact(output.message)) {
        const cleaned = stripArtifactRefusal(output.message);
        const artifactId = await createFallbackArtifact(task, cleaned);
        if (!artifactId) {
          await recordTaskEvent(id, { kind: "error", label: "Provider returned no artifact", status: "failed", detail: "The selected provider returned no usable deliverable content." });
          return await setTaskStatus(id, "failed", "The selected provider did not return usable deliverable content. Retry the task.");
        }
      } else {
        await createFallbackArtifact(task, output.message);
      }
    }
    if (task.approvals.some((approval) => approval.status === "pending")) return setTaskStatus(id, "waiting_approval");
    if (currentStep) await updateStoredTask(id, (current) => { const step = current.plan.find((item) => item.id === currentStep.id); if (step) { const producedEvidence = output.requests.length > 0 || output.actions.length > 0; step.status = output.done || producedEvidence ? "completed" : "active"; step.updatedAt = Date.now(); } });
    const remainingSteps = (await getStoredTask(id))!.plan.some((step) => step.status === "pending" || step.status === "active");
    if (output.done && !remainingSteps) {
      await recordTaskEvent(id, { kind: "validation", label: "Task ready for delivery", status: "completed", detail: "Agent returned done=true after all planned steps were completed." });
      return await setTaskStatus(id, "completed");
    }
    return await setTaskStatus(id, "queued");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task step failed.";
    await recordTaskEvent(id, { kind: "error", label: "Task step failed", status: "failed", detail: message, stepId: currentStep?.id });
    return await setTaskStatus(id, "failed", message);
  }
}

export async function runTaskLoop(id: string, maxSteps = MAX_STEPS) {
  let task = await getStoredTask(id);
  if (!task) throw new Error("Task not found.");
  for (let step = 0; step < maxSteps; step += 1) {
    task = await runTaskStep(id);
    if (["completed", "failed", "cancelled", "waiting_approval", "paused"].includes(task.status)) break;
  }
  return task;
}
