import { createTask, type TaskRecord } from "@/lib/task";
import type { ToolResult, WorkspaceFile } from "@/lib/types";
import type { RepositoryMetadata } from "@/lib/githubRepositoryWorkspace";
import type { GitHubRepositoryTaskRecord } from "@/lib/githubRepositoryTaskStore";

export function createGitHubRepositoryTaskRecord(userId: string, objective: string, repository: RepositoryMetadata, files: WorkspaceFile[], now = Date.now()): GitHubRepositoryTaskRecord {
  const task = createTask({
    objective,
    title: `Work on ${repository.fullName}: ${objective}`.slice(0, 140),
    kind: "code",
    taskType: "code",
    workspace: structuredClone(files),
    permissions: { read: true, write: false, artifact: false, network: false, execute: false, external_side_effect: false },
  });
  task.repository = structuredClone(repository);
  task.checkpoints.push({
    id: `checkpoint_${crypto.randomUUID()}`,
    taskId: task.id,
    label: "Initial repository snapshot",
    reason: "manual",
    createdAt: now,
    files: structuredClone(files),
  });
  task.events.push({
    id: `evt_${crypto.randomUUID()}`,
    taskId: task.id,
    kind: "tool",
    label: "Repository workspace loaded",
    status: "completed",
    createdAt: now,
    detail: `Loaded ${files.length} text files from ${repository.fullName} on ${repository.branch} at ${repository.commitSha.slice(0, 12)}. Repository writes remain separate and approval-gated.`,
    evidence: { type: "json", value: { repository: repository.fullName, branch: repository.branch, commitSha: repository.commitSha, fileCount: files.length, paths: files.map((file) => file.path) } },
  });
  return { id: task.id, userId, task, updatedAt: now };
}

export function taskCanBeReadBy(record: Pick<GitHubRepositoryTaskRecord, "userId">, userId: string) {
  return Boolean(userId) && record.userId === userId;
}

export type RepositoryTaskChange = { path: string; status: "added" | "modified" | "deleted"; content: string; before?: string };

export function summarizeRepositoryValidations(results: ToolResult[]) {
  if (!results.length) return "- No validation command was run.";
  return results.map((item) => {
    const value = item.result && typeof item.result === "object" ? item.result as Record<string, unknown> : {};
    const check = typeof value.check === "string" ? value.check : "validation";
    const status = value.available === false ? "not run" : value.passed === true ? "passed" : value.passed === false ? "failed" : "no pass/fail result";
    return `- ${check}: ${status}${item.error ? " (runner reported an error)" : ""}`;
  }).join("\n");
}

export function repositoryTaskChanges(task: Pick<TaskRecord, "workspace" | "checkpoints">): RepositoryTaskChange[] {
  const checkpoint = task.checkpoints.find((item) => item.label === "Initial repository snapshot");
  const before = new Map((checkpoint?.files || []).map((file) => [file.path, file.content]));
  const after = new Map(task.workspace.map((file) => [file.path, file.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.reduce<RepositoryTaskChange[]>((changes, path) => {
    const oldContent = before.get(path);
    const newContent = after.get(path);
    if (oldContent === newContent) return changes;
    if (oldContent === undefined) changes.push({ path, status: "added", content: newContent ?? "" });
    else if (newContent === undefined) changes.push({ path, status: "deleted", content: "", before: oldContent });
    else changes.push({ path, status: "modified", content: newContent, before: oldContent });
    return changes;
  }, []);
}
