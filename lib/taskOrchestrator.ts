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
import { textToPdf } from "@/lib/artifacts";

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

export function createTaskRecord(input: CreateTaskInput) {
  const kind = input.kind || inferTaskKind(input.objective);
  const task = createTask({ ...input, kind, taskType: input.taskType || inferTaskType(kind) });
  return createStoredTask(task);
}

export function getTask(id: string) {
  return getStoredTask(id);
}

export function listTasks(projectId?: string, conversationId?: string) {
  return import("@/lib/taskStore").then(({ listStoredTasks }) => listStoredTasks(projectId, conversationId));
}

export function updateTaskAction(id: string, action: "start" | "pause" | "cancel" | "approve" | "reject" | "restore_checkpoint", value?: string) {
  if (action === "start") return setTaskStatus(id, "queued");
  if (action === "pause") return setTaskStatus(id, "paused");
  if (action === "cancel") return setTaskStatus(id, "cancelled");
  if (action === "approve" || action === "reject") {
    if (!value) throw new Error("approvalId is required.");
    return resolveTaskApproval(id, value, action === "approve");
  }
  if (!value) throw new Error("checkpointId is required.");
  return import("@/lib/taskStore").then(({ restoreTaskCheckpoint }) => restoreTaskCheckpoint(id, value));
}

async function executeRequest(task: TaskRecord, request: AgentRequest): Promise<ToolResult> {
  const startedAt = Date.now();
  const permission = permissionForRequest(request);
  if (!hasPermission(task, permission)) {
    const approval = requestTaskApproval(task.id, permission, `ELIAS wants permission to ${permission === "network" ? "access public web sources" : permission === "execute" ? "run validation commands" : permission === "artifact" ? "create a downloadable artifact" : "modify the workspace"}.`);
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
  if (request.type === "search_web") return { id: request.id, type: request.type, query: request.query, result: await searchWeb(request.query), startedAt, completedAt: Date.now() };
  if (request.type === "fetch_url") return { id: request.id, type: request.type, url: request.url, content: await fetchUrl(request.url), startedAt, completedAt: Date.now() };

  const artifactId = `artifact_${crypto.randomUUID()}`;
  const pdf = request.mimeType === "application/pdf" || /\.pdf$/i.test(request.name);
  const encoding = request.encoding || (pdf ? "base64" : "utf8");
  const content = encoding === "base64" ? (pdf ? textToPdf(request.content) : request.content) : request.content;
  updateStoredTask(task.id, (current) => {
    current.artifacts.push({ id: artifactId, taskId: task.id, name: request.name, type: request.mimeType || "text/plain; charset=utf-8", encoding, size: content.length, createdAt: Date.now(), preview: request.content.slice(0, 2_000), content });
  });
  return { id: request.id, type: request.type, result: { artifactId, name: request.name, type: request.mimeType || "text/plain; charset=utf-8", encoding }, startedAt, completedAt: Date.now() };
}

function wantsDeliverable(objective: string) {
  return /pdf|download|report|document|memo|artifact|deliverable|file/i.test(objective);
}

function providerRefusedArtifact(message: string) {
  return /do not have access|don't have access|cannot (create|generate|provide)|can't (create|generate|provide)|unable to (create|generate|provide)|text-based ai|only generate text/i.test(message);
}

function createFallbackArtifact(task: TaskRecord, message: string) {
  if (!wantsDeliverable(task.objective) || !message.trim() || providerRefusedArtifact(message)) return null;
  const isPdf = /pdf/i.test(task.objective);
  const artifactId = `artifact_${crypto.randomUUID()}`;
  const content = isPdf ? textToPdf(message) : message;
  const encoding = isPdf ? "base64" as const : "utf8" as const;
  const name = isPdf ? "elias-deliverable.pdf" : "elias-deliverable.md";
  updateStoredTask(task.id, (current) => {
    current.artifacts.push({ id: artifactId, taskId: task.id, name, type: isPdf ? "application/pdf" : "text/markdown; charset=utf-8", encoding, size: content.length, createdAt: Date.now(), preview: message.slice(0, 2_000), content });
  });
  recordTaskEvent(task.id, { kind: "action", label: "Deliverable created", status: "completed", detail: `Created ${name} from the verified agent response.`, evidence: { type: "artifact", value: { artifactId, name } } });
  return artifactId;
}

export async function runTaskStep(id: string): Promise<TaskRecord> {
  let task = getStoredTask(id);
  if (!task) throw new Error("Task not found.");
  if (["cancelled", "completed"].includes(task.status)) return task;
  if (task.approvals.some((approval) => approval.status === "pending")) return setTaskStatus(id, "waiting_approval");

  setTaskStatus(id, "planning");
  recordTaskEvent(id, { kind: "plan", label: "Task plan loaded", status: "completed", detail: `${task.plan.length} planned steps.` });
  task = getStoredTask(id)!;
  const currentStep = task.plan.find((step) => step.status === "pending" || step.status === "active") || task.plan.at(-1);
  if (currentStep) {
    updateStoredTask(id, (current) => {
      const step = current.plan.find((item) => item.id === currentStep.id);
      if (step) { step.status = "active"; step.updatedAt = Date.now(); }
      current.currentStepId = currentStep.id;
    });
  }

  setTaskStatus(id, "running");
  task = getStoredTask(id)!;
  try {
    const output = await runAgentStep({ task: task.objective, taskType: task.taskType, preferredProvider: task.preferredProvider, preferredModel: task.preferredModel, files: task.workspace, messages: task.events.filter((event) => event.kind === "message").map((event) => ({ role: "assistant", content: event.detail || event.label })), toolResults: task.toolResults });
    if (output.message) recordTaskEvent(id, { kind: "message", label: "Agent response", status: "completed", detail: output.message, stepId: currentStep?.id, evidence: { type: "text", value: output.message } });

    const results: ToolResult[] = [];
    for (const request of output.requests) {
      recordTaskEvent(id, { kind: "tool", label: `Tool started: ${request.type}`, status: "started", detail: "Awaiting execution.", stepId: currentStep?.id, toolId: request.id });
      const current = getStoredTask(id);
      if (!current) throw new Error("Task disappeared during execution.");
      const result = await executeRequest(current, request);
      results.push(result);
      recordToolResult(id, result);
      recordTaskEvent(id, { kind: result.error ? "error" : "tool", label: result.error ? `Tool failed: ${request.type}` : `Tool completed: ${request.type}`, status: result.error ? "failed" : "completed", detail: result.error || "Evidence recorded.", stepId: currentStep?.id, toolId: request.id, evidence: { type: "json", value: result } });
    }

    if (output.actions.length) {
      const currentForActions = getStoredTask(id)!;
      if (!hasPermission(currentForActions, "write")) {
        const approval = requestTaskApproval(id, "write", "ELIAS wants permission to modify files in the task workspace.");
        recordTaskEvent(id, { kind: "tool", label: "Workspace changes waiting for approval", status: "started", detail: approval.question, stepId: currentStep?.id });
        return setTaskStatus(id, "waiting_approval");
      }
      createTaskCheckpoint(id, "Before workspace mutation", "before_mutation", currentForActions.workspace);
      const actionResults: Array<{ changed: boolean; detail: string; path?: string }> = [];
      updateStoredTask(id, (current) => {
        for (const action of output.actions) actionResults.push(applyAction(current, action));
      });
      for (const result of actionResults) {
        recordTaskEvent(id, { kind: result.changed ? "action" : "error", label: result.changed ? "Workspace changed" : "Workspace action rejected", status: result.changed ? "completed" : "failed", detail: result.detail, stepId: currentStep?.id, evidence: { type: result.changed ? "diff" : "text", value: result } });
      }
      createTaskCheckpoint(id, "After workspace mutation", "after_mutation", getStoredTask(id)!.workspace);
    }

    task = getStoredTask(id)!;
    if (!output.requests.length && !output.actions.length && output.done && output.message) {
      if (wantsDeliverable(task.objective) && providerRefusedArtifact(output.message)) {
        recordTaskEvent(id, { kind: "error", label: "Provider returned no artifact", status: "failed", detail: "The selected provider returned a limitation message instead of a deliverable." });
        return setTaskStatus(id, "failed", "The selected provider did not return a deliverable. Configure a provider that supports structured agent output and retry.");
      }
      createFallbackArtifact(task, output.message);
    }
    if (task.approvals.some((approval) => approval.status === "pending")) return setTaskStatus(id, "waiting_approval");
    if (currentStep) updateStoredTask(id, (current) => { const step = current.plan.find((item) => item.id === currentStep.id); if (step) { step.status = output.done ? "completed" : "active"; step.updatedAt = Date.now(); } });
    if (output.done) {
      recordTaskEvent(id, { kind: "validation", label: "Task ready for delivery", status: "completed", detail: "Agent returned done=true after recording tool results." });
      return setTaskStatus(id, "completed");
    }
    return setTaskStatus(id, "queued");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task step failed.";
    recordTaskEvent(id, { kind: "error", label: "Task step failed", status: "failed", detail: message, stepId: currentStep?.id });
    return setTaskStatus(id, "failed", message);
  }
}

export async function runTaskLoop(id: string, maxSteps = MAX_STEPS) {
  let task = getStoredTask(id);
  if (!task) throw new Error("Task not found.");
  for (let step = 0; step < maxSteps; step += 1) {
    task = await runTaskStep(id);
    if (["completed", "failed", "cancelled", "waiting_approval", "paused"].includes(task.status)) break;
  }
  return task;
}
