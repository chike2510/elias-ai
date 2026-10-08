import { newId, ready } from "@/lib/assistant/db";
import type { Flashcard, QuizItem } from "@/lib/study";

/**
 * Library: the user's files, server-side (elias_files, RLS on). Chat attachments and Library uploads
 * are saved here with their extracted text; study aids (summary, quiz, flashcards) are cached in `study`.
 * Original bytes are kept only for Library uploads up to MAX_STORED_BYTES, so a file can be downloaded again.
 */

export type FileKind = "upload" | "attachment" | "generated";
export type StudyAids = { summary?: string; quiz?: QuizItem[]; flashcards?: Flashcard[] };
export type LibraryFile = {
  id: string; name: string; mime: string; size: number; kind: FileKind; chars: number; pageCount: number | null; truncated: boolean;
  conversationId: string | null; hasData: boolean; study: StudyAids; createdAt: string; updatedAt: string; text?: string;
};

export const MAX_STORED_TEXT = 200_000;
export const MAX_STORED_BYTES = 5_000_000;
const KINDS = new Set<FileKind>(["upload", "attachment", "generated"]);

let migrated: Promise<void> | undefined;

export async function filesDb() {
  const db = await ready();
  migrated ||= (async () => {
    await db`create table if not exists public.elias_files (
      id text primary key, user_id text not null, name text not null, mime text not null default 'application/octet-stream',
      size int not null default 0, kind text not null default 'upload', text text not null default '', chars int not null default 0,
      page_count int, truncated boolean not null default false, data bytea, conversation_id text,
      study jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await db`create index if not exists elias_files_user_idx on public.elias_files(user_id, created_at desc)`;
    // The app connects as the table owner and bypasses RLS; with RLS on and no policies, Supabase's anon/authenticated roles can't touch it.
    await db`alter table public.elias_files enable row level security`;
  })().catch((error) => { migrated = undefined; throw error; });
  await migrated;
  return db;
}

function toFile(item: Record<string, unknown>, withText = false): LibraryFile {
  const iso = (value: unknown) => new Date(value as string).toISOString();
  const study = typeof item.study === "string" ? JSON.parse(item.study as string) : (item.study || {});
  return {
    id: String(item.id), name: String(item.name), mime: String(item.mime), size: Number(item.size || 0), kind: (KINDS.has(item.kind as FileKind) ? item.kind : "upload") as FileKind,
    chars: Number(item.chars || 0), pageCount: item.page_count == null ? null : Number(item.page_count), truncated: Boolean(item.truncated),
    conversationId: (item.conversation_id as string) || null, hasData: Boolean(item.has_data), study: study as StudyAids,
    createdAt: iso(item.created_at), updatedAt: iso(item.updated_at), ...(withText ? { text: String(item.text || "") } : {}),
  };
}

export async function saveFile(userId: string, input: { name: string; mime?: string; size?: number; kind?: FileKind; text: string; pageCount?: number | null; truncated?: boolean; data?: Buffer | null; conversationId?: string | null }) {
  const db = await filesDb();
  const text = input.text.replace(/\u0000/g, "");
  const stored = text.slice(0, MAX_STORED_TEXT);
  const kind = input.kind && KINDS.has(input.kind) ? input.kind : "upload";
  const data = input.data && input.data.length <= MAX_STORED_BYTES ? input.data : null;
  const rows = await db`insert into public.elias_files (id, user_id, name, mime, size, kind, text, chars, page_count, truncated, data, conversation_id)
    values (${newId("file")}, ${userId}, ${input.name.slice(0, 200)}, ${(input.mime || "application/octet-stream").slice(0, 120)}, ${Math.max(0, Math.round(input.size || 0))}, ${kind},
      ${stored}, ${text.length}, ${input.pageCount ?? null}, ${Boolean(input.truncated) || text.length > MAX_STORED_TEXT}, ${data}, ${input.conversationId || null})
    returning id, name, mime, size, kind, chars, page_count, truncated, conversation_id, (data is not null) as has_data, study, created_at, updated_at`;
  return toFile(rows[0]);
}

export async function listFiles(userId: string, options: { q?: string; limit?: number } = {}) {
  const db = await filesDb();
  const q = (options.q || "").trim().slice(0, 100);
  const limit = Math.max(1, Math.min(200, options.limit || 100));
  const rows = q
    ? await db`select id, name, mime, size, kind, chars, page_count, truncated, conversation_id, (data is not null) as has_data, study, created_at, updated_at
        from public.elias_files where user_id = ${userId} and (name ilike ${`%${q}%`} or text ilike ${`%${q}%`}) order by created_at desc limit ${limit}`
    : await db`select id, name, mime, size, kind, chars, page_count, truncated, conversation_id, (data is not null) as has_data, study, created_at, updated_at
        from public.elias_files where user_id = ${userId} order by created_at desc limit ${limit}`;
  return rows.map((item) => toFile(item));
}

export async function getFile(userId: string, id: string) {
  const db = await filesDb();
  const found = (await db`select id, name, mime, size, kind, text, chars, page_count, truncated, conversation_id, (data is not null) as has_data, study, created_at, updated_at
    from public.elias_files where id = ${id} and user_id = ${userId}`)[0];
  return found ? toFile(found, true) : null;
}

export async function getFileData(userId: string, id: string) {
  const db = await filesDb();
  const found = (await db`select name, mime, data from public.elias_files where id = ${id} and user_id = ${userId}`)[0];
  return found?.data ? { name: String(found.name), mime: String(found.mime), data: Buffer.from(found.data as Uint8Array) } : null;
}

export async function renameFile(userId: string, id: string, name: string) {
  const db = await filesDb();
  const rows = await db`update public.elias_files set name = ${name.slice(0, 200)}, updated_at = now() where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

export async function saveStudy(userId: string, id: string, patch: StudyAids) {
  const db = await filesDb();
  const rows = await db`update public.elias_files set study = study || ${db.json(patch as never)}, updated_at = now() where id = ${id} and user_id = ${userId} returning study`;
  return rows[0] ? (typeof rows[0].study === "string" ? JSON.parse(rows[0].study as string) : rows[0].study) as StudyAids : null;
}

export async function deleteFile(userId: string, id: string) {
  const db = await filesDb();
  const rows = await db`delete from public.elias_files where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}
