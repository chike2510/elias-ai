import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubTokenCandidates, healGitHubConnectionStore, rememberGitHubTokenCheck } from "@/lib/githubConnectionStore";

type GitHubRepo = { id: number; full_name: string; name: string; private: boolean; description?: string | null; html_url: string; default_branch?: string; language?: string | null; updated_at?: string; permissions?: { admin?: boolean; push?: boolean; pull?: boolean } };

const RECONNECT_MESSAGE = "GitHub no longer accepts the saved authorization. Reconnect GitHub to refresh it.";

export async function GET() {
  const session = await getSession();
  const candidates = await getGitHubTokenCandidates(session).catch(() => []);
  if (!session || !candidates.length) return NextResponse.json({ connected: false, reconnectRequired: false, repositories: [], message: "Connect GitHub for this Elias account first." }, { status: 401 });

  // Try every token we hold (durable store first, then the session copy). A 401 on one is not the end: the other may work.
  let lastFailure: { status: number; body: string } | undefined;
  for (const candidate of candidates) {
    const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${candidate.token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
    let response: Response;
    try {
      response = await fetch("https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated", { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch {
      lastFailure = { status: 502, body: "GitHub did not respond." };
      continue;
    }
    if (response.status === 401) { rememberGitHubTokenCheck(candidate.token, "invalid"); lastFailure = { status: 401, body: "" }; continue; }
    if (!response.ok) { lastFailure = { status: response.status, body: await response.text().catch(() => "") }; continue; }
    rememberGitHubTokenCheck(candidate.token, "valid");
    // The cookie copy worked where the stored row did not: write it back so background jobs (no cookie) use it too.
    if (candidate.source === "session") await healGitHubConnectionStore(session, candidate.token).catch(() => undefined);
    const grantedScopes = response.headers.get("x-oauth-scopes")?.split(",").map((scope) => scope.trim()).filter(Boolean) || [];
    const data = await response.json() as GitHubRepo[];
    // Classic OAuth tokens advertise `repo` in x-oauth-scopes. GitHub App user tokens usually do not; their effective permission is returned per repo.
    const writeReady = grantedScopes.includes("repo") || data.some((repo) => Boolean(repo.permissions?.push || repo.permissions?.admin));
    const workflowReady = grantedScopes.length === 0 || grantedScopes.includes("workflow");
    return NextResponse.json({
      connected: true, writeReady, workflowReady, reconnectRequired: !writeReady,
      message: writeReady ? (workflowReady ? "" : "Reconnect GitHub once to let Elias edit workflow files (.github/workflows).") : "Repository read access is connected, but commit access is not granted to any available repository.",
      repositories: data.map((repo) => ({ id: repo.id, fullName: repo.full_name, name: repo.name, private: repo.private, description: repo.description || "No description", url: repo.html_url, defaultBranch: repo.default_branch || "main", language: repo.language || "Unknown", updatedAt: repo.updated_at, canWrite: Boolean(repo.permissions?.push || repo.permissions?.admin) })),
    });
  }

  if (lastFailure?.status === 401) return NextResponse.json({ connected: false, reconnectRequired: true, repositories: [], message: RECONNECT_MESSAGE }, { status: 401 });
  const status = lastFailure?.status || 502;
  const message = `GitHub repository request failed (${status})${lastFailure?.body ? `: ${lastFailure.body.slice(0, 180)}` : "."}`;
  return NextResponse.json({ connected: true, reconnectRequired: false, repositories: [], message }, { status });
}
