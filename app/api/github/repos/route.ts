import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";

export async function GET() {
  const session = await getSession();
  const token = await getGitHubToken(session);
  if (!token) return NextResponse.json({ connected: false, repositories: [], message: "Connect GitHub for this Elias account first." }, { status: 401 });
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
  const response = await fetch("https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated", {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = response.status === 401 ? "GitHub authorization expired or was replaced. Reconnect GitHub to refresh it." : `GitHub repository request failed (${response.status})${body ? `: ${body.slice(0, 180)}` : "."}`;
    return NextResponse.json({ connected: false, repositories: [], message }, { status: response.status });
  }
  const grantedScopes = response.headers.get("x-oauth-scopes")?.split(",").map((scope) => scope.trim()).filter(Boolean) || [];
  const data = await response.json() as Array<{ id: number; full_name: string; name: string; private: boolean; description?: string | null; html_url: string; default_branch?: string; language?: string | null; updated_at?: string; permissions?: { admin?: boolean; push?: boolean; pull?: boolean } }>;
  // Classic OAuth tokens advertise `repo` in x-oauth-scopes. GitHub App user tokens usually do not; their effective permission is returned per repo.
  const writeReady = grantedScopes.includes("repo") || data.some((repo) => Boolean(repo.permissions?.push || repo.permissions?.admin));
  return NextResponse.json({ connected: true, writeReady, reconnectRequired: !writeReady, message: writeReady ? "" : "Repository read access is connected, but commit access is not granted to any available repository.", repositories: data.map((repo) => ({ id: repo.id, fullName: repo.full_name, name: repo.name, private: repo.private, description: repo.description || "No description", url: repo.html_url, defaultBranch: repo.default_branch || "main", language: repo.language || "Unknown", updatedAt: repo.updated_at, canWrite: Boolean(repo.permissions?.push || repo.permissions?.admin) })) });
}
