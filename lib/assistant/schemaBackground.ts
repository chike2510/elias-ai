import type postgres from "postgres";

/** v3 (additive, idempotent): Web Push subscriptions and background jobs. Called from ready(). */
export async function migrateBackground(db: ReturnType<typeof postgres>) {
  await db`create table if not exists public.elias_push_subscriptions (
    id text primary key, user_id text not null, endpoint text not null unique, p256dh text not null, auth text not null,
    user_agent text, created_at timestamptz not null default now(), last_success_at timestamptz, failures int not null default 0)`;
  await db`create index if not exists elias_push_subscriptions_user_idx on public.elias_push_subscriptions(user_id)`;
  await db`create table if not exists public.elias_jobs (
    id text primary key, user_id text not null, conversation_id text not null, work_conversation_id text,
    title text not null, kind text not null default 'task', prompt text not null,
    status text not null default 'queued', steps jsonb not null default '[]'::jsonb, result text, error text,
    slices int not null default 0, max_slices int not null default 6, claims int not null default 0, approval_ids jsonb not null default '[]'::jsonb,
    timezone text not null default 'Africa/Lagos', lease_owner text, lease_until timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz)`;
  await db`create index if not exists elias_jobs_user_idx on public.elias_jobs(user_id, created_at desc)`;
  await db`create index if not exists elias_jobs_due_idx on public.elias_jobs(status, lease_until)`;
}
