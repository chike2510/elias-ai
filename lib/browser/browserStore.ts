import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import type { BrowserSession } from "@/lib/browser/types";

type BrowserState = { sessions: Map<string, BrowserSession>; loaded: boolean };
declare global { var __eliasBrowserStore: BrowserState | undefined; var __eliasBrowserDb: ReturnType<typeof postgres> | undefined; var __eliasBrowserSchema: Promise<void> | undefined; }

function filePath() { return process.env.ELIAS_BROWSER_STORE_PATH || join(process.cwd(), ".elias", "browser-sessions.json"); }
function useRemoteStore() {
  if (process.env.VERCEL && !process.env.POSTGRES_URL) throw new Error("Durable browser storage is not configured. Add POSTGRES_URL to the Vercel Production environment and redeploy.");
  return Boolean(process.env.POSTGRES_URL);
}
function db() { globalThis.__eliasBrowserDb ||= postgres(process.env.POSTGRES_URL!, { max: 1, prepare: false }); return globalThis.__eliasBrowserDb; }
async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasBrowserSchema ||= (async () => {
    await db()`create table if not exists public.elias_browser_sessions (id text primary key, session jsonb not null, updated_at timestamptz not null default now())`;
    await db()`create index if not exists elias_browser_sessions_updated_idx on public.elias_browser_sessions(updated_at desc)`;
  })();
  await globalThis.__eliasBrowserSchema;
}
function state() {
  if (!globalThis.__eliasBrowserStore) globalThis.__eliasBrowserStore = { sessions: new Map(), loaded: false };
  const current = globalThis.__eliasBrowserStore;
  if (!current.loaded) {
    current.loaded = true;
    if (existsSync(filePath())) {
      try { const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as BrowserSession[]; for (const session of parsed) current.sessions.set(session.id, session); } catch { /* local fallback is best effort */ }
    }
  }
  return current;
}
function clone<T>(value: T): T { return structuredClone(value); }
function persistLocal() { try { mkdirSync(dirname(filePath()), { recursive: true }); writeFileSync(filePath(), JSON.stringify([...state().sessions.values()]), "utf8"); } catch { /* local fallback is best effort */ } }
function decode(value: unknown) { if (!value || typeof value !== "object") return undefined; const session = value as Partial<BrowserSession>; return typeof session.id === "string" && typeof session.taskId === "string" && Array.isArray(session.pendingActions) && Array.isArray(session.observations) ? clone(session as BrowserSession) : undefined; }

export async function saveBrowserSession(session: BrowserSession) {
  session.updatedAt = Date.now();
  if (useRemoteStore()) { await ensureSchema(); await db()`insert into public.elias_browser_sessions (id, session, updated_at) values (${session.id}, ${JSON.stringify(session)}::jsonb, now()) on conflict (id) do update set session = excluded.session, updated_at = now()`; }
  else { state().sessions.set(session.id, clone(session)); persistLocal(); }
  return clone(session);
}
export async function getStoredBrowserSession(id: string) {
  if (useRemoteStore()) { await ensureSchema(); const rows = await db()<Array<{ session: unknown }>>`select session from public.elias_browser_sessions where id = ${id} limit 1`; return rows[0] ? decode(rows[0].session) : undefined; }
  const session = state().sessions.get(id); return session ? clone(session) : undefined;
}
export async function listStoredBrowserSessions(taskId?: string) {
  let sessions: BrowserSession[];
  if (useRemoteStore()) { await ensureSchema(); const rows = await db()<Array<{ session: unknown }>>`select session from public.elias_browser_sessions order by updated_at desc`; sessions = rows.map((row) => decode(row.session)).filter((item): item is BrowserSession => Boolean(item)); }
  else sessions = [...state().sessions.values()].map(clone);
  return sessions.filter((session) => !taskId || session.taskId === taskId);
}
