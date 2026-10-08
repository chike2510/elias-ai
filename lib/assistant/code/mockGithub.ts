/**
 * In-memory GitHub REST mock for the coding agent's tests and evals: one repo with branches,
 * git trees/blobs/commits/refs, code search, pull requests, Actions runs/jobs/logs and
 * deployment statuses. Pass `mock.fetch` to setGithubFetch(). Import-free so tests can transpile it.
 */

type Commit = { sha: string; tree: Record<string, string>; parents: string[]; message: string };
type Run = { id: number; head_branch: string; head_sha: string; status: string; conclusion: string | null; html_url: string; event: string; name: string; created_at: string };
type Pull = { number: number; title: string; body: string; head: string; base: string; state: string; merged: boolean; html_url: string; merge_commit_sha?: string };

export type MockGithubOptions = {
  repo?: string;
  defaultBranch?: string;
  files: Record<string, string>;
  /** Decides the CI result for a pushed commit: return failing job logs to fail, null to pass. */
  ci?: (files: Record<string, string>, sha: string) => { failLog: string; job?: string } | null;
  /** Preview URL to report through deployment statuses for a sha (null: no deployment). */
  preview?: (sha: string) => string | null;
};

let counter = 0;
function hash(text: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519); }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, 31) ^ h2) + hex(h2 * 7 ^ h1)).slice(0, 40);
}

export function createMockGithub(options: MockGithubOptions) {
  const repo = options.repo || "acme/app";
  const defaultBranch = options.defaultBranch || "main";
  const blobs = new Map<string, string>();
  const commits = new Map<string, Commit>();
  const trees = new Map<string, Record<string, string>>();
  const refs = new Map<string, string>();
  const runs: Run[] = [];
  const logs = new Map<number, string>();
  const pulls: Pull[] = [];
  const deployments: string[] = [];
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let runId = 1000;

  const putBlob = (content: string) => { const sha = hash(`blob:${content}`); blobs.set(sha, content); return sha; };
  const putTree = (entries: Record<string, string>) => { const sha = hash(`tree:${JSON.stringify(Object.entries(entries).sort())}:${counter++}`); trees.set(sha, entries); return sha; };
  const putCommit = (tree: Record<string, string>, parents: string[], message: string) => { const sha = hash(`commit:${message}:${parents.join()}:${counter++}`); commits.set(sha, { sha, tree, parents, message }); return sha; };
  const filesAt = (sha: string) => { const commit = commits.get(sha); if (!commit) return null; return Object.fromEntries(Object.entries(commit.tree).map(([path, blob]) => [path, blobs.get(blob) as string])); };

  const initialTree = Object.fromEntries(Object.entries(options.files).map(([path, content]) => [path, putBlob(content)]));
  refs.set(defaultBranch, putCommit(initialTree, [], "initial"));

  /** Simulates CI for a push: a completed run with its conclusion (and a failing job log). */
  function triggerCi(branch: string, sha: string, event = "push") {
    const files = filesAt(sha) || {};
    const verdict = options.ci ? options.ci(files, sha) : null;
    const id = runId++;
    runs.unshift({ id, head_branch: branch, head_sha: sha, status: "completed", conclusion: verdict ? "failure" : "success", html_url: `https://github.com/${repo}/actions/runs/${id}`, event, name: "CI", created_at: new Date(Date.now() + id).toISOString() });
    if (verdict) logs.set(id, verdict.failLog);
    return id;
  }

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const notFound = () => json(404, { message: "Not Found" });

  async function handle(method: string, url: URL, body: Record<string, unknown> | undefined, accept: string): Promise<Response> {
    const p = url.pathname;
    const base = `/repos/${repo}`;
    if (method === "GET" && p.startsWith("/search/code")) {
      const q = (url.searchParams.get("q") || "").replace(/\s*repo:\S+/, "").trim().replace(/^"|"$/g, "");
      const files = filesAt(refs.get(defaultBranch) as string) || {};
      return json(200, { items: Object.entries(files).filter(([, text]) => text.includes(q)).map(([path]) => ({ path })) });
    }
    if (!p.startsWith(base)) return notFound();
    const rest = p.slice(base.length);
    if (method === "GET" && rest === "") return json(200, { full_name: repo, default_branch: defaultBranch, private: true });
    let m = rest.match(/^\/branches\/(.+)$/);
    if (method === "GET" && m) { const sha = refs.get(decodeURIComponent(m[1])); return sha ? json(200, { name: m[1], commit: { sha } }) : json(404, { message: "Branch not found" }); }
    m = rest.match(/^\/git\/trees\/([^/?]+)$/);
    if (method === "GET" && m) {
      const commit = commits.get(m[1]);
      const tree = commit ? commit.tree : trees.get(m[1]);
      if (!tree) return notFound();
      return json(200, { sha: m[1], truncated: false, tree: Object.entries(tree).map(([path, sha]) => ({ path, sha, type: "blob", mode: "100644", size: (blobs.get(sha) || "").length })) });
    }
    m = rest.match(/^\/git\/blobs\/([^/]+)$/);
    if (method === "GET" && m) { const text = blobs.get(m[1]); if (text === undefined) return notFound(); return accept.includes("raw") ? new Response(text, { status: 200 }) : json(200, { sha: m[1], content: Buffer.from(text).toString("base64"), encoding: "base64" }); }
    m = rest.match(/^\/git\/commits\/([^/]+)$/);
    if (method === "GET" && m) { const commit = commits.get(m[1]); if (!commit) return notFound(); const treeSha = putTree(commit.tree); return json(200, { sha: commit.sha, tree: { sha: treeSha }, message: commit.message, parents: commit.parents.map((sha) => ({ sha })) }); }
    if (method === "POST" && rest === "/git/trees") {
      const baseTree = body?.base_tree ? trees.get(String(body.base_tree)) : {};
      if (!baseTree) return json(422, { message: "base_tree not found" });
      const next = { ...baseTree };
      for (const entry of (body?.tree || []) as Array<{ path: string; sha?: string | null; content?: string }>) {
        if (entry.sha === null) delete next[entry.path];
        else if (typeof entry.content === "string") next[entry.path] = putBlob(entry.content);
        else if (entry.sha) next[entry.path] = entry.sha;
      }
      return json(201, { sha: putTree(next) });
    }
    if (method === "POST" && rest === "/git/commits") {
      const tree = trees.get(String(body?.tree));
      if (!tree) return json(422, { message: "tree not found" });
      const sha = putCommit(tree, (body?.parents || []) as string[], String(body?.message || ""));
      return json(201, { sha, html_url: `https://github.com/${repo}/commit/${sha}` });
    }
    if (method === "POST" && rest === "/git/refs") {
      const ref = String(body?.ref || "").replace(/^refs\/heads\//, "");
      if (refs.has(ref)) return json(422, { message: "Reference already exists" });
      refs.set(ref, String(body?.sha));
      triggerCi(ref, String(body?.sha));
      return json(201, { ref: `refs/heads/${ref}`, object: { sha: body?.sha } });
    }
    m = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (method === "PATCH" && m) {
      const ref = decodeURIComponent(m[1]);
      const current = refs.get(ref);
      if (!current) return json(422, { message: "Reference does not exist" });
      const next = commits.get(String(body?.sha));
      if (!body?.force && !(next?.parents || []).includes(current)) return json(422, { message: "Update is not a fast forward" });
      refs.set(ref, String(body?.sha));
      triggerCi(ref, String(body?.sha));
      return json(200, { ref: `refs/heads/${ref}`, object: { sha: body?.sha } });
    }
    if (method === "GET" && rest === "/actions/runs") {
      const branch = url.searchParams.get("branch");
      const sha = url.searchParams.get("head_sha");
      return json(200, { workflow_runs: runs.filter((run) => (!branch || run.head_branch === branch) && (!sha || run.head_sha === sha)) });
    }
    m = rest.match(/^\/actions\/runs\/(\d+)\/jobs$/);
    if (method === "GET" && m) {
      const run = runs.find((item) => item.id === Number(m![1]));
      if (!run) return notFound();
      const failed = run.conclusion === "failure";
      return json(200, { jobs: [{ id: run.id * 10, name: "check", conclusion: run.conclusion, status: "completed", steps: [{ name: "Typecheck", conclusion: failed ? "failure" : "success", number: 5 }, { name: "Unit tests", conclusion: failed ? "skipped" : "success", number: 6 }] }] });
    }
    m = rest.match(/^\/actions\/jobs\/(\d+)\/logs$/);
    if (method === "GET" && m) { const log = logs.get(Number(m[1]) / 10); return log === undefined ? notFound() : new Response(log, { status: 200 }); }
    m = rest.match(/^\/actions\/workflows\/([^/]+)\/dispatches$/);
    if (method === "POST" && m) { const ref = String(body?.ref || defaultBranch); const sha = refs.get(ref); if (!sha) return json(422, { message: "No ref found" }); triggerCi(ref, sha, "workflow_dispatch"); return new Response(null, { status: 204 }); }
    m = rest.match(/^\/actions\/runs\/(\d+)\/rerun$/);
    if (method === "POST" && m) return new Response(null, { status: 201 });
    if (method === "GET" && rest === "/deployments") {
      const sha = url.searchParams.get("sha") || "";
      const preview = options.preview ? options.preview(sha) : null;
      if (!preview) return json(200, []);
      const id = 70 + deployments.length;
      deployments.push(sha);
      return json(200, [{ id, sha, environment: "Preview", statuses_url: `https://api.github.com${base}/deployments/${id}/statuses` }]);
    }
    m = rest.match(/^\/deployments\/(\d+)\/statuses$/);
    if (method === "GET" && m) {
      const sha = deployments[Number(m[1]) - 70] || "";
      const preview = options.preview ? options.preview(sha) : null;
      return json(200, preview ? [{ state: "success", environment_url: preview, target_url: "https://vercel.com/inspect" }] : []);
    }
    if (method === "POST" && rest === "/pulls") {
      const head = String(body?.head || "").replace(/^[^:]+:/, "");
      if (!refs.has(head)) return json(422, { message: `head ${head} not found` });
      if (pulls.some((pull) => pull.head === head && pull.state === "open")) return json(422, { message: "A pull request already exists" });
      const number = 40 + pulls.length;
      const pull: Pull = { number, title: String(body?.title || ""), body: String(body?.body || ""), head, base: String(body?.base || defaultBranch), state: "open", merged: false, html_url: `https://github.com/${repo}/pull/${number}` };
      pulls.push(pull);
      triggerCi(head, refs.get(head) as string, "pull_request");
      return json(201, { number, html_url: pull.html_url, state: "open", head: { ref: head, sha: refs.get(head) }, base: { ref: pull.base } });
    }
    if (method === "GET" && rest === "/pulls") {
      const head = (url.searchParams.get("head") || "").replace(/^[^:]+:/, "");
      const state = url.searchParams.get("state") || "open";
      return json(200, pulls.filter((pull) => (!head || pull.head === head) && (state === "all" || pull.state === state)).map((pull) => ({ number: pull.number, html_url: pull.html_url, state: pull.state, head: { ref: pull.head } })));
    }
    m = rest.match(/^\/pulls\/(\d+)$/);
    if (method === "GET" && m) { const pull = pulls.find((item) => item.number === Number(m![1])); if (!pull) return notFound(); return json(200, { number: pull.number, title: pull.title, state: pull.state, merged: pull.merged, html_url: pull.html_url, head: { ref: pull.head, sha: refs.get(pull.head) }, base: { ref: pull.base }, mergeable: true, mergeable_state: "clean" }); }
    m = rest.match(/^\/pulls\/(\d+)\/merge$/);
    if (method === "PUT" && m) {
      const pull = pulls.find((item) => item.number === Number(m![1]));
      if (!pull || pull.state !== "open") return json(405, { message: "Pull Request is not mergeable" });
      const headSha = refs.get(pull.head) as string;
      const files = commits.get(headSha)?.tree || {};
      const sha = putCommit(files, [refs.get(pull.base) as string], String(body?.commit_title || pull.title));
      refs.set(pull.base, sha);
      pull.state = "closed"; pull.merged = true; pull.merge_commit_sha = sha;
      return json(200, { sha, merged: true, message: "Pull Request successfully merged" });
    }
    m = rest.match(/^\/commits\/([^/]+)\/check-runs$/);
    if (method === "GET" && m) {
      const ref = decodeURIComponent(m[1]);
      const sha = refs.get(ref) || ref;
      const run = runs.find((item) => item.head_sha === sha);
      return json(200, { check_runs: run ? [{ name: "check", status: run.status, conclusion: run.conclusion, html_url: run.html_url }] : [] });
    }
    return notFound();
  }

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ method, path: `${url.pathname}${url.search}`, body });
    return handle(method, url, body, headers.Accept || headers.accept || "");
  }) as typeof fetch;

  return {
    repo, fetch: mockFetch, calls, runs, pulls, refs,
    filesAt, head: (branch = defaultBranch) => refs.get(branch) || null,
    branchFiles: (branch = defaultBranch) => filesAt(refs.get(branch) || "") || {},
    triggerCi,
    /** Pushes a commit to a branch as if someone else did (for conflict tests). */
    pushExternal(branch: string, changes: Record<string, string>) {
      const parent = refs.get(branch) as string;
      const tree = { ...(commits.get(parent)?.tree || {}) };
      for (const [path, content] of Object.entries(changes)) tree[path] = putBlob(content);
      const sha = putCommit(tree, [parent], "external");
      refs.set(branch, sha);
      return sha;
    },
  };
}

export type MockGithub = ReturnType<typeof createMockGithub>;
