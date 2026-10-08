import { NextRequest } from "next/server";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";
import { ensureConversation } from "@/lib/assistant/agent";
import { allPaths, discardCodeSet, getCodeSet, openSet, readCurrent, setDiff, type CodeSet } from "@/lib/assistant/code/github";
import { postgresCodeStore } from "@/lib/assistant/code/store";
import { MAX_ATTEMPTS, verifySession } from "@/lib/assistant/code/verify";

export const runtime = "nodejs";
export const maxDuration = 300;

function view(set: CodeSet | null) {
  if (!set) return { set: null };
  const diff = setDiff(set);
  return {
    set: { repo: set.repo, baseBranch: set.baseBranch, branch: set.branch, baseSha: set.baseSha, commits: set.commits.slice(-10), prNumber: set.prNumber, verify: set.verify, maxAttempts: MAX_ATTEMPTS, updatedAt: set.updatedAt },
    files: diff.files, diff: diff.diff.length > 200_000 ? `${diff.diff.slice(0, 200_000)}\n… (truncated)` : diff.diff, added: diff.added, removed: diff.removed,
  };
}

/** GET ?conversationId= : the code chat's working set, staged diff and CI state. Without it: the most recent workspace. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const conversationId = request.nextUrl.searchParams.get("conversationId") || "";
  try {
    if (!conversationId) {
      const latest = await postgresCodeStore.latest(auth.userId);
      return jsonOk({ conversationId: latest?.conversationId || null, ...view(latest) });
    }
    return jsonOk({ conversationId, ...view(await getCodeSet(auth.userId, conversationId)) });
  }
  catch (error) { return jsonError(reportError(error, "code/state", auth.userId), 500, "CODE_STATE_FAILED"); }
}

type Body = { action?: "open" | "verify" | "discard" | "tree" | "read"; conversationId?: string; repo?: string; base?: string; path?: string; timezone?: string };

/**
 * POST { action: "open", repo, base?, conversationId? } opens a repo (creating a code conversation when needed);
 * { action: "verify", conversationId } runs one verify step (Run checks); { action: "discard", conversationId, path? } drops staged changes;
 * { action: "tree" } lists files (staged changes applied); { action: "read", path } returns one file's current text.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  let body: Body;
  try { body = await readJsonRequest<Body>(request); } catch (error) { return jsonError(String((error as Error).message), 400, "BAD_REQUEST"); }
  try {
    if (body.action === "open") {
      if (!body.repo) return jsonError("Pick a repo.", 400, "BAD_REQUEST");
      const conversationId = await ensureConversation(auth.userId, body.conversationId, `Code: ${body.repo}`, "code");
      const session = await openSet({ userId: auth.userId, conversationId, timezone: body.timezone || "Africa/Lagos", githubToken: auth.githubToken }, body.repo, body.base);
      return jsonOk({ conversationId, ...view(session.set) });
    }
    if (!body.conversationId) return jsonError("conversationId is required.", 400, "BAD_REQUEST");
    if (body.action === "verify") {
      const session = await openSet({ userId: auth.userId, conversationId: body.conversationId, timezone: body.timezone || "Africa/Lagos", githubToken: auth.githubToken });
      const result = await verifySession(session, { waitMs: 45_000 });
      return jsonOk({ result, ...view(session.set) });
    }
    if (body.action === "discard") return jsonOk(view(await discardCodeSet(auth.userId, body.conversationId, body.path)));
    if (body.action === "tree" || body.action === "read") {
      const session = await openSet({ userId: auth.userId, conversationId: body.conversationId, timezone: body.timezone || "Africa/Lagos", githubToken: auth.githubToken });
      if (body.action === "tree") {
        const { paths, truncated } = await allPaths(session);
        return jsonOk({ paths: paths.filter((path) => !/(^|\/)(node_modules|\.git|\.next)\//.test(path)).slice(0, 5000), truncated, staged: Object.keys(session.set.files) });
      }
      const path = (body.path || "").replace(/^\/+/, "");
      const text = await readCurrent(session, path);
      if (text === null) return jsonError(`${path} doesn't exist.`, 404, "NOT_FOUND");
      return jsonOk({ path, content: text.length > 300_000 ? `${text.slice(0, 300_000)}\n… (truncated)` : text, staged: Boolean(session.set.files[path]) });
    }
    return jsonError("Unknown action.", 400, "BAD_REQUEST");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/GitHub isn't connected|authorization expired|uncommitted|Nothing pushed|isn't a repo|GitHub 40[134]/.test(message)) return jsonError(message, 409, "CODE_BLOCKED");
    return jsonError(reportError(error, "code/state:post", auth.userId), 500, "CODE_ACTION_FAILED");
  }
}
