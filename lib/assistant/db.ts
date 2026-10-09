import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { migrateBackground } from "@/lib/assistant/schemaBackground";
import { decryptSecret, encryptSecret } from "@/lib/assistant/crypto";
import { migrateV3 } from "@/lib/assistant/schemaV3";

declare global {
  var __eliasAssistantDb: ReturnType<typeof postgres> | undefined;
  var __eliasAssistantSchema: Promise<void> | undefined;
}

export function hasDb() {
  return Boolean(process.env.POSTGRES_URL);
}

export function sql() {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is not configured. Elias needs Postgres (Supabase) for memory, conversations, schedules and approvals.");
  globalThis.__eliasAssistantDb ||= postgres(process.env.POSTGRES_URL, { max: 1, prepare: false, onnotice: () => undefined });
  return globalThis.__eliasAssistantDb;
}

/** Creates the assistant tables once per process. Every statement is additive and idempotent. */
export async function ready() {
  const db = sql();
  globalThis.__eliasAssistantSchema ||= (async () => {
    await db`create table if not exists public.elias_conversations (
      id text primary key, user_id text not null, title text not null default 'New conversation',
      kind text not null default 'chat', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await db`create index if not exists elias_conversations_user_idx on public.elias_conversations(user_id, updated_at desc)`;
    await db`create table if not exists public.elias_messages (
      id bigserial primary key, conversation_id text not null references public.elias_conversations(id) on delete cascade,
      user_id text not null, role text not null, content text not null, meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now())`;
    await db`create index if not exists elias_messages_conversation_idx on public.elias_messages(conversation_id, id)`;
    await db`create table if not exists public.elias_memories (
      id text primary key, user_id text not null, kind text not null default 'fact', content text not null,
      source text not null default 'chat', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      tsv tsvector generated always as (to_tsvector('english', content)) stored)`;
    await db`create index if not exists elias_memories_user_idx on public.elias_memories(user_id, updated_at desc)`;
    await db`create index if not exists elias_memories_tsv_idx on public.elias_memories using gin(tsv)`;
    await db`create table if not exists public.elias_oauth_tokens (
      user_id text not null, provider text not null, email text, scope text, access_token text not null,
      refresh_token text, expires_at timestamptz, updated_at timestamptz not null default now(), primary key (user_id, provider))`;
    await db`create table if not exists public.elias_schedules (
      id text primary key, user_id text not null, name text not null, prompt text not null, spec jsonb not null,
      timezone text not null default 'UTC', conversation_id text, status text not null default 'active',
      next_run_at timestamptz, last_run_at timestamptz, last_result text, created_at timestamptz not null default now())`;
    await db`create index if not exists elias_schedules_due_idx on public.elias_schedules(status, next_run_at)`;
    await db`create table if not exists public.elias_approvals (
      id text primary key, user_id text not null, conversation_id text, tool text not null, args jsonb not null,
      summary text not null, status text not null default 'pending', result text,
      created_at timestamptz not null default now(), decided_at timestamptz)`;
    await db`create index if not exists elias_approvals_user_idx on public.elias_approvals(user_id, status, created_at desc)`;
    await db`create table if not exists public.elias_assistant_browsers (
      user_id text not null, conversation_id text not null, session_id text not null, connect_url text not null,
      updated_at timestamptz not null default now(), primary key (user_id, conversation_id))`;
    // v2 (additive): schedule kinds + per-schedule options, per-user settings, rate limits, imports.
    await db`alter table public.elias_schedules add column if not exists kind text not null default 'custom'`;
    await db`alter table public.elias_schedules add column if not exists options jsonb not null default '{}'::jsonb`;
    await db`create table if not exists public.elias_user_settings (
      user_id text primary key, timezone text, daily_brief_seeded_at timestamptz, legacy_import_at timestamptz,
      data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())`;
    await db`create table if not exists public.elias_rate_events (
      id bigserial primary key, bucket text not null, at timestamptz not null default now())`;
    await db`create index if not exists elias_rate_events_bucket_idx on public.elias_rate_events(bucket, at)`;
    await db`alter table public.elias_conversations add column if not exists source text not null default 'server'`;
    await migrateBackground(db);
    // v3 (additive): memory embeddings/entities, audit log, Telegram links, RLS on every elias_ table.
    await migrateV3(db);
    // v5 (additive): Google connection health (7-day testing expiry, revokes) and opt-in scopes (Drive).
    await db`alter table public.elias_oauth_tokens add column if not exists connected_at timestamptz`;
    await db`alter table public.elias_oauth_tokens add column if not exists status text not null default 'ok'`;
    await db`alter table public.elias_oauth_tokens add column if not exists last_error text`;
    await db`alter table public.elias_oauth_tokens add column if not exists extra_scopes text not null default ''`;
  })().catch((error) => { globalThis.__eliasAssistantSchema = undefined; throw error; });
  await globalThis.__eliasAssistantSchema;
  return db;
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

/** AES-256-GCM for OAuth tokens at rest (ELIAS_ENCRYPTION_KEY; legacy and plaintext rows are still readable). */
export function encrypt(value: string) {
  return encryptSecret(value);
}

export function decrypt(value: string) {
  return decryptSecret(value);
}
