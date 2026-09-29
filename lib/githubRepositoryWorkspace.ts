import type { WorkspaceFile } from "@/lib/types";

const API = "https://api.github.com";
const MAX_FILES = 48;
const MAX_FILE_CHARS = 160_000;
const MAX_TOTAL_CHARS = 1_200_000;
const FILE_BATCH_SIZE = 6;
const TEXT_FILE = /\.(?:md|mdx|txt|json|ya?ml|toml|ini|env\.example|js|jsx|ts|tsx|mjs|cjs|css|scss|html|xml|svg|py|rb|go|rs|java|kt|swift|php|sql|sh|bash|zsh|dockerfile|gitignore)$/i;
const SKIP_SEGMENTS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor", ".turbo"]);

export type RepositoryMetadata = {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  branch: string;
  commitSha: string;
  defaultBranch: string;
  private: boolean;
};

export type RepositoryWorkspace = {
  repository: RepositoryMetadata;
  files: WorkspaceFile[];
  truncated: boolean;
};

export type RepositoryFileChange = {
  path: string;
  status: "added" | "modified" | "deleted";
  before?: string;
  after?: string;
};

export function validRepositoryPart(value: string) {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
}

export function safeRepositoryPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) return null;
  if (normalized.split("/").some((part) => SKIP_SEGMENTS.has(part.toLowerCase()))) return null;
  return normalized;
}

export function isRepositoryTextPath(value: string) {
  const path = safeRepositoryPath(value);
  if (!path || !TEXT_FILE.test(path)) return false;
  const name = path.split("/").at(-1)!.toLowerCase();
  // Never hydrate live environment files or common credential/config dumps.
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
  return true;
}

function filePriority(path: string) {
  if (/^(readme(?:\.|$)|package\.json$|pnpm-lock\.yaml$|yarn\.lock$|package-lock\.json$|tsconfig\.json$|pyproject\.toml$)/i.test(path)) return 0;
  if (/^(app|src|lib|components|pages|server|client)\//i.test(path)) return 1;
  if (/(^|\/)(test|tests|__tests__|spec|specs)(\/|\.)/i.test(path)) return 2;
  return 3;
}

export function changedRepositoryFiles(baseFiles: WorkspaceFile[], currentFiles: WorkspaceFile[]): RepositoryFileChange[] {
  const before = new Map(baseFiles.map((file) => [file.path, file.content]));
  const after = new Map(currentFiles.map((file) => [file.path, file.content]));
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].sort().reduce<RepositoryFileChange[]>((changes, path) => {
    const oldContent = before.get(path);
    const newContent = after.get(path);
    if (oldContent === newContent) return changes;
    if (oldContent === undefined) changes.push({ path, status: "added", after: newContent ?? "" });
    else if (newContent === undefined) changes.push({ path, status: "deleted", before: oldContent });
    else changes.push({ path, status: "modified", before: oldContent, after: newContent });
    return changes;
  }, []);
}

function apiHeaders(token: string) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" };
}

async function githubJson(url: string, token: string) {
  const response = await fetch(url, { headers: apiHeaders(token), cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`GitHub repository read failed (${response.status}).`);
  return await response.json() as Record<string, unknown>;
}

export async function loadGitHubRepositoryWorkspace(token: string, owner: string, repo: string, requestedBranch?: string): Promise<RepositoryWorkspace> {
  if (!validRepositoryPart(owner) || !validRepositoryPart(repo)) throw new Error("Choose a valid GitHub repository.");
  if (requestedBranch && (!/^[A-Za-z0-9._/-]{1,100}$/.test(requestedBranch) || requestedBranch.startsWith("/") || requestedBranch.endsWith("/") || requestedBranch.split("/").some((part) => !part || part === "." || part === ".."))) {
    throw new Error("Choose a valid repository branch.");
  }

  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = await githubJson(base, token) as { full_name?: string; default_branch?: string; private?: boolean; html_url?: string };
  const fullName = typeof repository.full_name === "string" ? repository.full_name : `${owner}/${repo}`;
  const branch = requestedBranch || repository.default_branch || "main";
  const reference = await githubJson(`${base}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, token) as { object?: { sha?: string } };
  const commitSha = typeof reference.object?.sha === "string" ? reference.object.sha : "";
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("GitHub did not return a valid commit for the selected repository branch.");
  const tree = await githubJson(`${base}/git/trees/${commitSha}?recursive=1`, token) as { truncated?: boolean; tree?: Array<{ path?: string; type?: string; size?: number }> };
  const textFiles = (tree.tree || []).filter((item): item is { path: string; type: string; size?: number } => item.type === "blob" && typeof item.path === "string" && isRepositoryTextPath(item.path));
  let truncated = Boolean(tree.truncated) || textFiles.length > MAX_FILES || textFiles.some((item) => (item.size ?? 0) > MAX_FILE_CHARS);
  const candidates = textFiles
    .filter((item) => (item.size ?? 0) <= MAX_FILE_CHARS)
    .sort((left, right) => filePriority(left.path) - filePriority(right.path) || left.path.localeCompare(right.path))
    .slice(0, MAX_FILES);

  const files: WorkspaceFile[] = [];
  let totalChars = 0;
  for (let start = 0; start < candidates.length && totalChars < MAX_TOTAL_CHARS; start += FILE_BATCH_SIZE) {
    const batch = await Promise.all(candidates.slice(start, start + FILE_BATCH_SIZE).map(async ({ path }) => {
      try {
        const file = await githubJson(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(commitSha)}`, token) as { type?: string; content?: string; encoding?: string };
        if (file.type !== "file" || typeof file.content !== "string") return undefined;
        const content = file.encoding === "base64" ? Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8") : file.content;
        if (content.length > MAX_FILE_CHARS) return undefined;
        return { path, content, size: content.length };
      } catch { return undefined; }
    }));
    for (const file of batch) {
      if (!file) { truncated = true; continue; }
      if (totalChars + file.content.length > MAX_TOTAL_CHARS) { truncated = true; continue; }
      files.push(file);
      totalChars += file.content.length;
    }
  }
  if (!files.length) throw new Error(`No readable text files were returned for ${fullName}; ELIAS did not create an empty repository task.`);

  return {
    repository: {
      owner,
      repo,
      fullName,
      url: typeof repository.html_url === "string" ? repository.html_url : `https://github.com/${owner}/${repo}`,
      branch,
      commitSha,
      defaultBranch: typeof repository.default_branch === "string" ? repository.default_branch : "main",
      private: Boolean(repository.private),
    },
    files,
    truncated: truncated || candidates.length > files.length || totalChars >= MAX_TOTAL_CHARS,
  };
}
