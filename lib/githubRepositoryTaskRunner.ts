import { randomUUID } from "node:crypto";
import { fetchUrl, searchWeb } from "@/lib/webSearch";
import { runWorkspaceValidation } from "@/lib/execution";
import { runAgentStep } from "@/lib/agent";
import type { AgentAction, AgentRequest, ToolResult, WorkspaceFile } from "@/lib/types";
import type { PermissionLevel, TaskApproval, TaskCheckpoint, TaskEvent, TaskRecord } from "@/lib/task";
import { isRepositoryTextPath, safeRepositoryPath } from "@/lib/githubRepositoryWorkspace";
import { repositoryTaskChanges } from "@/lib/githubRepositoryTask";
import { claimGitHubRepositoryTaskStep, getGitHubRepositoryTask, updateGitHubRepositoryTask } from "@/lib/githubRepositoryTaskStore";

const MAX_REPOSITORY_TASK_FILES = 64;
const MAX_REPOSITORY_TASK_CHARS = 1_200_000;

function fitsRepositoryWorkspace(task: TaskRecord, path: string, content: string) {
  const index = task.workspace.findIndex((file) => file.path === path);
  if (index < 0 && task.workspace.length >= MAX_REPOSITORY_TASK_FILES) return false;
  const currentChars = task.workspace.reduce((sum, file) => sum + file.content.length, 0);
  return currentChars - (index >= 0 ? task.workspace[index].content.length : 0) + content.length <= MAX_REPOSITORY_TASK_CHARS;
}

function hasPermission(task: TaskRecord, permission: PermissionLevel) {
  return task.permissions.some((item) => item.level === permission && item.granted);
}

function requestPermission(request: AgentRequest): PermissionLevel {
  if (request.type === "run_validation") return "execute";
  if (request.type === "search_web" || request.type === "fetch_url") return "network";
  if (request.type === "create_artifact") return "artifact";
  return "read";
}

function failedToolResult(result: ToolResult) {
  if (result.error) return true;
  if (result.type === "run_validation" && result.result && typeof result.result === "object" && "passed" in result.result) return (result.result as { passed?: unknown }).passed === false;
  return false;
}

function event(task: TaskRecord, kind: TaskEvent["kind"], label: string, detail: string, evidence?: TaskEvent["evidence"], status: TaskEvent["status"] = "completed") {
  const now = Date.now();
  task.events.push({ id: `evt_${randomUUID()}`, taskId: task.id, kind, label, detail, status, createdAt: now, ...(task.currentStepId ? { stepId: task.currentStepId } : {}), ...(evidence ? { evidence } : {}) });
}

function checkpoint(task: TaskRecord, label: string, reason: TaskCheckpoint["reason"]) {
  task.checkpoints.push({ id: `checkpoint_${randomUUID()}`, taskId: task.id, label, reason, createdAt: Date.now(), files: structuredClone(task.workspace), ...(task.checkpoints.at(-1) ? { parentId: task.checkpoints.at(-1)!.id } : {}) });
}

function applyAction(task: TaskRecord, action: AgentAction) {
  const path = safeRepositoryPath(action.path);
  if (!path || !isRepositoryTextPath(path)) return { path: action.path, changed: false, detail: "Rejected an unsafe or unsupported repository path." };
  const index = task.workspace.findIndex((file) => file.path === path);

  if (action.type === "write_file") {
    if (action.content.length > 160_000) return { path, changed: false, detail: "Rejected a repository file write larger than 160 KB." };
    const next: WorkspaceFile = { path, content: action.content, size: action.content.length };
    if (index >= 0 && task.workspace[index].content === action.content) return { path, changed: false, detail: `No changes were needed in ${path}.` };
    if (!fitsRepositoryWorkspace(task, path, action.content)) return { path, changed: false, detail: "Rejected a repository write that exceeds workspace file or size limits." };
    if (index >= 0) task.workspace[index] = next; else task.workspace.push(next);
    return { path, changed: true, detail: `Updated ${path} in the isolated repository task workspace.` };
  }

  if (action.type === "append_file") {
    if (index < 0) return { path, changed: false, detail: `Cannot append; ${path} is not in the selected repository snapshot.` };
    const content = task.workspace[index].content + action.content;
    if (content.length > 160_000) return { path, changed: false, detail: "Rejected an appended file larger than 160 KB." };
    if (!fitsRepositoryWorkspace(task, path, content)) return { path, changed: false, detail: "Rejected an append that exceeds the repository workspace size limit." };
    task.workspace[index] = { ...task.workspace[index], content, size: content.length };
    return { path, changed: true, detail: `Updated ${path} in the isolated repository task workspace.` };
  }

  if (action.type === "edit_file") {
    if (index < 0) return { path, changed: false, detail: `Cannot edit; ${path} is not in the selected repository snapshot.` };
    const original = task.workspace[index].content;
    const content = action.all ? original.split(action.find).join(action.replace) : original.replace(action.find, action.replace);
    if (content === original) return { path, changed: false, detail: `No matching text was found in ${path}.` };
    if (content.length > 160_000) return { path, changed: false, detail: "Rejected an edited file larger than 160 KB." };
    if (!fitsRepositoryWorkspace(task, path, content)) return { path, changed: false, detail: "Rejected an edit that exceeds the repository workspace size limit." };
    task.workspace[index] = { ...task.workspace[index], content, size: content.length };
    return { path, changed: true, detail: `Updated ${path} in the isolated repository task workspace.` };
  }

  if (action.type === "delete_file") {
    if (index < 0) return { path, changed: false, detail: `Cannot delete; ${path} is not in the selected repository snapshot.` };
    task.workspace.splice(index, 1);
    return { path, changed: true, detail: `Removed ${path} from the isolated repository task workspace.` };
  }

  const destination = safeRepositoryPath(action.to);
  if (!destination || !isRepositoryTextPath(destination)) return { path, changed: false, detail: "Rejected an unsafe or unsupported rename destination." };
  if (index < 0) return { path, changed: false, detail: `Cannot rename; ${path} is not in the selected repository snapshot.` };
  if (task.workspace.some((file) => file.path === destination)) return { path, changed: false, detail: `Cannot rename; ${destination} already exists in the workspace.` };
  task.workspace[index] = { ...task.workspace[index], path: destination };
  return { path: destination, changed: true, detail: `Renamed ${path} to ${destination} in the isolated task workspace.` };
}

async function executeRequest(task: TaskRecord, request: AgentRequest): Promise<ToolResult> {
  const startedAt = Date.now();
  const id = request.id || `tool_${randomUUID()}`;
  const basic = { id, type: request.type, startedAt };
  if (request.type === "inspect_project") return { ...basic, result: { repository: task.repository?.fullName, branch: task.repository?.branch, fileCount: task.workspace.length, totalChars: task.workspace.reduce((sum, file) => sum + file.content.length, 0), paths: task.workspace.map((file) => file.path) }, completedAt: Date.now() };
  if (request.type === "list_files") return { ...basic, result: task.workspace.filter((file) => !request.prefix || file.path.startsWith(request.prefix)).map((file) => file.path), completedAt: Date.now() };
  if (request.type === "read_file") {
    const path = safeRepositoryPath(request.path);
    const file = path ? task.workspace.find((item) => item.path === path) : undefined;
    return { ...basic, path: request.path, content: file?.content, ...(file ? {} : { error: "file not found in selected repository snapshot" }), completedAt: Date.now() };
  }
  if (request.type === "search_files") {
    const query = request.query.toLowerCase();
    return { ...basic, query: request.query, result: task.workspace.filter((file) => file.path.toLowerCase().includes(query) || file.content.toLowerCase().includes(query)).map((file) => file.path), completedAt: Date.now() };
  }
  if (request.type === "inspect_dependencies") {
    const packageFile = task.workspace.find((file) => file.path === "package.json");
    return { ...basic, result: packageFile ? packageFile.content.slice(0, 40_000) : "package.json not found in the selected repository snapshot", completedAt: Date.now() };
  }
  if (request.type === "run_validation") {
    const result = await runWorkspaceValidation(task.workspace, request.check);
    return { ...result, id, completedAt: result.completedAt || Date.now() };
  }
  if (request.type === "search_web") {
    try { return { ...basic, query: request.query, result: await searchWeb(request.query), completedAt: Date.now() }; }
    catch (error) { return { ...basic, query: request.query, error: error instanceof Error ? error.message : "Web search failed.", completedAt: Date.now() }; }
  }
  if (request.type === "fetch_url") {
    try { return { ...basic, url: request.url, content: await fetchUrl(request.url), completedAt: Date.now() }; }
    catch (error) { return { ...basic, url: request.url, error: error instanceof Error ? error.message : "Source could not be opened.", completedAt: Date.now() }; }
  }
  return { ...basic, error: `The ${request.type} tool is not available in repository tasks.`, completedAt: Date.now() };
}

async function requestApproval(id: string, userId: string, permission: PermissionLevel, question: string) {
  const approval: TaskApproval = { id: `approval_${randomUUID()}`, taskId: id, permission, question, status: "pending", createdAt: Date.now() };
  return await updateGitHubRepositoryTask(id, userId, (record) => {
    record.task.approvals.push(approval);
    record.task.status = "waiting_approval";
  });
}

export async function runGitHubRepositoryTaskStep(id: string, userId: string) {
  const record = await getGitHubRepositoryTask(id, userId);
  if (!record) throw new Error("Repository task not found.");
  let task = record.task;
  if (["completed", "cancelled"].includes(task.status)) return task;
  if (task.approvals.some((approval) => approval.status === "pending")) {
    await updateGitHubRepositoryTask(id, userId, (current) => { current.task.status = "waiting_approval"; });
    return (await getGitHubRepositoryTask(id, userId))!.task;
  }
  if (task.status === "running") throw new Error("A repository task step is already running.");

  const now = Date.now();
  const claimed = await claimGitHubRepositoryTaskStep(id, userId);
  if (!claimed) {
    const latest = await getGitHubRepositoryTask(id, userId);
    if (!latest) throw new Error("Repository task not found.");
    if (latest.task.status === "running") throw new Error("A repository task step is already running.");
    return latest.task;
  }
  task = claimed.task;
  const currentStep = task.plan.find((step) => ["pending", "active", "failed"].includes(step.status)) || task.plan.at(-1);
  try {
    await updateGitHubRepositoryTask(id, userId, (current) => {
      current.task.startedAt ||= now;
      if (currentStep) {
      const step = current.task.plan.find((item) => item.id === currentStep.id);
      if (step) { step.status = "active"; step.updatedAt = now; }
      current.task.currentStepId = currentStep.id;
      }
    });
    task = (await getGitHubRepositoryTask(id, userId))!.task;
    const output = await runAgentStep({
      task: `${task.objective}\n\nSELECTED GITHUB REPOSITORY: ${task.repository?.fullName || "unknown"} on branch ${task.repository?.branch || "unknown"}. Use only the supplied repository snapshot. File actions modify only this isolated task workspace. Never claim anything was committed, pushed, or opened as a pull request; those actions happen later through a separate user-confirmed GitHub proposal. Do not request shell commands or arbitrary execution. If validation is unavailable, report that limitation accurately.`,
      taskType: task.taskType,
      preferredProvider: task.preferredProvider,
      preferredModel: task.preferredModel,
      files: task.workspace,
      messages: task.events.filter((item) => item.kind === "message").slice(-12).map((item) => ({ role: "assistant", content: item.detail || item.label })),
      toolResults: task.toolResults,
    });

    await updateGitHubRepositoryTask(id, userId, (current) => {
      if (output.message) event(current.task, "message", "Agent response", output.message, { type: "text", value: output.message });
    });

    const results: ToolResult[] = [];
    const actionResults: Array<{ path?: string; changed: boolean; detail: string }> = [];
    for (const request of output.requests.slice(0, 30)) {
      if (!["inspect_project", "list_files", "read_file", "search_files", "inspect_dependencies", "run_validation", "search_web", "fetch_url"].includes(request.type)) {
        const result: ToolResult = { id: request.id || `tool_${randomUUID()}`, type: request.type, error: `The ${request.type} tool is not available in repository tasks.`, startedAt: Date.now(), completedAt: Date.now() };
        results.push(result);
        await updateGitHubRepositoryTask(id, userId, (current) => {
          current.task.toolResults.push(result);
          event(current.task, "error", `Tool unavailable: ${request.type}`, result.error!, { type: "json", value: result }, "failed");
        });
        continue;
      }
      const permission = requestPermission(request);
      const currentRecord = await getGitHubRepositoryTask(id, userId);
      if (!currentRecord) throw new Error("Repository task not found.");
      if (!hasPermission(currentRecord.task, permission)) {
        const label = permission === "execute" ? "run validation commands" : permission === "network" ? "access public web sources" : permission === "artifact" ? "create a downloadable artifact" : "read repository files";
        const approved = await requestApproval(id, userId, permission, `ELIAS wants permission to ${label} for ${currentRecord.task.repository?.fullName || "this repository task"}.`);
        return approved.task;
      }
      await updateGitHubRepositoryTask(id, userId, (current) => event(current.task, "tool", `Tool started: ${request.type}`, "Awaiting execution.", undefined, "started"));
      const fresh = (await getGitHubRepositoryTask(id, userId))!.task;
      const result = await executeRequest(fresh, request);
      results.push(result);
      await updateGitHubRepositoryTask(id, userId, (current) => {
        current.task.toolResults.push(result);
        event(current.task, result.error ? "error" : "tool", result.error ? `Tool failed: ${request.type}` : `Tool completed: ${request.type}`, result.error || "Evidence recorded.", { type: "json", value: result }, result.error ? "failed" : "completed");
      });
    }

    if (output.actions.length) {
      const current = (await getGitHubRepositoryTask(id, userId))!;
      if (!hasPermission(current.task, "write")) {
        return (await requestApproval(id, userId, "write", `ELIAS wants permission to change files in ${current.task.repository?.fullName || "the selected repository"}. The changes remain in this isolated task workspace until you separately approve a GitHub write proposal.`)).task;
      }
      await updateGitHubRepositoryTask(id, userId, (record) => {
        checkpoint(record.task, "Before repository workspace changes", "before_mutation");
        for (const action of output.actions.slice(0, 30)) actionResults.push(applyAction(record.task, action));
      });
      await updateGitHubRepositoryTask(id, userId, (record) => {
        for (const result of actionResults) event(record.task, result.changed ? "action" : "error", result.changed ? "Repository workspace changed" : "Repository action rejected", result.detail, { type: result.changed ? "diff" : "text", value: result }, result.changed ? "completed" : "failed");
        checkpoint(record.task, "After repository workspace changes", "after_mutation");
      });
    }

    const latest = (await getGitHubRepositoryTask(id, userId))!;
    const failed = results.some(failedToolResult) || actionResults.some((result) => !result.changed);
    if (failed) {
      await updateGitHubRepositoryTask(id, userId, (current) => { current.task.status = "queued"; const step = current.task.plan.find((item) => item.id === current.task.currentStepId); if (step) step.status = "active"; });
      return (await getGitHubRepositoryTask(id, userId))!.task;
    }
    if (latest.task.approvals.some((approval) => approval.status === "pending")) return latest.task;

    const producedEvidence = output.requests.length > 0 || output.actions.length > 0;
    await updateGitHubRepositoryTask(id, userId, (current) => {
      const step = current.task.plan.find((item) => item.id === current.task.currentStepId);
      if (step) { step.status = output.done || producedEvidence ? "completed" : "active"; step.updatedAt = Date.now(); }
      const allComplete = current.task.plan.every((item) => item.status === "completed" || item.status === "skipped");
      if (output.done && allComplete) {
        event(current.task, "validation", "Repository task complete", "ELIAS finished the task plan. Review the recorded repository changes and validation results before approving any GitHub write.", { type: "json", value: { changedFileCount: repositoryTaskChanges(current.task).length, validationResults: current.task.toolResults.filter((item) => item.type === "run_validation").length } });
        current.task.status = "completed";
        current.task.completedAt = Date.now();
      } else current.task.status = "queued";
    });
    return (await getGitHubRepositoryTask(id, userId))!.task;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository task step failed.";
    await updateGitHubRepositoryTask(id, userId, (current) => {
      event(current.task, "error", "Repository task step failed", message, undefined, "failed");
      current.task.status = "failed";
      current.task.error = message;
      current.task.completedAt = Date.now();
    });
    return (await getGitHubRepositoryTask(id, userId))!.task;
  }
}

export async function resolveGitHubRepositoryTaskApproval(id: string, userId: string, approvalId: string, approved: boolean) {
  return await updateGitHubRepositoryTask(id, userId, (record) => {
    const approval = record.task.approvals.find((item) => item.id === approvalId && item.status === "pending");
    if (!approval) throw new Error("Pending repository-task approval not found.");
    approval.status = approved ? "approved" : "rejected";
    approval.resolvedAt = Date.now();
    approval.resolvedBy = "user";
    if (approved) {
      const permission = record.task.permissions.find((item) => item.level === approval.permission);
      if (permission) { permission.granted = true; permission.grantedAt = approval.resolvedAt; permission.grantedBy = "user"; }
      record.task.status = "queued";
    } else record.task.status = "paused";
    event(record.task, "action", approved ? "Repository task permission approved" : "Repository task permission declined", approval.question, { type: "json", value: { approvalId, permission: approval.permission, approved } });
  });
}

export async function restoreGitHubRepositoryTaskCheckpoint(id: string, userId: string, checkpointId: string) {
  return await updateGitHubRepositoryTask(id, userId, (record) => {
    const saved = record.task.checkpoints.find((item) => item.id === checkpointId);
    if (!saved) throw new Error("Repository task checkpoint not found.");
    record.task.workspace = structuredClone(saved.files);
    record.task.status = "paused";
    event(record.task, "action", "Repository task checkpoint restored", saved.label, { type: "json", value: { checkpointId } });
  });
}
