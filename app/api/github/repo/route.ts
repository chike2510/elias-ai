import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { rateLimitResponse, requestRateLimitIdentity, takeRateLimit } from "@/lib/rateLimit";

function parseRepo(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) throw new Error("Use a GitHub repository URL like https://github.com/owner/repo");
  const scp = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  let owner: string;
  let repo: string;
  if (scp) {
    [, owner, repo] = scp;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed.startsWith("github.com/") ? `https://${trimmed}` : trimmed);
    } catch {
      throw new Error("Use a GitHub repository URL like https://github.com/owner/repo");
    }
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.port || parsed.username || parsed.password) {
      throw new Error("Only GitHub repository URLs are supported.");
    }
    const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (segments.length !== 2) throw new Error("Use a GitHub repository URL like https://github.com/owner/repo");
    [owner, repo] = segments;
    repo = repo.replace(/\.git$/i, "");
  }
  if (owner.length > 39 || repo.length > 100 || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("The GitHub owner or repository name is invalid.");
  }
  return { owner, repo };
}

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const session = await getSession();
  const identity = requestRateLimitIdentity(request, session?.userId);
  const limit = takeRateLimit("public-github-repo", identity, 30, 60 * 60_000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  let parsed: { owner: string; repo: string };
  try {
    parsed = parseRepo(request.nextUrl.searchParams.get("url") || "");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid GitHub repository URL.", 400, "INVALID_REQUEST");
  }

  try {
    // This legacy lookup is intentionally public metadata only. Never apply a
    // server-level GITHUB_TOKEN here; private repository access belongs to the
    // separately authenticated, per-user GitHub connection routes.
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ELIAS",
    };
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return jsonError("Repository was not found or is not public.", 404, "NOT_FOUND");
    if (!response.ok) return jsonError(`GitHub public lookup failed (${response.status}).`, 502, "UPSTREAM_ERROR");
    const data = await response.json() as { default_branch?: string; private?: boolean; zipball_url?: string };
    if (data.private !== false) return jsonError("Repository was not found or is not public.", 404, "NOT_FOUND");
    return jsonOk({ owner: parsed.owner, repo: parsed.repo, defaultBranch: data.default_branch, private: false, archive: data.zipball_url });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub lookup failed.", 502, "UPSTREAM_ERROR");
  }
}
