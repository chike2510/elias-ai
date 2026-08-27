import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

export type GitHubWriteAction = "create_branch" | "commit_file" | "commit_files" | "create_pull_request" | "create_issue" | "create_review_comment";
export type GitHubWritePayload = Record<string, unknown>;
export type GitHubWriteProposal = {
  id: string;
  userId: string;
  action: GitHubWriteAction;
  owner: string;
  repo: string;
  branch?: string;
  base?: string;
  path?: string;
  files?: Array<{ path: string; contentHash: string }>;
  message?: string;
  title?: string;
  head?: string;
  pullNumber?: number;
  commitId?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  payloadHash: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "executing" | "completed" | "failed" | "expired";
  receipt?: { commitSha?: string; url?: string; message?: string };
  error?: string;
};

type StoreState = { proposals: Map<string, GitHubWriteProposal>; loaded: boolean };

declare global {
  var __eliasGitHubProposalStore: StoreState | undefined;
  var __eliasGitHubProposalDb: ReturnType<typeof postgres> | undefined;
  var __eliasGitHubProposalSchema: Promise<void> | undefined;
}

function storePath() { return process.env.ELIAS_GITHUB_PROPOSAL_STORE_PATH || join(process.cwd(), ".elias", "github-write-proposals.json"); }
function useRemoteStore() {
  if (process.env.VERCEL && !process.env.POSTGRES_URL) throw new Error("Durable GitHub approval storage is not configured. Add POSTGRES_URL to the Vercel Production environment and redeploy.");
  return Boolean(process.env.POSTGRES_URL);
}
function db() { globalThis.__eliasGitHubProposalDb ||= postgres(process.env.POSTGRES_URL!, { max: 1, prepare: false }); return globalThis.__eliasGitHubProposalDb; }
function state() {
  if (!globalThis.__eliasGitHubProposalStore) globalThis.__eliasGitHubProposalStore = { proposals: new Map(), loaded: false };
  const current = globalThis.__eliasGitHubProposalStore;
  if (!current.loaded) {
    current.loaded = true;
    if (existsSync(storePath())) {
      try {
        const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as GitHubWriteProposal[];
        parsed.filter((item) => item && typeof item.id === "string" && typeof item.userId === "string").forEach((item) => current.proposals.set(item.id, item));
      } catch { /* local fallback is best effort */ }
    }
  }
  return current;
}
function persistLocal() { try { mkdirSync(dirname(storePath()), { recursive: true }); writeFileSync(storePath(), JSON.stringify([...state().proposals.values()]), "utf8"); } catch { /* local fallback is best effort */ } }
function clone<T>(value: T): T { return structuredClone(value); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
export function hashGitHubWritePayload(payload: GitHubWritePayload) { return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex"); }
function hashContent(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function proposalFromPayload(id: string, userId: string, action: GitHubWriteAction, payload: GitHubWritePayload, now: number, ttlMs: number): GitHubWriteProposal {
  const files = Array.isArray(payload.files) ? (payload.files as Array<{ path?: unknown; content?: unknown }>).map((file) => ({ path: String(file.path || ""), contentHash: hashContent(String(file.content || "")) })) : undefined;
  return {
    id, userId, action, owner: String(payload.owner || ""), repo: String(payload.repo || ""),
    branch: typeof payload.branch === "string" ? payload.branch : undefined, base: typeof payload.base === "string" ? payload.base : undefined,
    path: typeof payload.path === "string" ? payload.path : undefined, files,
    message: typeof payload.message === "string" ? payload.message : undefined, title: typeof payload.title === "string" ? payload.title : undefined,
    head: typeof payload.head === "string" ? payload.head : undefined, pullNumber: typeof payload.pullNumber === "number" ? payload.pullNumber : undefined,
    commitId: typeof payload.commitId === "string" ? payload.commitId : undefined, line: typeof payload.line === "number" ? payload.line : undefined,
    side: payload.side === "LEFT" ? "LEFT" : payload.side === "RIGHT" ? "RIGHT" : undefined,
    payloadHash: hashGitHubWritePayload(payload), createdAt: now, expiresAt: now + ttlMs, status: "pending",
  };
}
async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasGitHubProposalSchema ||= (async () => {
    await db()`create table if not exists public.elias_github_write_proposals (id text primary key, user_id text not null, proposal jsonb not null, updated_at timestamptz not null default now())`;
    await db()`create index if not exists elias_github_write_proposals_user_idx on public.elias_github_write_proposals(user_id, updated_at desc)`;
  })();
  await globalThis.__eliasGitHubProposalSchema;
}

export async function createGitHubWriteProposal(userId: string, action: GitHubWriteAction, payload: GitHubWritePayload, ttlMs = 10 * 60 * 1000) {
  const proposal = proposalFromPayload(randomUUID(), userId, action, payload, Date.now(), ttlMs);
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`insert into public.elias_github_write_proposals (id, user_id, proposal, updated_at) values (${proposal.id}, ${proposal.userId}, ${JSON.stringify(proposal)}::jsonb, now())`;
  } else {
    state().proposals.set(proposal.id, proposal); persistLocal();
  }
  return clone(proposal);
}

export async function claimGitHubWriteProposal(id: string, userId: string, payloadHash: string) {
  const now = Date.now();
  if (useRemoteStore()) {
    await ensureSchema();
    const rows = await db()`update public.elias_github_write_proposals set proposal = jsonb_set(proposal, '{status}', '"executing"'::jsonb), updated_at = now() where id = ${id} and user_id = ${userId} and proposal->>'status' = 'pending' and proposal->>'payloadHash' = ${payloadHash} and (proposal->>'expiresAt')::bigint > ${now} returning proposal` as Array<{ proposal: GitHubWriteProposal }>;
    return rows[0] ? clone(rows[0].proposal) : undefined;
  }
  const proposal = state().proposals.get(id);
  if (!proposal || proposal.userId !== userId || proposal.payloadHash !== payloadHash || proposal.status !== "pending") return undefined;
  if (proposal.expiresAt <= now) { proposal.status = "expired"; persistLocal(); return undefined; }
  proposal.status = "executing"; persistLocal(); return clone(proposal);
}

export async function completeGitHubWriteProposal(id: string, userId: string, receipt: GitHubWriteProposal["receipt"]) {
  const update = { status: "completed" as const, receipt };
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`update public.elias_github_write_proposals set proposal = proposal || ${JSON.stringify(update)}::jsonb, updated_at = now() where id = ${id} and user_id = ${userId}`;
  } else {
    const proposal = state().proposals.get(id); if (proposal) { Object.assign(proposal, update); persistLocal(); }
  }
}

export async function failGitHubWriteProposal(id: string, userId: string, error: string) {
  const update = { status: "failed" as const, error: error.slice(0, 500) };
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`update public.elias_github_write_proposals set proposal = proposal || ${JSON.stringify(update)}::jsonb, updated_at = now() where id = ${id} and user_id = ${userId}`;
  } else {
    const proposal = state().proposals.get(id); if (proposal) { Object.assign(proposal, update); persistLocal(); }
  }
}
