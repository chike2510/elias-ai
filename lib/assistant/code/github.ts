/**
 * Repo tools for the coding agent. Reads come from GitHub (git trees + blobs, cached by sha);
 * every edit is staged in a per-conversation working set (elias_code_sets) until code_commit
 * writes it as one commit through the git data API. code_commit may create and push to new
 * elias/* branches without approval; any other branch needs the user's go-ahead.
 *
 * Testable without a network or database: setGithubFetch() swaps the HTTP layer and
 * setCodeStore() swaps the store (tests use an in-memory one).
 */
import { applyEdits, applyHunks, contentFromNewFile, diffStats, parseUnifiedDiff, unifiedDiff, type Edit } from "./patch";

type Args = Record<string, unknown>;
/** Structural copy of tools.ts ToolContext/Tool so this module stays import-free for tests. */
export type CodeToolContext = { userId: string; conversationId: string; timezone: string; githubToken?: string; approved?: boolean; origin?: string };
export type CodeTool = {
  schema: { name: string; description: string; parameters: Record<string, unknown> };
  needsApproval?: (args: Args, ctx: CodeToolContext) => Promise<string | null> | string | null;
  run: (args: Args, ctx: CodeToolContext) => Promise<unknown>;
};

/** One staged file: original null = created in this set; content null = deleted. */
export type CodeFile = { original: string | null; content: string | null };
export type VerifyState = { status: "running" | "passed" | "failed" | "error"; attempt: number; sha: string; summary: string; runUrl?: string; previewUrl?: string; failures?: string[]; at: string };
export type CodeSet = {
  id: string; userId: string; conversationId: string; repo: string;
  baseBranch: string; baseSha: string; branch: string | null; branchCreated: boolean;
  files: Record<string, CodeFile>; commits: Array<{ sha: string; message: string; at: string; files: number }>;
  prNumber: number | null; verify: VerifyState | null; updatedAt: string;
};
export type CodeStore = {
  get(userId: string, conversationId: string): Promise<CodeSet | null>;
  latest(userId: string): Promise<CodeSet | null>;
  save(set: CodeSet): Promise<void>;
  remove(userId: string, conversationId: string): Promise<void>;
};

/* ---------------- plumbing ---------------- */

let fetcher: typeof fetch | null = null;
let store: CodeStore | null = null;
export function setGithubFetch(next: typeof fetch | null) { fetcher = next; }
export function setCodeStore(next: CodeStore | null) { store = next; }

async function codeStore(): Promise<CodeStore> {
  if (store) return store;
  const mod = await import("@/lib/assistant/code/store");
  return mod.postgresCodeStore;
}

const apiBase = () => (process.env.ELIAS_GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const str = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });
const REPO_ARG = s("owner/repo, e.g. chike2510/elias-ai. Optional after the first call in this chat.");

export class GithubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function resolveToken(ctx: { userId: string; githubToken?: string }) {
  if (ctx.githubToken) return ctx.githubToken;
  if (process.env.ELIAS_GITHUB_TEST_TOKEN) return process.env.ELIAS_GITHUB_TEST_TOKEN;
  try {
    const { getGitHubConnection } = await import("@/lib/githubConnectionStore");
    const connection = await getGitHubConnection(ctx.userId);
    if (connection?.token) return connection.token;
  } catch { /* store unavailable */ }
  throw new Error("GitHub isn't connected. Ask the user to connect GitHub (repository access) in You > Connections, then try again.");
}

export async function gh<T = unknown>(token: string, method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<T> {
  const doFetch = fetcher || fetch;
  const response = await doFetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: accept, "User-Agent": "Elias", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  } as RequestInit);
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 300);
    try { message = (JSON.parse(text) as { message?: string }).message || message; } catch { /* not json */ }
    const hint = response.status === 401 ? " (GitHub authorization expired: ask the user to reconnect GitHub)" : response.status === 404 ? " (not found, or the GitHub connection can't see this repo)" : "";
    throw new GithubError(response.status, `GitHub ${response.status} on ${method} ${path.split("?")[0]}: ${message}${hint}`);
  }
  if (accept.includes("raw")) return text as T;
  return (text ? JSON.parse(text) : {}) as T;
}

export function parseRepo(value: string) {
  const cleaned = value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error(`"${value}" isn't a repo. Use owner/repo, e.g. chike2510/elias-ai.`);
  return { owner: match[1], name: match[2], full: `${match[1]}/${match[2]}` };
}

export function cleanPath(value: string) {
  const path = value.trim().replace(/^\.?\//, "");
  if (!path || path.split("/").some((part) => part === ".." || part === "") || path.startsWith(".git/")) throw new Error(`Invalid file path "${value}".`);
  return path;
}

/** elias/<words>-<4 chars>; also validates a branch the model supplies. */
export function branchName(hint: string) {
  const slug = hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "change";
  return `elias/${slug}-${Math.random().toString(36).slice(2, 6)}`;
}
export const isEliasBranch = (branch: string) => /^elias\/[A-Za-z0-9._\/-]+$/.test(branch) && !branch.includes("..") && !branch.endsWith("/") && !branch.endsWith(".lock");

/* ---------------- caches ---------------- */

type TreeEntry = { path: string; sha: string; size: number; type: string };
const treeCache = new Map<string, { entries: Map<string, TreeEntry>; truncated: boolean }>();
const blobCache = new Map<string, string>();
const cacheSet = <V>(map: Map<string, V>, key: string, value: V, cap: number) => { map.set(key, value); if (map.size > cap) map.delete(map.keys().next().value as string); };
export function clearCodeCaches() { treeCache.clear(); blobCache.clear(); }

async function treeOf(token: string, repo: string, sha: string) {
  const key = `${repo}@${sha}`;
  const hit = treeCache.get(key);
  if (hit) return hit;
  const data = await gh<{ tree: TreeEntry[]; truncated?: boolean }>(token, "GET", `/repos/${repo}/git/trees/${sha}?recursive=1`);
  const entries = new Map<string, TreeEntry>();
  for (const item of data.tree || []) if (item.type === "blob") entries.set(item.path, item);
  const value = { entries, truncated: Boolean(data.truncated) };
  cacheSet(treeCache, key, value, 20);
  return value;
}

async function blob(token: string, repo: string, sha: string) {
  const hit = blobCache.get(sha);
  if (hit !== undefined) return hit;
  const text = await gh<string>(token, "GET", `/repos/${repo}/git/blobs/${sha}`, undefined, "application/vnd.github.raw");
  cacheSet(blobCache, sha, text, 400);
  return text;
}

/* ---------------- working set ---------------- */

export type Session = { token: string; set: CodeSet; store: CodeStore };

async function headOf(token: string, repo: string, branch: string) {
  const data = await gh<{ commit: { sha: string } }>(token, "GET", `/repos/${repo}/branches/${encodeURIComponent(branch).replace(/%2F/g, "/")}`);
  return data.commit.sha;
}

/** The conversation's working set, created (or switched, when nothing is staged) for `repoArg`. */
export async function openSet(ctx: CodeToolContext, repoArg?: string, baseArg?: string): Promise<Session> {
  const token = await resolveToken(ctx);
  const st = await codeStore();
  let set = await st.get(ctx.userId, ctx.conversationId);
  const wanted = repoArg ? parseRepo(repoArg).full : null;
  if (set && wanted && set.repo.toLowerCase() !== wanted.toLowerCase()) {
    if (Object.keys(set.files).length) throw new Error(`This chat has ${Object.keys(set.files).length} uncommitted change(s) in ${set.repo}. Commit them (code_commit) or ask the user to discard them before switching to ${wanted}.`);
    set = null;
  }
  if (!set) {
    if (!wanted) throw new Error("Which repo? Pass repo as owner/repo.");
    const info = await gh<{ default_branch: string; full_name: string }>(token, "GET", `/repos/${wanted}`);
    const base = str(baseArg, info.default_branch);
    set = {
      id: `cs_${Math.random().toString(36).slice(2, 12)}`, userId: ctx.userId, conversationId: ctx.conversationId, repo: info.full_name || wanted,
      baseBranch: base, baseSha: await headOf(token, info.full_name || wanted, base), branch: null, branchCreated: false,
      files: {}, commits: [], prNumber: null, verify: null, updatedAt: new Date().toISOString(),
    };
    await st.save(set);
  }
  return { token, set, store: st };
}

/** Current text of a path in the working set (staged change first, then the base commit). null = absent. */
export async function readCurrent(session: Session, path: string): Promise<string | null> {
  const staged = session.set.files[path];
  if (staged) return staged.content;
  const tree = await treeOf(session.token, session.set.repo, session.set.baseSha);
  const entry = tree.entries.get(path);
  if (!entry) return null;
  return blob(session.token, session.set.repo, entry.sha);
}

async function readOriginal(session: Session, path: string) {
  const staged = session.set.files[path];
  if (staged) return staged.original;
  return readCurrent(session, path);
}

const MAX_FILE = 400_000;
const MAX_SET = 2_000_000;

/** Stages new content for a path (null deletes). Drops the entry when it's back to the original. */
async function stage(session: Session, path: string, content: string | null) {
  if (content !== null && content.length > MAX_FILE) throw new Error(`${path} would be ${content.length} chars; files over ${MAX_FILE} can't be edited here.`);
  const original = await readOriginal(session, path);
  if (original === content) delete session.set.files[path];
  else session.set.files[path] = { original, content };
  const total = Object.values(session.set.files).reduce((sum, file) => sum + (file.content?.length || 0) + (file.original?.length || 0), 0);
  if (total > MAX_SET) throw new Error("The working set is too large; commit what you have first.");
  session.set.updatedAt = new Date().toISOString();
  await session.store.save(session.set);
}

export async function allPaths(session: Session) {
  const tree = await treeOf(session.token, session.set.repo, session.set.baseSha);
  const paths = new Set(tree.entries.keys());
  for (const [path, file] of Object.entries(session.set.files)) { if (file.content === null) paths.delete(path); else paths.add(path); }
  return { paths: [...paths].sort(), truncated: tree.truncated, sizes: tree.entries };
}

export function setDiff(set: CodeSet, only?: string) {
  const files = Object.entries(set.files).filter(([path]) => !only || path === only).sort(([a], [b]) => a.localeCompare(b));
  const parts = files.map(([path, file]) => ({ path, status: file.original === null ? "added" : file.content === null ? "deleted" : "modified", diff: unifiedDiff(path, file.original, file.content) }));
  const diff = parts.map((part) => part.diff).join("");
  return { files: parts.map((part) => ({ path: part.path, status: part.status, ...diffStats(part.diff) })), diff, ...diffStats(diff) };
}

/* ---------------- grep ---------------- */

const SKIP_DIR = /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|vendor|\.vercel)\//;
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|mov|wasm|lock|bin|exe|dll|so|jar|class|pyc)$/i;
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig\.tsbuildinfo)$/;

function globToRegex(glob: string) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function pathFilter(path?: string) {
  if (!path) return () => true;
  if (/[*?]/.test(path)) { const re = globToRegex(path.replace(/^\.?\//, "")); return (candidate: string) => re.test(candidate); }
  const prefix = path.replace(/^\.?\//, "").replace(/\/$/, "");
  return (candidate: string) => candidate === prefix || candidate.startsWith(`${prefix}/`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const index = next++; out[index] = await fn(items[index]); } }));
  return out;
}

/* ---------------- tools ---------------- */

const GREP_FILE_CAP = 150;

export const CODE_TOOLS: Record<string, CodeTool> = {
  repo_tree: {
    schema: { name: "repo_tree", description: "List files in a GitHub repo (working-set changes included). Call this first with repo to open the repo for this chat. Filter with path (folder or glob like 'app/**/*.tsx').", parameters: obj({ repo: REPO_ARG, path: s("Folder prefix or glob (optional)"), base: s("Base branch when opening the repo (default: the repo's default branch)") }) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined, str(args.base) || undefined);
      const { paths, truncated } = await allPaths(session);
      const keep = pathFilter(str(args.path) || undefined);
      const matched = paths.filter((path) => keep(path) && !SKIP_DIR.test(path));
      const staged = Object.keys(session.set.files);
      return { repo: session.set.repo, base: session.set.baseBranch, branch: session.set.branch, total: matched.length, files: matched.slice(0, 600), more: Math.max(0, matched.length - 600), truncated, staged };
    },
  },
  repo_grep: {
    schema: { name: "repo_grep", description: "Search file contents in the repo (working-set changes included). Returns path:line matches. Narrow with path for big repos.", parameters: obj({ repo: REPO_ARG, pattern: s("Text or regular expression"), regex: { type: "boolean", description: "Treat pattern as a regex (default false: literal)" }, ignore_case: { type: "boolean" }, path: s("Folder prefix or glob (optional)") }, ["pattern"]) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const pattern = typeof args.pattern === "string" ? args.pattern : "";
      if (!pattern) throw new Error("pattern is required");
      const flags = args.ignore_case ? "i" : "";
      const re = args.regex ? new RegExp(pattern, flags) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      const { paths, sizes } = await allPaths(session);
      const keep = pathFilter(str(args.path) || undefined);
      let candidates = paths.filter((path) => keep(path) && !SKIP_DIR.test(path) && !BINARY.test(path) && !LOCKFILE.test(path) && (sizes.get(path)?.size ?? 0) <= 300_000);
      let narrowed = false;
      if (candidates.length > GREP_FILE_CAP && !args.regex) {
        // Big repo: let GitHub code search pick candidate files (default branch index), then grep them exactly.
        try {
          const found = await gh<{ items: Array<{ path: string }> }>(session.token, "GET", `/search/code?q=${encodeURIComponent(`${pattern} repo:${session.set.repo}`)}&per_page=100`);
          const hits = new Set((found.items || []).map((item) => item.path));
          for (const path of Object.keys(session.set.files)) hits.add(path);
          candidates = candidates.filter((path) => hits.has(path));
          narrowed = true;
        } catch { /* search unavailable: fall through to a capped scan */ }
      }
      const scanned = candidates.slice(0, GREP_FILE_CAP);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      const texts = await mapLimit(scanned, 8, async (path) => ({ path, text: await readCurrent(session, path).catch(() => null) }));
      for (const { path, text } of texts) {
        if (text === null || matches.length >= 80) continue;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && matches.length < 80; i += 1) if (re.test(lines[i])) matches.push({ path, line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
      return { pattern, matches, scannedFiles: scanned.length, candidateFiles: candidates.length, narrowedBySearch: narrowed, note: candidates.length > GREP_FILE_CAP ? `Only the first ${GREP_FILE_CAP} of ${candidates.length} files were scanned; pass path to narrow.` : undefined };
    },
  },
  repo_read: {
    schema: { name: "repo_read", description: "Read a file from the repo (staged edits included). Lines are numbered for reference only; never copy the numbers into edits. Use start_line/end_line for big files.", parameters: obj({ repo: REPO_ARG, path: s("File path"), start_line: { type: "number" }, end_line: { type: "number" } }, ["path"]) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const path = cleanPath(str(args.path));
      const text = await readCurrent(session, path);
      if (text === null) {
        const { paths } = await allPaths(session);
        const base = path.split("/").pop() || path;
        const similar = paths.filter((candidate) => candidate.endsWith(`/${base}`) || candidate === base).slice(0, 5);
        throw new Error(`${path} doesn't exist in ${session.set.repo}@${session.set.branch || session.set.baseBranch}.${similar.length ? ` Did you mean: ${similar.join(", ")}?` : ""}`);
      }
      const lines = text.split("\n");
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
      let end = Math.min(lines.length, Math.floor(Number(args.end_line) || start + 399));
      let body = "";
      for (let i = start; i <= end; i += 1) {
        const next = `${String(i).padStart(4)}| ${lines[i - 1]}\n`;
        if (body.length + next.length > 12_000) { end = i - 1; break; }
        body += next;
      }
      return { path, staged: Boolean(session.set.files[path]), lines: `${start}-${end} of ${lines.length}`, more: end < lines.length ? `Call again with start_line=${end + 1} for the rest.` : undefined, content: body };
    },
  },
  code_edit: {
    schema: { name: "code_edit", description: "Edit a file with exact find/replace pairs (staged, not committed). Copy find text exactly from repo_read without line numbers; include enough lines to be unique. All edits apply or none do.", parameters: obj({ repo: REPO_ARG, path: s("File path"), edits: { type: "array", items: obj({ find: s("Exact existing text"), replace: s("Replacement text"), all: { type: "boolean", description: "Replace every occurrence" } }, ["find", "replace"]) } }, ["path", "edits"]) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const path = cleanPath(str(args.path));
      const current = await readCurrent(session, path);
      if (current === null) throw new Error(`${path} doesn't exist; use code_create_file for new files.`);
      const edits = (Array.isArray(args.edits) ? args.edits : []) as Edit[];
      if (!edits.length) throw new Error("edits must be a non-empty array of {find, replace}");
      const result = applyEdits(current, edits);
      if (!result.ok) return { ok: false, path, error: result.error, conflicts: result.conflicts };
      await stage(session, path, result.content);
      return { ok: true, path, applied: result.applied, notes: result.notes, ...diffStats(unifiedDiff(path, current, result.content)) };
    },
  },
  code_patch: {
    schema: { name: "code_patch", description: "Apply a unified diff (one or more files, git style) to the working set. Context is matched fuzzily; new and deleted files are supported. All files apply or none do.", parameters: obj({ repo: REPO_ARG, diff: s("Unified diff text") }, ["diff"]) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const patches = parseUnifiedDiff(str(args.diff));
      if (!patches.length) throw new Error("No file hunks found in diff. Use ---/+++ headers and @@ hunks.");
      const planned: Array<{ path: string; content: string | null; from?: string }> = [];
      const notes: string[] = [];
      for (const patch of patches) {
        const target = patch.newPath ?? patch.oldPath;
        if (!target) return { ok: false, error: "A file in the diff has no path; add --- a/path and +++ b/path headers." };
        const path = cleanPath(target);
        if (patch.newPath === null) { planned.push({ path: cleanPath(patch.oldPath as string), content: null }); continue; }
        const sourcePath = patch.oldPath ? cleanPath(patch.oldPath) : null;
        const current = sourcePath ? await readCurrent(session, sourcePath) : null;
        if (current === null) {
          if (sourcePath && patch.oldPath !== null) return { ok: false, path: sourcePath, error: `${sourcePath} doesn't exist; for a new file use --- /dev/null.` };
          if (await readCurrent(session, path) !== null) return { ok: false, path, error: `${path} already exists; diff it against the current file instead of /dev/null.` };
          planned.push({ path, content: contentFromNewFile(patch.hunks) });
          continue;
        }
        const result = applyHunks(current, patch.hunks);
        if (!result.ok) return { ok: false, path, error: result.error, conflicts: result.conflicts, hint: "Nothing was applied. repo_read the file and regenerate the hunk, or use code_edit." };
        notes.push(...result.notes.map((note) => `${path}: ${note}`));
        planned.push({ path, content: result.content, from: sourcePath && sourcePath !== path ? sourcePath : undefined });
      }
      for (const item of planned) {
        if (item.from) await stage(session, item.from, null);
        await stage(session, item.path, item.content);
      }
      const diff = setDiff(session.set);
      return { ok: true, files: planned.map((item) => ({ path: item.path, status: item.content === null ? "deleted" : "changed" })), notes, totals: { added: diff.added, removed: diff.removed } };
    },
  },
  code_create_file: {
    schema: { name: "code_create_file", description: "Create a new file in the working set (or overwrite one when overwrite=true).", parameters: obj({ repo: REPO_ARG, path: s("New file path"), content: s("Full file content"), overwrite: { type: "boolean" } }, ["path", "content"]) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const path = cleanPath(str(args.path));
      const content = typeof args.content === "string" ? args.content : "";
      const existing = await readCurrent(session, path);
      if (existing !== null && !args.overwrite) throw new Error(`${path} already exists. Use code_edit, or set overwrite=true to replace it.`);
      await stage(session, path, content.endsWith("\n") || !content ? content : `${content}\n`);
      return { ok: true, path, created: existing === null, lines: content.split("\n").length };
    },
  },
  code_delete_file: {
    schema: { name: "code_delete_file", description: "Delete a file in the working set (staged until commit).", parameters: obj({ repo: REPO_ARG, path: s("File path") }, ["path"]) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const path = cleanPath(str(args.path));
      if (await readCurrent(session, path) === null) throw new Error(`${path} doesn't exist.`);
      await stage(session, path, null);
      return { ok: true, path, deleted: true };
    },
  },
  code_diff: {
    schema: { name: "code_diff", description: "Show the staged changes as a unified diff with per-file stats (the user sees a diff card).", parameters: obj({ repo: REPO_ARG, path: s("Only this file (optional)") }) },
    run: async (args, ctx) => {
      const session = await openSet(ctx, str(args.repo) || undefined);
      const result = setDiff(session.set, str(args.path) ? cleanPath(str(args.path)) : undefined);
      return { repo: session.set.repo, base: session.set.baseBranch, branch: session.set.branch, ...result, diff: result.diff.length > 11_000 ? `${result.diff.slice(0, 11_000)}\n... (diff truncated; pass path to see one file)` : result.diff };
    },
  },
  code_commit: {
    schema: { name: "code_commit", description: "Commit every staged change as one commit and push it. With no branch, creates a new elias/<name> branch (no approval needed). Pushing to any non-elias/ branch, or an elias/ branch this chat didn't create, waits for the user's approval.", parameters: obj({ repo: REPO_ARG, message: s("Commit message: imperative summary line, optional body"), branch: s("Target branch (optional; default: this chat's elias/ branch, or a new one)") }, ["message"]) },
    needsApproval: async (args, ctx) => {
      const st = await codeStore();
      const set = await st.get(ctx.userId, ctx.conversationId);
      const branch = str(args.branch) || set?.branch || "";
      if (!branch || (set && branch === set.branch && set.branchCreated)) return null;
      const count = set ? Object.keys(set.files).length : 0;
      if (!isEliasBranch(branch)) return `Push a commit (${count} file${count === 1 ? "" : "s"}) straight to ${set?.repo || "the repo"} branch "${branch}"\nMessage: ${str(args.message)}`;
      if (!set) return null;
      try {
        await headOf(await resolveToken(ctx), set.repo, branch);
        return `Push a commit (${count} file${count === 1 ? "" : "s"}) to the existing branch "${branch}" in ${set.repo}\nMessage: ${str(args.message)}`;
      } catch (error) {
        if (error instanceof GithubError && error.status === 404) return null; // new elias/ branch
        throw error;
      }
    },
    run: async (args, ctx) => commitSet(await openSet(ctx, str(args.repo) || undefined), str(args.message), str(args.branch) || undefined, Boolean(ctx.approved)),
  },
};

/** Writes the staged changes as one commit (git data API) and moves/creates the branch ref. */
export async function commitSet(session: Session, message: string, branchArg: string | undefined, approved: boolean) {
  const { token, set } = session;
  const paths = Object.keys(set.files).sort();
  if (!paths.length) throw new Error("Nothing staged to commit.");
  if (!message) throw new Error("A commit message is required.");
  const branch = branchArg || set.branch || branchName(message.split("\n")[0]);
  if (!isEliasBranch(branch) && !approved) throw new Error(`Pushing to "${branch}" needs the user's approval.`);
  let head: string | null = null;
  try { head = await headOf(token, set.repo, branch); } catch (error) { if (!(error instanceof GithubError && error.status === 404)) throw error; }
  const ours = branch === set.branch && set.branchCreated;
  if (head && !ours && !approved) throw new Error(`Branch "${branch}" already exists and wasn't created by this chat; pushing to it needs approval.`);
  const parent = head || set.baseSha;
  if (head && head !== set.baseSha) {
    // Someone else moved the branch: refuse if any file we touched changed under us.
    const remoteTree = await treeOf(token, set.repo, head);
    const baseTree = await treeOf(token, set.repo, set.baseSha);
    const moved = paths.filter((path) => remoteTree.entries.get(path)?.sha !== baseTree.entries.get(path)?.sha);
    if (moved.length) throw new Error(`"${branch}" moved since these edits started and ${moved.join(", ")} changed there. Re-read those files and redo the edits.`);
  }
  const parentCommit = await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${set.repo}/git/commits/${parent}`);
  const tree = await gh<{ sha: string }>(token, "POST", `/repos/${set.repo}/git/trees`, {
    base_tree: parentCommit.tree.sha,
    tree: paths.map((path) => set.files[path].content === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content: set.files[path].content }),
  });
  const commit = await gh<{ sha: string; html_url?: string }>(token, "POST", `/repos/${set.repo}/git/commits`, { message, tree: tree.sha, parents: [parent] });
  if (head) await gh(token, "PATCH", `/repos/${set.repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  else await gh(token, "POST", `/repos/${set.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  const stats = setDiff(set);
  set.commits.push({ sha: commit.sha, message: message.split("\n")[0].slice(0, 120), at: new Date().toISOString(), files: paths.length });
  set.files = {};
  set.baseSha = commit.sha;
  set.branch = branch;
  set.branchCreated = set.branchCreated || !head || ours;
  set.verify = null;
  set.updatedAt = new Date().toISOString();
  await session.store.save(set);
  return { ok: true, repo: set.repo, branch, sha: commit.sha, url: `https://github.com/${set.repo}/commit/${commit.sha}`, files: stats.files, added: stats.added, removed: stats.removed, next: "Run code_verify to check CI on this branch before opening a PR." };
}

export const CODE_TOOL_NAMES = new Set(Object.keys(CODE_TOOLS));
export const isCodeTool = (name: string) => CODE_TOOL_NAMES.has(name) || /^code_|^repo_/.test(name);

/** For routes/UI: the conversation's set (no token needed). */
export async function getCodeSet(userId: string, conversationId: string) {
  return (await codeStore()).get(userId, conversationId);
}
export async function discardCodeSet(userId: string, conversationId: string, path?: string) {
  const st = await codeStore();
  const set = await st.get(userId, conversationId);
  if (!set) return null;
  if (path) delete set.files[path]; else set.files = {};
  set.updatedAt = new Date().toISOString();
  await st.save(set);
  return set;
}
export async function saveCodeSet(set: CodeSet) {
  await (await codeStore()).save(set);
}
