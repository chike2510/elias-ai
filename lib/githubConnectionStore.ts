import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import type { EliasSession } from "@/lib/auth";
import { decryptSecret, encryptSecret, needsReencrypt } from "@/lib/assistant/crypto";

export type GitHubConnection = {
  userId: string;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  token: string;
  scopes: string[];
  connectionType: "repository";
  connectedAt: number;
  updatedAt: number;
};

type StoredGitHubConnection = Omit<GitHubConnection, "token"> & { tokenCiphertext: string };
type StoreState = { connections: Map<string, StoredGitHubConnection>; loaded: boolean };

declare global {
  var __eliasGitHubStore: StoreState | undefined;
  var __eliasGitHubDb: ReturnType<typeof postgres> | undefined;
  var __eliasGitHubSchema: Promise<void> | undefined;
}

function storePath() { return process.env.ELIAS_GITHUB_STORE_PATH || join(process.cwd(), ".elias", "github-connections.json"); }
function useRemoteStore() {
  if (process.env.VERCEL && !process.env.POSTGRES_URL) throw new Error("Durable GitHub connection storage is not configured. Add POSTGRES_URL to the Vercel Production environment and redeploy.");
  return Boolean(process.env.POSTGRES_URL);
}
function db() { globalThis.__eliasGitHubDb ||= postgres(process.env.POSTGRES_URL!, { max: 1, prepare: false }); return globalThis.__eliasGitHubDb; }
// Tokens are AES-256-GCM encrypted with ELIAS_ENCRYPTION_KEY (lib/assistant/crypto.ts); rows written with the
// older session-secret key are still read and are re-encrypted the next time they're loaded.
function encryptToken(token: string) { return encryptSecret(token); }
function decryptToken(value: string) {
  try { return decryptSecret(value) || undefined; } catch { return undefined; }
}
async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasGitHubSchema ||= (async () => {
    await db()`create table if not exists public.elias_github_connections (user_id text primary key, connection jsonb not null, updated_at timestamptz not null default now())`;
    // RLS on, no policies: the app connects as owner; Supabase anon/authenticated roles get nothing.
    await db()`alter table public.elias_github_connections enable row level security`;
    await db()`create index if not exists elias_github_connections_updated_idx on public.elias_github_connections(updated_at desc)`;
  })();
  await globalThis.__eliasGitHubSchema;
}
function state() {
  if (!globalThis.__eliasGitHubStore) globalThis.__eliasGitHubStore = { connections: new Map(), loaded: false };
  const current = globalThis.__eliasGitHubStore;
  if (!current.loaded) {
    current.loaded = true;
    if (existsSync(storePath())) {
      try {
        const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as StoredGitHubConnection[];
        parsed.filter((item) => item && typeof item.userId === "string" && typeof item.tokenCiphertext === "string").forEach((item) => current.connections.set(item.userId, item));
      } catch { /* local fallback is best effort */ }
    }
  }
  return current;
}
function persistLocal() { try { mkdirSync(dirname(storePath()), { recursive: true }); writeFileSync(storePath(), JSON.stringify([...state().connections.values()]), "utf8"); } catch { /* local fallback is best effort */ } }
function clone<T>(value: T): T { return structuredClone(value); }
function toStored(connection: GitHubConnection): StoredGitHubConnection { const { token, ...rest } = connection; return { ...rest, tokenCiphertext: encryptToken(token) }; }
/**
 * Rows were written as `${JSON.stringify(stored)}::jsonb`; postgres.js serialises a string bound to a jsonb parameter a
 * second time, so production rows are a jsonb *string* holding the JSON, not an object. The old reader rejected anything
 * that wasn't an object, so the durable token was never read and every request fell back to the (stale) cookie token.
 * Accept objects and JSON strings, however many times they were encoded.
 */
export function parseStoredConnection(value: unknown): Partial<StoredGitHubConnection> | undefined {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === "string"; depth += 1) {
    try { current = JSON.parse(current); } catch { return undefined; }
  }
  return current && typeof current === "object" && !Array.isArray(current) ? current as Partial<StoredGitHubConnection> : undefined;
}
function fromStored(value: unknown): GitHubConnection | undefined {
  const item = parseStoredConnection(value);
  if (!item) return undefined;
  const token = typeof item.tokenCiphertext === "string" ? decryptToken(item.tokenCiphertext) : undefined;
  if (!token || typeof item.userId !== "string" || typeof item.login !== "string" || !Array.isArray(item.scopes) || item.connectionType !== "repository") return undefined;
  return clone({ ...item, token } as GitHubConnection);
}

export async function saveGitHubConnection(connection: GitHubConnection) {
  const stored = toStored({ ...connection, updatedAt: Date.now() });
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`insert into public.elias_github_connections (user_id, connection, updated_at) values (${stored.userId}, ${db().json(stored as unknown as postgres.JSONValue)}, now()) on conflict (user_id) do update set connection = excluded.connection, updated_at = now()`;
  } else {
    state().connections.set(stored.userId, stored);
    persistLocal();
  }
  return clone(connection);
}

export async function getGitHubConnection(userId: string) {
  if (useRemoteStore()) {
    await ensureSchema();
    const rows = await db()<Array<{ connection: unknown }>>`select connection from public.elias_github_connections where user_id = ${userId} limit 1`;
    const raw = rows[0]?.connection;
    const connection = raw === undefined ? undefined : fromStored(raw);
    const stored = parseStoredConnection(raw);
    // Rewrite in place (never delete) when the row is in an old cipher format or was double-encoded as a jsonb string.
    if (connection && (typeof raw === "string" || needsReencrypt(stored?.tokenCiphertext))) await saveGitHubConnection(connection).catch(() => undefined);
    return connection;
  }
  const stored = state().connections.get(userId);
  return stored ? fromStored(stored) : undefined;
}

export async function deleteGitHubConnection(userId: string) {
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`delete from public.elias_github_connections where user_id = ${userId}`;
  } else {
    state().connections.delete(userId);
    persistLocal();
  }
}

export type GitHubTokenCandidate = { source: "store" | "session"; token: string };

/** Every repository token we hold for this user, durable store first, then the session cookie copy. Deduplicated. */
export async function getGitHubTokenCandidates(session: EliasSession | null): Promise<GitHubTokenCandidate[]> {
  if (!session) return [];
  const stored = await getGitHubConnection(session.userId).catch(() => undefined);
  const candidates: GitHubTokenCandidate[] = [];
  if (stored?.token) candidates.push({ source: "store", token: stored.token });
  // Vercel deployments without POSTGRES_URL can still keep the separately-authorized
  // repository token in the encrypted Elias session cookie. Login never sets this marker.
  if (session.githubTokenType === "repository" && session.githubToken && !candidates.some((item) => item.token === session.githubToken)) candidates.push({ source: "session", token: session.githubToken });
  return candidates;
}

export type GitHubTokenCheck = "valid" | "invalid" | "unknown";
type TokenProbe = (token: string) => Promise<GitHubTokenCheck>;
declare global { var __eliasGitHubTokenChecks: Map<string, { result: GitHubTokenCheck; at: number }> | undefined; }
const CHECK_TTL_MS = 10 * 60_000;
function tokenKey(token: string) { return createHash("sha256").update(token).digest("base64url"); }
function checks() { return (globalThis.__eliasGitHubTokenChecks ||= new Map()); }
export function rememberGitHubTokenCheck(token: string, result: GitHubTokenCheck) { if (result !== "unknown") checks().set(tokenKey(token), { result, at: Date.now() }); }

/** GET /user with the token: 401 means GitHub no longer accepts it; anything else (network, 5xx, rate limit) is "unknown". */
export async function probeGitHubToken(token: string): Promise<GitHubTokenCheck> {
  try {
    const response = await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" }, cache: "no-store", signal: AbortSignal.timeout(6000) });
    return response.status === 401 ? "invalid" : response.ok ? "valid" : "unknown";
  } catch { return "unknown"; }
}

async function checkToken(token: string, probe: TokenProbe) {
  const cached = checks().get(tokenKey(token));
  if (cached && Date.now() - cached.at < CHECK_TTL_MS) return cached.result;
  const result = await probe(token);
  rememberGitHubTokenCheck(token, result);
  return result;
}

/**
 * Picks the first token GitHub still accepts. When the durable row is stale but the cookie copy works (or the row was
 * unreadable), the working token is written back to the store so the next request — and background jobs, which have no
 * cookie — use it. Rows are only ever upserted, never deleted. Returns `undefined` with `reconnect` when every token we
 * hold was rejected.
 */
export async function resolveGitHubToken(session: EliasSession | null, probe: TokenProbe = probeGitHubToken, options: { verifySingle?: boolean } = {}): Promise<{ token?: string; source?: GitHubTokenCandidate["source"]; reconnect: boolean; candidates: number }> {
  const candidates = await getGitHubTokenCandidates(session);
  if (!candidates.length || !session) return { reconnect: false, candidates: 0 };
  // One token and nothing to choose between: skip the network probe; callers see GitHub's own 401 if it is dead.
  if (candidates.length === 1 && !options.verifySingle) return { token: candidates[0].token, source: candidates[0].source, reconnect: false, candidates: 1 };
  let fallback: GitHubTokenCandidate | undefined;
  for (const candidate of candidates) {
    const result = await checkToken(candidate.token, probe);
    if (result === "invalid") continue;
    if (result === "unknown") { fallback ||= candidate; continue; }
    if (candidate.source === "session") await healGitHubConnectionStore(session, candidate.token).catch(() => undefined);
    return { token: candidate.token, source: candidate.source, reconnect: false, candidates: candidates.length };
  }
  if (fallback) return { token: fallback.token, source: fallback.source, reconnect: false, candidates: candidates.length };
  return { reconnect: true, candidates: candidates.length };
}

/** Upsert a token GitHub just accepted into the durable store (never deletes; keeps the existing profile fields). */
export async function healGitHubConnectionStore(session: EliasSession, token: string) {
  const existing = await getGitHubConnection(session.userId).catch(() => undefined);
  if (existing?.token === token) return;
  await saveGitHubConnection({ userId: session.userId, login: existing?.login || session.login, name: existing?.name || session.name, email: existing?.email || session.email, avatarUrl: existing?.avatarUrl || session.avatarUrl, token, scopes: existing?.scopes || ["repo", "read:org"], connectionType: "repository", connectedAt: existing?.connectedAt || session.createdAt || Date.now(), updatedAt: Date.now() });
}

export async function getGitHubToken(session: EliasSession | null) {
  return (await resolveGitHubToken(session)).token;
}

export type GitHubConnectionDiagnosis = { login?: string; rowType: string; decryptOk: boolean; healed: boolean; githubStatus?: number; grantedScopes?: string[] };

/**
 * Owner diagnostics (behind ELIAS_HEALTH_TOKEN): for each stored connection, whether the row reads and decrypts and what
 * GitHub answers for its token. Reading heals double-encoded rows in place. Never returns a token or ciphertext.
 */
export async function diagnoseGitHubConnections(limit = 10): Promise<{ store: "postgres" | "local"; connections: GitHubConnectionDiagnosis[] }> {
  const remote = useRemoteStore();
  let rows: Array<{ user_id: string; kind: string }>;
  if (remote) {
    await ensureSchema();
    rows = await db()<Array<{ user_id: string; kind: string }>>`select user_id, jsonb_typeof(connection) as kind from public.elias_github_connections order by updated_at desc limit ${limit}`;
  } else {
    rows = [...state().connections.keys()].slice(0, limit).map((userId) => ({ user_id: userId, kind: "object" }));
  }
  const connections: GitHubConnectionDiagnosis[] = [];
  for (const row of rows) {
    const connection = await getGitHubConnection(row.user_id).catch(() => undefined);
    let healed = false;
    if (remote && row.kind === "string" && connection) {
      const after = await db()<Array<{ kind: string }>>`select jsonb_typeof(connection) as kind from public.elias_github_connections where user_id = ${row.user_id}`;
      healed = after[0]?.kind === "object";
    }
    const diagnosis: GitHubConnectionDiagnosis = { login: connection?.login, rowType: row.kind, decryptOk: Boolean(connection?.token), healed };
    if (connection?.token) {
      try {
        const response = await fetch("https://api.github.com/user", { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${connection.token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ELIAS" }, cache: "no-store", signal: AbortSignal.timeout(6000) });
        diagnosis.githubStatus = response.status;
        diagnosis.grantedScopes = response.headers.get("x-oauth-scopes")?.split(",").map((scope) => scope.trim()).filter(Boolean) || [];
        rememberGitHubTokenCheck(connection.token, response.status === 401 ? "invalid" : response.ok ? "valid" : "unknown");
      } catch { diagnosis.githubStatus = 0; }
    }
    connections.push(diagnosis);
  }
  return { store: remote ? "postgres" : "local", connections };
}
