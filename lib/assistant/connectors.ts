import type { ToolSchema } from "@/lib/assistant/llm";
import type { ToolContext } from "@/lib/assistant/tools";
import { ready } from "@/lib/assistant/db";

/**
 * Env-gated connectors exposed as agent tools: GitHub, Vercel, Supabase health, Paystack, Flutterwave.
 * All read-only except github_issue_create and vercel_redeploy, which always need the user's approval.
 * Nothing here can move money.
 */
type Args = Record<string, unknown>;
export type ConnectorTool = {
  schema: ToolSchema["function"];
  needsApproval?: (args: Args, ctx: ToolContext) => Promise<string | null> | string | null;
  run: (args: Args, ctx: ToolContext) => Promise<unknown>;
};

const str = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const num = (value: unknown, fallback: number, max: number) => Math.min(max, Math.max(1, Number(value) || fallback));
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });

async function getJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} ${response.status}: ${text.slice(0, 240)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/* ---------------- status ---------------- */

export function supabaseProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.SUPABASE_URL || process.env.POSTGRES_SUPABASE_URL || process.env.NEXT_PUBLIC_POSTGRES_SUPABASE_URL || "";
  return url.match(/https?:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1] || null;
}

export function connectorStatus(githubOAuth: boolean) {
  return {
    github: { configured: githubOAuth || Boolean(process.env.GITHUB_TOKEN), source: githubOAuth ? "oauth" : process.env.GITHUB_TOKEN ? "env" : null },
    vercel: { configured: Boolean(process.env.VERCEL_API_TOKEN) },
    supabase: { configured: Boolean(process.env.POSTGRES_URL), mode: process.env.SUPABASE_ACCESS_TOKEN && supabaseProjectRef() ? "management" : process.env.POSTGRES_URL ? "database" : null },
    telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET) },
    paystack: { configured: Boolean(process.env.PAYSTACK_SECRET_KEY) },
    flutterwave: { configured: Boolean(process.env.FLUTTERWAVE_SECRET_KEY) },
    embeddings: { configured: Boolean(process.env.ELIAS_EMBED_SECRET || process.env.POSTGRES_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY) },
  };
}

/* ---------------- GitHub ---------------- */

function githubToken(ctx: ToolContext) {
  const token = ctx.githubToken || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GitHub isn't connected. Connect GitHub in Connectors (or the owner sets GITHUB_TOKEN).");
  return token;
}

function repoOf(args: Args) {
  const repo = str(args.repo, process.env.GITHUB_DEFAULT_REPO || "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Which repository? Give it as owner/name, e.g. chike2510/elias-ai.");
  return repo;
}

function gh<T>(ctx: ToolContext, path: string, init: RequestInit = {}) {
  return getJson<T>(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${githubToken(ctx)}`, Accept: "application/vnd.github+json", "User-Agent": "Elias", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) } }, "GitHub");
}

type GhIssue = { number: number; title: string; state: string; html_url: string; user?: { login: string }; labels?: Array<{ name: string }>; pull_request?: unknown; created_at: string; comments?: number };
type GhPull = { number: number; title: string; state: string; html_url: string; draft?: boolean; user?: { login: string }; head: { ref: string; sha: string }; base: { ref: string }; merged_at?: string | null; mergeable_state?: string; created_at: string };

/* ---------------- Vercel ---------------- */

function vercel<T>(path: string, init: RequestInit = {}) {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("Vercel isn't configured: the server needs VERCEL_API_TOKEN.");
  const team = process.env.VERCEL_TEAM_ID;
  const url = `https://api.vercel.com${path}${team ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : ""}`;
  return getJson<T>(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } }, "Vercel");
}

type VercelDeployment = { uid: string; name: string; url: string; state?: string; readyState?: string; target?: string | null; created: number; meta?: Record<string, string>; inspectorUrl?: string; alias?: string[] };

async function latestProductionDeployment(project: string) {
  const data = await vercel<{ deployments: VercelDeployment[] }>(`/v6/deployments?app=${encodeURIComponent(project)}&target=production&limit=10`);
  const ready = data.deployments.find((item) => (item.state || item.readyState) === "READY") || data.deployments[0];
  if (!ready) throw new Error(`No production deployment found for ${project}.`);
  return ready;
}

/* ---------------- Payments (read-only) ---------------- */

const paystack = <T>(path: string) => {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Paystack isn't configured: the server needs PAYSTACK_SECRET_KEY.");
  return getJson<T>(`https://api.paystack.co${path}`, { headers: { Authorization: `Bearer ${key}` } }, "Paystack");
};
const flutterwave = <T>(path: string) => {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) throw new Error("Flutterwave isn't configured: the server needs FLUTTERWAVE_SECRET_KEY.");
  return getJson<T>(`https://api.flutterwave.com/v3${path}`, { headers: { Authorization: `Bearer ${key}` } }, "Flutterwave");
};

export type Txn = { provider: "paystack" | "flutterwave"; id: string; amount: number; currency: string; status: string; at: string; description: string; channel?: string; customer?: string };

async function paystackTransactions(days: number, limit: number): Promise<Txn[]> {
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  const data = await paystack<{ data: Array<{ id: number; amount: number; currency: string; status: string; paid_at?: string; created_at: string; channel?: string; customer?: { email?: string }; metadata?: unknown; reference: string }> }>(`/transaction?perPage=${limit}&from=${encodeURIComponent(from)}`);
  return (data.data || []).map((item) => ({ provider: "paystack", id: String(item.id), amount: item.amount / 100, currency: item.currency, status: item.status, at: item.paid_at || item.created_at, description: item.reference, channel: item.channel, customer: item.customer?.email }));
}

async function flutterwaveTransactions(days: number, limit: number): Promise<Txn[]> {
  const day = (offset: number) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
  const data = await flutterwave<{ data: Array<{ id: number; amount: number; currency: string; status: string; created_at: string; narration?: string; tx_ref?: string; payment_type?: string; customer?: { email?: string } }> }>(`/transactions?from=${day(days)}&to=${day(0)}`);
  return (data.data || []).slice(0, limit).map((item) => ({ provider: "flutterwave", id: String(item.id), amount: item.amount, currency: item.currency, status: item.status, at: item.created_at, description: item.narration || item.tx_ref || "", channel: item.payment_type, customer: item.customer?.email }));
}

/** Totals per currency and status, plus the biggest items: what "summarise my spending/takings" needs. */
export function summarizeTransactions(items: Txn[]) {
  const byCurrency: Record<string, { successful: number; failed: number; count: number; total: number }> = {};
  for (const item of items) {
    const bucket = byCurrency[item.currency] ||= { successful: 0, failed: 0, count: 0, total: 0 };
    bucket.count += 1;
    if (/success/i.test(item.status)) { bucket.successful += 1; bucket.total = Math.round((bucket.total + item.amount) * 100) / 100; } else if (/fail|abandon|cancel/i.test(item.status)) bucket.failed += 1;
  }
  const largest = [...items].filter((item) => /success/i.test(item.status)).sort((a, b) => b.amount - a.amount).slice(0, 3).map((item) => ({ amount: item.amount, currency: item.currency, description: item.description, at: item.at, provider: item.provider }));
  return { count: items.length, byCurrency, largest };
}

/* ---------------- Tools ---------------- */

export const CONNECTOR_TOOLS: Record<string, ConnectorTool> = {
  github_issues: {
    schema: { name: "github_issues", description: "List issues in a GitHub repository (not PRs).", parameters: obj({ repo: s("owner/name"), state: { type: "string", enum: ["open", "closed", "all"] }, limit: { type: "number" } }, ["repo"]) },
    run: async (args, ctx) => {
      const repo = repoOf(args);
      const items = await gh<GhIssue[]>(ctx, `/repos/${repo}/issues?state=${str(args.state, "open")}&per_page=${num(args.limit, 15, 50)}`);
      return { repo, issues: items.filter((item) => !item.pull_request).map((item) => ({ number: item.number, title: item.title, state: item.state, url: item.html_url, author: item.user?.login, labels: item.labels?.map((label) => label.name), comments: item.comments, createdAt: item.created_at })) };
    },
  },
  github_issue_create: {
    schema: { name: "github_issue_create", description: "Open a new issue in a GitHub repository. Needs the user's approval.", parameters: obj({ repo: s("owner/name"), title: s("Issue title"), body: s("Markdown body"), labels: { type: "array", items: { type: "string" } } }, ["repo", "title"]) },
    needsApproval: (args) => `Open a GitHub issue in ${str(args.repo)}\nTitle: ${str(args.title)}${args.body ? `\n\n${str(args.body)}` : ""}`,
    run: async (args, ctx) => {
      const repo = repoOf(args);
      const issue = await gh<GhIssue>(ctx, `/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title: str(args.title), body: str(args.body), labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined }) });
      return { repo, number: issue.number, url: issue.html_url, title: issue.title };
    },
  },
  github_prs: {
    schema: { name: "github_prs", description: "List pull requests in a GitHub repository.", parameters: obj({ repo: s("owner/name"), state: { type: "string", enum: ["open", "closed", "all"] }, limit: { type: "number" } }, ["repo"]) },
    run: async (args, ctx) => {
      const repo = repoOf(args);
      const items = await gh<GhPull[]>(ctx, `/repos/${repo}/pulls?state=${str(args.state, "open")}&per_page=${num(args.limit, 10, 30)}&sort=updated&direction=desc`);
      return { repo, pulls: items.map((item) => ({ number: item.number, title: item.title, state: item.merged_at ? "merged" : item.state, draft: item.draft, url: item.html_url, author: item.user?.login, branch: item.head.ref, base: item.base.ref, createdAt: item.created_at })) };
    },
  },
  github_pr_status: {
    schema: { name: "github_pr_status", description: "Status of one pull request: mergeability, CI checks and review state.", parameters: obj({ repo: s("owner/name"), number: { type: "number", description: "PR number" } }, ["repo", "number"]) },
    run: async (args, ctx) => {
      const repo = repoOf(args);
      const pr = await gh<GhPull & { mergeable?: boolean | null }>(ctx, `/repos/${repo}/pulls/${Number(args.number)}`);
      const [checks, reviews] = await Promise.all([
        gh<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string }> }>(ctx, `/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=30`).catch(() => ({ check_runs: [] })),
        gh<Array<{ state: string; user?: { login: string } }>>(ctx, `/repos/${repo}/pulls/${pr.number}/reviews`).catch(() => []),
      ]);
      const runs = checks.check_runs.map((item) => ({ name: item.name, status: item.status, conclusion: item.conclusion, url: item.html_url }));
      const failing = runs.filter((item) => item.conclusion && !["success", "skipped", "neutral"].includes(item.conclusion));
      const pending = runs.filter((item) => item.status !== "completed");
      return { repo, number: pr.number, title: pr.title, url: pr.html_url, state: pr.merged_at ? "merged" : pr.state, draft: pr.draft, mergeable: pr.mergeable, mergeableState: pr.mergeable_state,
        checks: { total: runs.length, failing: failing.length, pending: pending.length, overall: failing.length ? "failing" : pending.length ? "pending" : runs.length ? "passing" : "none", runs },
        reviews: reviews.map((item) => ({ by: item.user?.login, state: item.state })) };
    },
  },
  github_ci_status: {
    schema: { name: "github_ci_status", description: "Latest GitHub Actions runs and deployments for a repository branch (default: the default branch).", parameters: obj({ repo: s("owner/name"), branch: s("Branch name") }, ["repo"]) },
    run: async (args, ctx) => {
      const repo = repoOf(args);
      const branch = str(args.branch);
      const [runs, deployments] = await Promise.all([
        gh<{ workflow_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string; head_branch: string; head_sha: string; created_at: string; event: string }> }>(ctx, `/repos/${repo}/actions/runs?per_page=5${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`).catch(() => ({ workflow_runs: [] })),
        gh<Array<{ id: number; environment: string; sha: string; created_at: string; statuses_url: string }>>(ctx, `/repos/${repo}/deployments?per_page=3`).catch(() => []),
      ]);
      const deployStates = await Promise.all(deployments.map(async (item) => {
        const statuses = await getJson<Array<{ state: string; environment_url?: string; target_url?: string }>>(item.statuses_url, { headers: { Authorization: `Bearer ${githubToken(ctx)}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" } }, "GitHub").catch(() => []);
        return { environment: item.environment, sha: item.sha.slice(0, 7), createdAt: item.created_at, state: statuses[0]?.state || "unknown", url: statuses[0]?.environment_url || statuses[0]?.target_url };
      }));
      return { repo, runs: runs.workflow_runs.map((item) => ({ workflow: item.name, branch: item.head_branch, sha: item.head_sha.slice(0, 7), status: item.status, conclusion: item.conclusion, event: item.event, url: item.html_url, createdAt: item.created_at })), deployments: deployStates };
    },
  },

  vercel_projects: {
    schema: { name: "vercel_projects", description: "List the owner's Vercel projects with their latest production deployment state.", parameters: obj({}) },
    run: async () => {
      const data = await vercel<{ projects: Array<{ name: string; framework?: string; updatedAt: number; latestDeployments?: VercelDeployment[]; targets?: { production?: VercelDeployment & { alias?: string[] } } }> }>("/v9/projects?limit=20");
      return data.projects.map((item) => {
        const production = item.targets?.production || item.latestDeployments?.[0];
        return { name: item.name, framework: item.framework, updatedAt: new Date(item.updatedAt).toISOString(), production: production ? { state: production.readyState || production.state, url: production.alias?.[0] ? `https://${production.alias[0]}` : production.url ? `https://${production.url}` : undefined, createdAt: production.created ? new Date(production.created).toISOString() : undefined } : null };
      });
    },
  },
  vercel_deployments: {
    schema: { name: "vercel_deployments", description: "Latest Vercel deployments of a project and their state (READY, ERROR, BUILDING...).", parameters: obj({ project: s("Vercel project name, e.g. elias-ai"), limit: { type: "number" } }, ["project"]) },
    run: async (args) => {
      const project = str(args.project);
      if (!project) throw new Error("Which Vercel project?");
      const data = await vercel<{ deployments: VercelDeployment[] }>(`/v6/deployments?app=${encodeURIComponent(project)}&limit=${num(args.limit, 5, 20)}`);
      return { project, deployments: data.deployments.map((item) => ({ id: item.uid, state: item.state || item.readyState, target: item.target || "preview", url: `https://${item.url}`, createdAt: new Date(item.created).toISOString(), commit: item.meta?.githubCommitMessage?.split("\n")[0], sha: item.meta?.githubCommitSha?.slice(0, 7), branch: item.meta?.githubCommitRef, inspect: item.inspectorUrl })) };
    },
  },
  vercel_redeploy: {
    schema: { name: "vercel_redeploy", description: "Redeploy a Vercel project's latest production deployment (or a given deployment id) to production. Needs the user's approval.", parameters: obj({ project: s("Vercel project name"), deployment_id: s("Optional deployment id (dpl_...) to redeploy") }, ["project"]) },
    needsApproval: (args) => `Redeploy ${str(args.project)} to production${args.deployment_id ? ` from ${str(args.deployment_id)}` : " from its latest production deployment"}`,
    run: async (args) => {
      const project = str(args.project);
      const source = str(args.deployment_id) || (await latestProductionDeployment(project)).uid;
      const created = await vercel<{ id: string; url: string; readyState?: string; status?: string }>("/v13/deployments", { method: "POST", body: JSON.stringify({ name: project, deploymentId: source, target: "production" }) });
      return { project, id: created.id, url: `https://${created.url}`, state: created.readyState || created.status || "QUEUED", from: source };
    },
  },

  supabase_health: {
    schema: { name: "supabase_health", description: "Health of the app's Supabase project: service status (when a management token is set), database reachability, latency and size.", parameters: obj({}) },
    run: async () => {
      const db = await ready();
      const started = Date.now();
      const [info] = await db`select pg_database_size(current_database())::bigint as bytes, (select count(*) from pg_stat_activity)::int as connections, version() as version`;
      const latencyMs = Date.now() - started;
      const tables = await db`select relname as name, pg_total_relation_size(c.oid)::bigint as bytes from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 2 desc limit 5`.catch(() => []);
      const database = { reachable: true, latencyMs, sizeMb: Math.round(Number(info.bytes) / 1048576 * 10) / 10, connections: Number(info.connections), version: String(info.version).split(" ").slice(0, 2).join(" "), largestTables: tables.map((item) => ({ name: String(item.name), sizeKb: Math.round(Number(item.bytes) / 1024) })) };
      const token = process.env.SUPABASE_ACCESS_TOKEN;
      const ref = supabaseProjectRef();
      if (!token || !ref) return { mode: "database", database, note: "Set SUPABASE_ACCESS_TOKEN (and SUPABASE_PROJECT_REF if it can't be derived) for service-level health and security advisors." };
      const headers = { Authorization: `Bearer ${token}` };
      const [services, advisors] = await Promise.all([
        getJson<Array<{ name: string; healthy: boolean; status: string }>>(`https://api.supabase.com/v1/projects/${ref}/health?services=auth,db,rest,storage,realtime`, { headers }, "Supabase").catch((error) => ({ error: String(error.message) })),
        getJson<{ lints: Array<{ level: string; title: string; detail: string }> }>(`https://api.supabase.com/v1/projects/${ref}/advisors/security`, { headers }, "Supabase").catch(() => ({ lints: [] })),
      ]);
      return { mode: "management", ref, services, database, security: { errors: advisors.lints.filter((item) => item.level === "ERROR").length, warnings: advisors.lints.filter((item) => item.level === "WARN").length, top: advisors.lints.slice(0, 3).map((item) => item.detail.replace(/\\`/g, "`")) } };
    },
  },

  paystack_transactions: {
    schema: { name: "paystack_transactions", description: "Read-only: recent Paystack transactions (amounts in major units).", parameters: obj({ days: { type: "number", description: "Look back this many days (default 30)" }, limit: { type: "number" } }) },
    run: async (args) => { const items = await paystackTransactions(num(args.days, 30, 365), num(args.limit, 20, 100)); return { transactions: items, summary: summarizeTransactions(items) }; },
  },
  paystack_balance: {
    schema: { name: "paystack_balance", description: "Read-only: current Paystack balance per currency.", parameters: obj({}) },
    run: async () => (await paystack<{ data: Array<{ currency: string; balance: number }> }>("/balance")).data.map((item) => ({ currency: item.currency, balance: item.balance / 100 })),
  },
  flutterwave_transactions: {
    schema: { name: "flutterwave_transactions", description: "Read-only: recent Flutterwave transactions.", parameters: obj({ days: { type: "number", description: "Look back this many days (default 30)" }, limit: { type: "number" } }) },
    run: async (args) => { const items = await flutterwaveTransactions(num(args.days, 30, 365), num(args.limit, 20, 100)); return { transactions: items, summary: summarizeTransactions(items) }; },
  },
  flutterwave_balance: {
    schema: { name: "flutterwave_balance", description: "Read-only: current Flutterwave wallet balances.", parameters: obj({}) },
    run: async () => (await flutterwave<{ data: Array<{ currency: string; available_balance: number; ledger_balance: number }> }>("/balances")).data.filter((item) => item.available_balance || item.ledger_balance).map((item) => ({ currency: item.currency, available: item.available_balance, ledger: item.ledger_balance })),
  },
  payments_summary: {
    schema: { name: "payments_summary", description: "Read-only: summarise money in and out across connected payment providers (Paystack, Flutterwave) over a period. Never initiates payments.", parameters: obj({ days: { type: "number", description: "Period in days (default 30)" } }) },
    run: async (args) => {
      const days = num(args.days, 30, 365);
      const notes: string[] = [];
      const lists = await Promise.all([
        process.env.PAYSTACK_SECRET_KEY ? paystackTransactions(days, 100).catch((error) => { notes.push(`Paystack: ${error.message}`); return []; }) : Promise.resolve([] as Txn[]),
        process.env.FLUTTERWAVE_SECRET_KEY ? flutterwaveTransactions(days, 100).catch((error) => { notes.push(`Flutterwave: ${error.message}`); return []; }) : Promise.resolve([] as Txn[]),
      ]);
      if (!process.env.PAYSTACK_SECRET_KEY && !process.env.FLUTTERWAVE_SECRET_KEY) throw new Error("No payment provider is connected. The owner can add PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY (read-only use).");
      return { days, ...summarizeTransactions(lists.flat()), notes };
    },
  },
};

/** Which connector tools need configuration that's missing, so the agent can say so in one line. */
export function connectorGate(tool: string): string | null {
  if (/^vercel_/.test(tool) && !process.env.VERCEL_API_TOKEN) return "Vercel isn't configured on this server (the owner needs to add VERCEL_API_TOKEN). Tell the user in one line.";
  if (/^paystack_/.test(tool) && !process.env.PAYSTACK_SECRET_KEY) return "Paystack isn't connected (the owner needs to add PAYSTACK_SECRET_KEY, read-only use). Tell the user in one line.";
  if (/^flutterwave_/.test(tool) && !process.env.FLUTTERWAVE_SECRET_KEY) return "Flutterwave isn't connected (the owner needs to add FLUTTERWAVE_SECRET_KEY, read-only use). Tell the user in one line.";
  return null;
}
