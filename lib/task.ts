import type { AgentActivity, TaskType, ToolResult, WorkspaceFile } from "@/lib/types";

export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskKind = "chat" | "code" | "research" | "study" | "document" | "media";

export type PermissionLevel = "read" | "write" | "artifact" | "network" | "execute" | "external_side_effect";

export type TaskPermission = {
  level: PermissionLevel;
  granted: boolean;
  grantedAt?: number;
  grantedBy?: "user" | "policy";
  reason: string;
};

export type TaskPlanStep = {
  id: string;
  title: string;
  description: string;
  status: "pending" | "active" | "completed" | "failed" | "skipped";
  requires?: PermissionLevel;
  evidenceEventIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type TaskCheckpoint = {
  id: string;
  taskId: string;
  label: string;
  createdAt: number;
  reason: "before_mutation" | "after_mutation" | "manual" | "validation";
  files: WorkspaceFile[];
  parentId?: string;
};

export type TaskApproval = {
  id: string;
  taskId: string;
  permission: PermissionLevel;
  question: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: "user" | "policy";
};

export type TaskEvent = AgentActivity & {
  taskId: string;
  stepId?: string;
  toolId?: string;
  evidence?: {
    type: "text" | "json" | "diff" | "url" | "artifact" | "validation";
    value: unknown;
  };
};

export type TaskArtifactRef = {
  id: string;
  taskId: string;
  name: string;
  type: string;
  encoding?: "utf8" | "base64";
  size?: number;
  createdAt: number;
  downloadUrl?: string;
  preview?: string;
  content?: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  objective: string;
  kind: TaskKind;
  taskType: TaskType;
  preferredProvider?: import("@/lib/types").ProviderName;
  preferredModel?: string;
  status: TaskStatus;
  projectId?: string;
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  currentStepId?: string;
  plan: TaskPlanStep[];
  permissions: TaskPermission[];
  approvals: TaskApproval[];
  checkpoints: TaskCheckpoint[];
  events: TaskEvent[];
  artifacts: TaskArtifactRef[];
  toolResults: ToolResult[];
  workspace: WorkspaceFile[];
  error?: string;
};

export type CreateTaskInput = {
  objective: string;
  title?: string;
  kind?: TaskKind;
  taskType?: TaskType;
  preferredProvider?: import("@/lib/types").ProviderName;
  preferredModel?: string;
  projectId?: string;
  conversationId?: string;
  workspace?: WorkspaceFile[];
  permissions?: Partial<Record<PermissionLevel, boolean>>;
};

export type TaskAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "cancel" }
  | { type: "approve"; approvalId: string }
  | { type: "reject"; approvalId: string }
  | { type: "restore_checkpoint"; checkpointId: string };

export type TaskSnapshot = {
  task: TaskRecord;
  events: TaskEvent[];
  checkpoints: TaskCheckpoint[];
  approvals: TaskApproval[];
};

export function inferTaskKind(objective: string): TaskKind {
  const value = objective.toLowerCase();
  const codingRequest = /code|coding|build|implement|develop|debug|refactor|repository|repo|project|component|dashboard|website|web app|file tree|typescript|javascript|python|api|run type checks|review the existing.*architecture/.test(value);
  if (codingRequest) return "code";
  if (/research|latest|source|current|compare|investigate/.test(value)) return "research";
  if (/study|exam|flashcard|lesson|chapter/.test(value)) return "study";
  if (/document|report|readme|specification|write a memo/.test(value)) return "document";
  if (/image|photo|voice|video|camera|audio/.test(value)) return "media";
  return "chat";
}

export function inferTaskType(kind: TaskKind): TaskType {
  if (kind === "code") return "code";
  if (kind === "research") return "research";
  if (kind === "study") return "study";
  return "general";
}

export function defaultPermissions(input: CreateTaskInput): TaskPermission[] {
  const values: Array<[PermissionLevel, string]> = [
    ["read", "Read the task workspace and supplied context."],
    ["write", "Create or modify files in the task workspace."],
    ["artifact", "Create downloadable artifacts from verified task output."],
    ["network", "Search and open public web sources."],
    ["execute", "Run commands inside an isolated execution worker."],
    ["external_side_effect", "Perform an irreversible action outside the workspace."],
  ];
  return values.map(([level, reason]) => ({
    level,
    granted: input.permissions?.[level] ?? (level === "read" || level === "artifact" || (level === "network" && input.kind === "research")),
    ...(input.permissions?.[level] || level === "read" || level === "artifact" || (level === "network" && input.kind === "research") ? { grantedAt: Date.now(), grantedBy: "policy" as const } : {}),
    reason,
  }));
}

export function buildPlan(input: CreateTaskInput, now = Date.now()): TaskPlanStep[] {
  const kind = input.kind || inferTaskKind(input.objective);
  const base: Array<[string, string, string, PermissionLevel?]> = kind === "code"
    ? [
        ["inspect", "Inspect the workspace", "Understand the project structure, dependencies, and relevant files.", "read"],
        ["plan", "Create an implementation plan", "Break the objective into small, verifiable changes."],
        ["change", "Implement the changes", "Modify only the necessary files and record a checkpoint before mutations.", "write"],
        ["validate", "Validate the result", "Run available validation tools or clearly record why execution is unavailable.", "execute"],
        ["review", "Review the deliverable", "Inspect the final diff, artifacts, and unresolved limitations.", "read"],
      ]
    : kind === "research"
      ? [
          ["scope", "Scope the research question", "Clarify the question, time range, and source requirements."],
          ["search", "Search live sources", "Find relevant current sources using the research tools.", "network"],
          ["read", "Read and compare evidence", "Open relevant sources and record evidence excerpts.", "network"],
          ["synthesize", "Synthesize the findings", "Separate sourced facts, inferences, and recommendations."],
          ["deliver", "Prepare the research artifact", "Create a readable report with source references."],
        ]
      : [
          ["understand", "Understand the objective", "Clarify the requested outcome and constraints."],
          ["work", "Complete the work", "Use the smallest set of verified tools needed to make progress."],
          ["review", "Review the result", "Check the answer, evidence, and artifacts before delivery."],
        ];

  return base.map(([id, title, description, requires]) => ({
    id: `${id}_${crypto.randomUUID()}`,
    title,
    description,
    status: "pending",
    ...(requires ? { requires } : {}),
    evidenceEventIds: [],
    createdAt: now,
    updatedAt: now,
  }));
}

export function createTask(input: CreateTaskInput): TaskRecord {
  const now = Date.now();
  const kind = input.kind || inferTaskKind(input.objective);
  const taskType = input.taskType || inferTaskType(kind);
  const title = input.title?.trim() || input.objective.trim().slice(0, 80) || "New Elias task";
  return {
    id: `task_${crypto.randomUUID()}`,
    title,
    objective: input.objective.trim(),
    kind,
    taskType,
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
    status: "queued",
    projectId: input.projectId,
    conversationId: input.conversationId,
    createdAt: now,
    updatedAt: now,
    plan: buildPlan({ ...input, kind, taskType }, now),
    permissions: defaultPermissions({ ...input, kind, taskType }),
    approvals: [],
    checkpoints: [],
    events: [],
    artifacts: [],
    toolResults: [],
    workspace: input.workspace || [],
  };
}

export function taskSnapshot(task: TaskRecord): TaskSnapshot {
  return { task, events: task.events, checkpoints: task.checkpoints, approvals: task.approvals };
}
