import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";

function parseRepo(value: string) {
  const match = value.trim().replace(/\.git$/i, "").match(/github\.com[/:]([^/]+)\/([^/#?]+)$/i);
  if (!match) throw new Error("Use a GitHub repository URL like https://github.com/owner/repo");
  return { owner: match[1], repo: match[2] };
}

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { owner, repo } = parseRepo(request.nextUrl.searchParams.get("url") || "");
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ELIAS" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const raw = await response.text();
    if (!response.ok) throw new Error(`GitHub returned ${response.status}: ${raw.slice(0, 240)}`);
    const data = JSON.parse(raw) as { default_branch?: string; private?: boolean; zipball_url?: string };
    return jsonOk({ owner, repo, defaultBranch: data.default_branch, private: data.private, archive: data.zipball_url });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub lookup failed.");
  }
}
