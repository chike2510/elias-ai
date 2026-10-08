/**
 * Postgres store for the coding agent's working set (elias_code_sets): one row per conversation
 * holding the repo, base commit, branch and every staged file change. RLS is enabled with no
 * policies, like every elias_ table: the app connects as the owner, anon/authenticated keys see nothing.
 */
import { ready } from "@/lib/assistant/db";
import type { CodeSet, CodeStore } from "@/lib/assistant/code/github";

declare global {
  var __eliasCodeSchema: Promise<void> | undefined;
}

type Db = Awaited<ReturnType<typeof ready>>;

export async function migrateCode(db: Db) {
  globalThis.__eliasCodeSchema ||= (async () => {
    await db`create table if not exists public.elias_code_sets (
      id text primary key, user_id text not null, conversation_id text not null, repo text not null,
      base_branch text not null, base_sha text not null, branch text, branch_created boolean not null default false,
      files jsonb not null default '{}'::jsonb, commits jsonb not null default '[]'::jsonb, pr_number integer,
      verify jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await db`create unique index if not exists elias_code_sets_conv_idx on public.elias_code_sets(user_id, conversation_id)`;
    await db`alter table public.elias_code_sets enable row level security`.catch(() => undefined);
  })().catch((error) => { globalThis.__eliasCodeSchema = undefined; throw error; });
  await globalThis.__eliasCodeSchema;
}

const parse = (value: unknown, fallback: unknown) => {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return fallback; } }
  return value ?? fallback;
};

function fromRow(row: Record<string, unknown>): CodeSet {
  return {
    id: String(row.id), userId: String(row.user_id), conversationId: String(row.conversation_id), repo: String(row.repo),
    baseBranch: String(row.base_branch), baseSha: String(row.base_sha), branch: row.branch ? String(row.branch) : null,
    branchCreated: Boolean(row.branch_created), files: parse(row.files, {}) as CodeSet["files"], commits: parse(row.commits, []) as CodeSet["commits"],
    prNumber: row.pr_number == null ? null : Number(row.pr_number), verify: parse(row.verify, null) as CodeSet["verify"],
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export const postgresCodeStore: CodeStore = {
  async get(userId, conversationId) {
    const db = await ready();
    await migrateCode(db);
    const rows = await db`select * from public.elias_code_sets where user_id = ${userId} and conversation_id = ${conversationId} limit 1`;
    return rows[0] ? fromRow(rows[0]) : null;
  },
  async latest(userId) {
    const db = await ready();
    await migrateCode(db);
    const rows = await db`select * from public.elias_code_sets where user_id = ${userId} order by updated_at desc limit 1`;
    return rows[0] ? fromRow(rows[0]) : null;
  },
  async save(set) {
    const db = await ready();
    await migrateCode(db);
    await db`insert into public.elias_code_sets (id, user_id, conversation_id, repo, base_branch, base_sha, branch, branch_created, files, commits, pr_number, verify, updated_at)
      values (${set.id}, ${set.userId}, ${set.conversationId}, ${set.repo}, ${set.baseBranch}, ${set.baseSha}, ${set.branch}, ${set.branchCreated},
        ${db.json(set.files as never)}, ${db.json(set.commits as never)}, ${set.prNumber}, ${set.verify ? db.json(set.verify as never) : null}, now())
      on conflict (user_id, conversation_id) do update set id = excluded.id, repo = excluded.repo, base_branch = excluded.base_branch, base_sha = excluded.base_sha,
        branch = excluded.branch, branch_created = excluded.branch_created, files = excluded.files, commits = excluded.commits,
        pr_number = excluded.pr_number, verify = excluded.verify, updated_at = now()`;
  },
  async remove(userId, conversationId) {
    const db = await ready();
    await migrateCode(db);
    await db`delete from public.elias_code_sets where user_id = ${userId} and conversation_id = ${conversationId}`;
  },
};
