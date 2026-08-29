import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import type { EliasSession } from "@/lib/auth";

export type GitHubConnection = {
  userId: string;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  token: string;
  scopes: string[];
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
function key() { return createHash("sha256").update(process.env.ELIAS_SESSION_SECRET || "local-development-secret-change-me").digest(); }
function encode(value: Buffer) { return value.toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url"); }
function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(encode).join(".");
}
function decryptToken(value: string) {
  try {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key(), decode(ivValue));
    decipher.setAuthTag(decode(tagValue));
    return Buffer.concat([decipher.update(decode(encryptedValue)), decipher.final()]).toString("utf8");
  } catch { return undefined; }
}
async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasGitHubSchema ||= (async () => {
    await db()`create table if not exists public.elias_github_connections (user_id text primary key, connection jsonb not null, updated_at timestamptz not null default now())`;
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
function fromStored(value: unknown): GitHubConnection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<StoredGitHubConnection>;
  const token = typeof item.tokenCiphertext === "string" ? decryptToken(item.tokenCiphertext) : undefined;
  if (!token || typeof item.userId !== "string" || typeof item.login !== "string" || !Array.isArray(item.scopes)) return undefined;
  return clone({ ...item, token } as GitHubConnection);
}

export async function saveGitHubConnection(connection: GitHubConnection) {
  const stored = toStored({ ...connection, updatedAt: Date.now() });
  if (useRemoteStore()) {
    await ensureSchema();
    await db()`insert into public.elias_github_connections (user_id, connection, updated_at) values (${stored.userId}, ${JSON.stringify(stored)}::jsonb, now()) on conflict (user_id) do update set connection = excluded.connection, updated_at = now()`;
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
    return rows[0] ? fromStored(rows[0].connection) : undefined;
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

export async function getGitHubToken(session: EliasSession | null) {
  if (!session) return undefined;
  const stored = await getGitHubConnection(session.userId).catch(() => undefined);
  if (stored?.token) return stored.token;
  if (!session.githubToken) return undefined;
  await saveGitHubConnection({ userId: session.userId, login: session.login, name: session.name, email: session.email, avatarUrl: session.avatarUrl, token: session.githubToken, scopes: ["legacy-session"], connectedAt: session.createdAt, updatedAt: Date.now() }).catch(() => undefined);
  return session.githubToken;
}
