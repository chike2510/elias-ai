import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGitHubToken } from "@/lib/githubConnectionStore";

export async function GET(_: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const session = await getSession();
  const token = await getGitHubToken(session);
  if (!token) return NextResponse.json({ message: "Connect GitHub for this Elias account first." }, { status: 401 });
  const { owner, repo } = await params;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [repositoryResponse, commitsResponse] = await Promise.all([
    fetch(base, { headers, cache: "no-store" }),
    fetch(`${base}/commits?per_page=6`, { headers, cache: "no-store" }),
  ]);
  if (!repositoryResponse.ok) return NextResponse.json({ message: `GitHub repository request failed (${repositoryResponse.status}).` }, { status: repositoryResponse.status });
  const repository = await repositoryResponse.json() as { id: number; full_name: string; name: string; description?: string | null; private: boolean; html_url: string; default_branch?: string; language?: string | null; stargazers_count?: number; open_issues_count?: number; pushed_at?: string };
  const commits = commitsResponse.ok ? await commitsResponse.json() as Array<{ sha: string; html_url: string; commit?: { message?: string; author?: { name?: string; date?: string } } }> : [];
  return NextResponse.json({ repository: { id: repository.id, fullName: repository.full_name, name: repository.name, description: repository.description || "No description", private: repository.private, url: repository.html_url, defaultBranch: repository.default_branch || "main", language: repository.language || "Unknown", stars: repository.stargazers_count || 0, openIssues: repository.open_issues_count || 0, pushedAt: repository.pushed_at }, commits: commits.map((commit) => ({ sha: commit.sha, url: commit.html_url, message: (commit.commit?.message || "Commit").split("\n")[0], author: commit.commit?.author?.name || "GitHub user", date: commit.commit?.author?.date })) });
}
