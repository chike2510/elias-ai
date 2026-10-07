import type postgres from "postgres";

type Db = ReturnType<typeof postgres>;

declare global {
  /** Schema that holds the pgvector type ("extensions" on Supabase), or null when pgvector is unavailable (e.g. PGlite tests). */
  var __eliasVectorSchema: string | null | undefined;
}

/** pgvector's schema, once migrations ran. null means "no vectors: use full-text only". */
export function vectorSchema() {
  return globalThis.__eliasVectorSchema ?? null;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function detectVector(db: Db) {
  if (process.env.ELIAS_DISABLE_VECTOR === "1") return null;
  // Supabase keeps extensions in the "extensions" schema; elsewhere (PGlite, plain Postgres) use the default schema.
  // Check first instead of letting a statement fail: a failed statement can roll back the fallback on PGlite.
  const hasExtensionsSchema = (await db`select 1 from pg_namespace where nspname = 'extensions'`.catch(() => [])).length > 0;
  if (hasExtensionsSchema) await db`create extension if not exists vector with schema extensions`.catch(() => undefined);
  else await db`create extension if not exists vector`.catch(() => undefined);
  const rows = await db`select extnamespace::regnamespace::text as schema from pg_extension where extname = 'vector'`.catch(() => []);
  return rows[0]?.schema ? String(rows[0].schema).replace(/^"|"$/g, "") : null;
}

/** v3 additions. Every statement is additive and idempotent; pgvector is optional. */
export async function migrateV3(db: Db) {
  // Memory: the named entity a memory is about, user confirmation (weekly review), and embeddings.
  await db`alter table public.elias_memories add column if not exists entity text`;
  await db`alter table public.elias_memories add column if not exists confirmed_at timestamptz`;
  await db`alter table public.elias_memories add column if not exists embedding_model text`;
  const schema = await detectVector(db);
  if (schema) {
    try {
      // Dimensionless column: the active model decides the size (gte-small 384, mistral-embed 1024, ...); rows are only compared within one model.
      await db.unsafe(`alter table public.elias_memories add column if not exists embedding ${quote(schema)}.vector`);
      globalThis.__eliasVectorSchema = schema;
    } catch {
      globalThis.__eliasVectorSchema = null;
    }
  } else {
    globalThis.__eliasVectorSchema = null;
  }

  // Audit log: every tool call with side effects.
  await db`create table if not exists public.elias_audit_log (
    id bigserial primary key, user_id text not null, tool text not null, args_summary text not null default '',
    status text not null, result text, approval_id text, conversation_id text, origin text not null default 'chat',
    created_at timestamptz not null default now())`;
  await db`create index if not exists elias_audit_log_user_idx on public.elias_audit_log(user_id, created_at desc)`;

  // Telegram: chat id -> user, and short-lived link codes shown on the You page.
  await db`create table if not exists public.elias_telegram_links (
    chat_id text primary key, user_id text not null, username text, conversation_id text, linked_at timestamptz not null default now())`;
  await db`create index if not exists elias_telegram_links_user_idx on public.elias_telegram_links(user_id)`;
  await db`create table if not exists public.elias_telegram_codes (
    code text primary key, user_id text not null, expires_at timestamptz not null)`;

  // RLS on: the app connects as the table owner (postgres) and bypasses RLS; with no policies,
  // the Supabase anon/authenticated roles (PostgREST) can't read or write these tables.
  const open = await db`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'elias\\_%' and not c.relrowsecurity`.catch(() => []);
  for (const item of open) await db.unsafe(`alter table public.${quote(String(item.relname))} enable row level security`).catch(() => undefined);
}
