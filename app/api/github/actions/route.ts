import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type ActionRequest = {
  action?: "create_branch" | "commit_file" | "commit_files" | "create_pull_request" | "create_issue" | "create_review_comment";
  owner?: string;
  repo?: string;
  branch?: string;
  base?: string;
  path?: string;
  content?: string;
  files?: Array<{ path?: string; content?: string }>;
  message?: string;
  title?: string;
  body?: string;
  head?: string;
  pullNumber?: number;
  commitId?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  confirm?: string;
};

const API = "https://api.github.com";

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function repoParts(input: ActionRequest) {
  const owner = input.owner?.trim() || "";
  const repo = input.repo?.trim() || "";
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("A valid GitHub owner and repository are required.");
  return { owner, repo };
}

function refName(value: string | undefined, label: string) {
  const result = value?.trim() || "";
  if (!/^[A-Za-z0-9._/-]+$/.test(result) || result.startsWith("/") || result.endsWith("/")) throw new Error(`${label} must be a valid branch name.`);
  return result;
}

async function githubFetch(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ELIAS",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body ? String((body as { message?: unknown }).message) : `GitHub request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as Record<string, unknown>;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.githubToken) return fail("Connect GitHub for this Elias account before using write actions.", 401);

  let input: ActionRequest;
  try { input = await request.json() as ActionRequest; } catch { return fail("Invalid JSON request."); }
  const action = input.action;
  if (!action) return fail("A GitHub write action is required.");
  if (input.confirm !== `CONFIRM_GITHUB_${action.toUpperCase()}`) {
    return fail(`Write blocked. Explicit confirmation is required: CONFIRM_GITHUB_${action.toUpperCase()}.`, 409);
  }

  try {
    const { owner, repo } = repoParts(input);
    if (action === "create_branch") {
      const base = refName(input.base || "main", "Base branch");
      const branch = refName(input.branch, "New branch");
      const source = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
      const sha = source.object && typeof source.object === "object" && "sha" in source.object ? String((source.object as { sha?: unknown }).sha) : "";
      if (!sha) throw new Error("Could not resolve the base branch commit.");
      const result = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
      return NextResponse.json({ ok: true, action, branch, ref: result.ref, message: `Created branch ${branch}.` });
    }

    if (action === "commit_file") {
      const branch = refName(input.branch || "main", "Target branch");
      const path = input.path?.trim().replace(/^\/+/, "") || "";
      const content = input.content ?? "";
      const message = input.message?.trim() || `Update ${path}`;
      if (!path || path.includes("..") || path.endsWith("/") || !content) throw new Error("A safe file path and non-empty content are required.");
      let sha: string | undefined;
      try {
        const current = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
        if (typeof current.sha === "string") sha = current.sha;
      } catch { /* A missing file is a valid create operation. */ }
      const result = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/contents/${path}`, { method: "PUT", body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
      const commit = result.commit && typeof result.commit === "object" ? result.commit as { sha?: string; html_url?: string } : {};
      return NextResponse.json({ ok: true, action, path, branch, commitSha: commit.sha, url: commit.html_url, message: `Committed ${path} to ${branch}.` });
    }

    if (action === "commit_files") {
      const branch = refName(input.branch || "main", "Target branch");
      const message = input.message?.trim() || "Update files from Elias";
      const files = Array.isArray(input.files) ? input.files : [];
      if (!files.length || files.length > 50) throw new Error("Between 1 and 50 files are required for an atomic commit.");
      const normalized = files.map((file) => {
        const path = file.path?.trim().replace(/^\/+/, "") || "";
        const content = file.content ?? "";
        if (!path || path.includes("..") || path.endsWith("/") || content.length > 1_000_000) throw new Error("Every committed file must have a safe path and content under 1 MB.");
        return { path, content };
      });
      if (normalized.reduce((total, file) => total + file.content.length, 0) > 5_000_000) throw new Error("The combined commit payload is too large.");
      const ref = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      const headSha = ref.object && typeof ref.object === "object" && "sha" in ref.object ? String((ref.object as { sha?: unknown }).sha) : "";
      if (!headSha) throw new Error("Could not resolve the target branch commit.");
      const headCommit = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/commits/${headSha}`);
      const baseTree = headCommit.tree && typeof headCommit.tree === "object" && "sha" in headCommit.tree ? String((headCommit.tree as { sha?: unknown }).sha) : "";
      if (!baseTree) throw new Error("Could not resolve the target tree.");
      const tree = [];
      for (const file of normalized) {
        const blob = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64" }) });
        if (typeof blob.sha !== "string") throw new Error(`Could not create a blob for ${file.path}.`);
        tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const createdTree = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) });
      if (typeof createdTree.sha !== "string") throw new Error("Could not create the commit tree.");
      const commit = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: createdTree.sha, parents: [headSha] }) });
      if (typeof commit.sha !== "string") throw new Error("Could not create the commit.");
      await githubFetch(session.githubToken, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
      return NextResponse.json({ ok: true, action, branch, commitSha: commit.sha, url: commit.html_url, files: normalized.map((file) => file.path), message: `Committed ${normalized.length} files to ${branch}.` });
    }

    if (action === "create_pull_request") {
      const head = refName(input.head, "Head branch");
      const base = refName(input.base || "main", "Base branch");
      const title = input.title?.trim() || "Elias change proposal";
      const result = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/pulls`, { method: "POST", body: JSON.stringify({ title, head, base, body: input.body?.trim() || "Created from Elias with explicit user confirmation." }) });
      return NextResponse.json({ ok: true, action, number: result.number, url: result.html_url, message: `Opened pull request ${result.number || ""}.` });
    }

    if (action === "create_issue") {
      const title = input.title?.trim() || "Elias review finding";
      const body = input.body?.trim() || "Created from Elias with explicit user confirmation.";
      const result = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/issues`, { method: "POST", body: JSON.stringify({ title, body }) });
      return NextResponse.json({ ok: true, action, number: result.number, url: result.html_url, message: `Created issue ${result.number || ""}.` });
    }

    if (action === "create_review_comment") {
      const pullNumber = Number(input.pullNumber);
      const commitId = input.commitId?.trim() || "";
      const path = input.path?.trim().replace(/^\/+/, "") || "";
      const line = Number(input.line);
      const side = input.side === "LEFT" ? "LEFT" : "RIGHT";
      const body = input.body?.trim() || "Elias review comment";
      if (!Number.isInteger(pullNumber) || pullNumber < 1 || !commitId || !path || !Number.isInteger(line) || line < 1) throw new Error("A pull request number, commit ID, file path, and positive line number are required.");
      const result = await githubFetch(session.githubToken, `/repos/${owner}/${repo}/pulls/${pullNumber}/comments`, { method: "POST", body: JSON.stringify({ body, commit_id: commitId, path, line, side }) });
      return NextResponse.json({ ok: true, action, id: result.id, url: result.html_url, message: "Posted the review comment." });
    }

    return fail("Unsupported GitHub write action.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "GitHub write action failed.", 502);
  }
}
