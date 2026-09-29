import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";
import { loadGitHubRepositoryWorkspace, validRepositoryPart } from "@/lib/githubRepositoryWorkspace";
import { createGitHubRepositoryTaskRecord } from "@/lib/githubRepositoryTask";
import { createGitHubRepositoryTask } from "@/lib/githubRepositoryTaskStore";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ owner: string; repo: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in to start a repository task.", 401, "AUTH_REQUIRED");
    const token = await getGitHubToken(session);
    if (!token) return jsonError("Connect GitHub for this Elias account before starting a repository task.", 401, "GITHUB_AUTH_REQUIRED");

    const { owner, repo } = await context.params;
    if (!validRepositoryPart(owner) || !validRepositoryPart(repo)) return jsonError("A valid selected GitHub repository is required.", 400, "INVALID_REPOSITORY");
    const body = await readJsonRequest<{ objective?: unknown; branch?: unknown }>(request);
    if (typeof body.objective !== "string" || !body.objective.trim()) return jsonError("Describe what Elias should do in this repository.", 400, "INVALID_REQUEST");
    if (body.objective.length > 20_000) return jsonError("The repository task objective is too large.", 413, "PAYLOAD_TOO_LARGE");
    if (body.branch !== undefined && (typeof body.branch !== "string" || body.branch.length > 100)) return jsonError("Choose a valid repository branch.", 400, "INVALID_BRANCH");

    const workspace = await loadGitHubRepositoryWorkspace(token, owner, repo, typeof body.branch === "string" ? body.branch : undefined);
    const record = createGitHubRepositoryTaskRecord(session.userId, body.objective.trim(), workspace.repository, workspace.files);
    if (workspace.truncated) record.task.events.push({ id: `evt_${crypto.randomUUID()}`, taskId: record.id, kind: "tool", label: "Repository snapshot bounded", status: "completed", createdAt: Date.now(), detail: "The repository was larger than the task context limit. ELIAS received a prioritized subset of readable text files; the snapshot is visible in task evidence." });
    const saved = await createGitHubRepositoryTask(record);
    return jsonOk({ task: saved.task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start a repository task.";
    return jsonError(message, 400, "REPOSITORY_TASK_CREATE_FAILED");
  }
}
