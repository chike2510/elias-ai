import { complete } from "@/lib/assistant/llm";
import { newId, ready } from "@/lib/assistant/db";
import { vectorSchema } from "@/lib/assistant/schemaV3";
import { embedder, embedTexts, toVectorLiteral } from "@/lib/assistant/embeddings";

export type MemoryKind = "profile" | "preference" | "person" | "place" | "project" | "fact";
export type Memory = { id: string; kind: MemoryKind; content: string; entity: string | null; source: string; updatedAt: string; createdAt: string; confirmedAt: string | null; embedded: boolean; created?: boolean; score?: number };

export const MEMORY_KINDS: MemoryKind[] = ["person", "place", "project", "preference", "profile", "fact"];
function normalizeKind(kind?: string): MemoryKind { return MEMORY_KINDS.includes(kind as MemoryKind) ? kind as MemoryKind : "fact"; }
const cleanEntity = (entity?: string | null) => (entity || "").replace(/\s+/g, " ").trim().slice(0, 80) || null;

function row(item: Record<string, unknown>): Memory {
  const iso = (value: unknown) => value ? new Date(value as string).toISOString() : null;
  return {
    id: String(item.id), kind: normalizeKind(String(item.kind)), content: String(item.content), entity: (item.entity as string) || null, source: String(item.source),
    updatedAt: iso(item.updated_at)!, createdAt: iso(item.created_at) || iso(item.updated_at)!, confirmedAt: iso(item.confirmed_at), embedded: Boolean(item.embedding_model),
    ...(typeof item.similarity === "number" ? { score: Number(item.similarity) } : {}),
  };
}

/** Columns we read back (never the raw embedding: it's large and the client doesn't need it). */
const COLUMNS = "id, user_id, kind, content, entity, source, created_at, updated_at, confirmed_at, embedding_model";

export async function listMemories(userId: string, limit = 300) {
  const db = await ready();
  const rows = await db.unsafe(`select ${COLUMNS} from public.elias_memories where user_id = $1 order by updated_at desc limit $2`, [userId, limit]);
  return rows.map(row);
}

/** Same memories, grouped by category for the Memory screen. */
export async function groupedMemories(userId: string) {
  const items = await listMemories(userId);
  return MEMORY_KINDS.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })).filter((group) => group.items.length);
}

async function fullTextSearch(userId: string, query: string, limit: number) {
  const db = await ready();
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2).slice(0, 12).join(" | ");
  if (!terms) return [];
  const rows = await db.unsafe(`select ${COLUMNS}, ts_rank(tsv, to_tsquery('english', $2)) as rank from public.elias_memories
    where user_id = $1 and tsv @@ to_tsquery('english', $2) order by rank desc, updated_at desc limit $3`, [userId, terms, limit]);
  return rows.map(row);
}

/** Cosine similarity floor for vector-only hits, per model (gte-small scores unrelated text around 0.72-0.77). */
function similarityFloor(model: string) {
  if (model === "gte-small") return 0.775;
  if (model === "mistral-embed") return 0.75;
  if (model.startsWith("hash")) return 0.3;
  return 0.55;
}

async function vectorSearch(userId: string, query: string, limit: number) {
  const schema = vectorSchema();
  if (!schema) return [];
  const embedded = await embedTexts([query]);
  if (!embedded) return [];
  const db = await ready();
  const q = `"${schema}"`;
  const rows = await db.unsafe(`select ${COLUMNS}, (1 - (embedding operator(${q}.<=>) $2::${q}.vector))::float8 as similarity from public.elias_memories
    where user_id = $1 and embedding is not null and embedding_model = $3 order by embedding operator(${q}.<=>) $2::${q}.vector limit $4`, [userId, toVectorLiteral(embedded.vectors[0]), embedded.model, limit]);
  const floor = similarityFloor(embedded.model);
  return rows.map(row).filter((item) => (item.score ?? 0) >= floor);
}

/**
 * Hybrid recall: full-text and vector results merged by reciprocal rank fusion.
 * Without pgvector or an embeddings provider this is plain full-text search.
 */
export async function searchMemories(userId: string, query: string, limit = 8) {
  const [text, vector] = await Promise.all([
    fullTextSearch(userId, query, 20).catch(() => [] as Memory[]),
    vectorSearch(userId, query, 20).catch(() => [] as Memory[]),
  ]);
  if (!vector.length) return text.slice(0, limit);
  const scores = new Map<string, { item: Memory; score: number }>();
  const add = (list: Memory[], weight: number) => list.forEach((item, index) => {
    const current = scores.get(item.id);
    const score = weight / (60 + index);
    scores.set(item.id, { item: current?.item.score !== undefined ? current.item : item, score: (current?.score || 0) + score });
  });
  add(text, 1);
  add(vector, 1);
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.item);
}

async function storeEmbedding(ids: string[], texts: string[]) {
  if (!vectorSchema() || !ids.length) return 0;
  const embedded = await embedTexts(texts);
  if (!embedded) return 0;
  const db = await ready();
  const q = `"${vectorSchema()}"`;
  for (let i = 0; i < ids.length; i += 1) await db.unsafe(`update public.elias_memories set embedding = $1::${q}.vector, embedding_model = $2 where id = $3`, [toVectorLiteral(embedded.vectors[i]), embedded.model, ids[i]]);
  return ids.length;
}

/** Embeds memories that have no vector yet (or one from another model). Best effort; returns how many were embedded. */
export async function backfillEmbeddings(limit = 32, userId?: string) {
  if (!vectorSchema()) { await ready(); if (!vectorSchema()) return 0; }
  const active = embedder();
  if (!active) return 0;
  const db = await ready();
  const rows = userId
    ? await db`select id, content, entity from public.elias_memories where user_id = ${userId} and (embedding_model is null or embedding_model <> ${active.model}) order by updated_at desc limit ${limit}`
    : await db`select id, content, entity from public.elias_memories where embedding_model is null or embedding_model <> ${active.model} order by updated_at desc limit ${limit}`;
  return storeEmbedding(rows.map((item) => String(item.id)), rows.map((item) => embedText(String(item.content), item.entity as string | null)));
}

const embedText = (content: string, entity?: string | null) => entity ? `${entity}: ${content}` : content;

/** Saves a memory unless a near-identical one exists; returns the stored record. */
export async function saveMemory(userId: string, content: string, kind?: string, source = "chat", entity?: string | null) {
  const db = await ready();
  const text = content.trim().slice(0, 600);
  if (!text) throw new Error("Memory content is empty.");
  const existing = await db.unsafe(`select ${COLUMNS} from public.elias_memories where user_id = $1 and lower(content) = $2 limit 1`, [userId, text.toLowerCase()]);
  if (existing[0]) {
    await db`update public.elias_memories set updated_at = now() where id = ${existing[0].id as string}`;
    return { ...row(existing[0]), created: false };
  }
  const id = newId("mem");
  const rows = await db`insert into public.elias_memories (id, user_id, kind, content, source, entity) values (${id}, ${userId}, ${normalizeKind(kind)}, ${text}, ${source}, ${cleanEntity(entity)})
    returning id, user_id, kind, content, entity, source, created_at, updated_at, confirmed_at, embedding_model`;
  const embedded = await storeEmbedding([id], [embedText(text, cleanEntity(entity))]).catch(() => 0);
  return { ...row(rows[0]), embedded: embedded > 0, created: true };
}

export async function updateMemory(userId: string, id: string, content: string, patch: { kind?: string; entity?: string | null } = {}) {
  const db = await ready();
  const text = content.trim().slice(0, 600);
  if (!text) throw new Error("Memory content is empty.");
  const rows = await db`update public.elias_memories set content = ${text}, updated_at = now(), confirmed_at = now(),
    kind = coalesce(${patch.kind ? normalizeKind(patch.kind) : null}, kind),
    entity = case when ${patch.entity !== undefined} then ${cleanEntity(patch.entity)} else entity end
    where id = ${id} and user_id = ${userId} returning id, user_id, kind, content, entity, source, created_at, updated_at, confirmed_at, embedding_model`;
  if (!rows[0]) return null;
  await storeEmbedding([id], [embedText(text, rows[0].entity as string | null)]).catch(() => 0);
  return row(rows[0]);
}

/** The user said "yes, that's right" (weekly review). */
export async function confirmMemory(userId: string, id: string) {
  const db = await ready();
  const rows = await db.unsafe(`update public.elias_memories set confirmed_at = now() where id = $1 and user_id = $2 returning ${COLUMNS}`, [id, userId]);
  return rows[0] ? row(rows[0]) : null;
}

export async function deleteMemory(userId: string, id: string) {
  const db = await ready();
  const rows = await db`delete from public.elias_memories where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

/** What Elias learned in the last `days` days that the user hasn't confirmed yet (the weekly review). */
export async function recentlyLearned(userId: string, days = 7, limit = 12) {
  const db = await ready();
  const rows = await db.unsafe(`select ${COLUMNS} from public.elias_memories where user_id = $1 and created_at >= now() - ($2::int * interval '1 day')
    and confirmed_at is null order by created_at desc limit $3`, [userId, days, limit]);
  return rows.map(row);
}

/** The memory block injected into every turn: core profile facts plus whatever matches this message. */
export async function memoryContext(userId: string, query: string) {
  const [core, matches] = await Promise.all([
    ready().then((db) => db.unsafe(`select ${COLUMNS} from public.elias_memories where user_id = $1 and kind in ('profile','preference','person') order by updated_at desc limit 25`, [userId])).then((rows) => rows.map(row)),
    searchMemories(userId, query, 10).catch(() => [] as Memory[]),
  ]);
  const seen = new Set<string>();
  const items = [...core, ...matches].filter((item) => !seen.has(item.id) && seen.add(item.id));
  if (!items.length) return "No saved memories about this user yet.";
  return items.map((item) => `- [${item.id}] (${item.kind}${item.entity ? `: ${item.entity}` : ""}) ${item.content}`).join("\n");
}

/** After a turn, ask a model for durable facts worth remembering and store them. Best effort. */
export async function extractMemories(userId: string, userText: string, assistantText: string, known: string) {
  if (userText.trim().length < 12) return [];
  const prompt = `You maintain long-term memory for a personal assistant. From the exchange below, extract only durable facts about the USER worth remembering for months: identity, location, work, people in their life (with relation), standing preferences, ongoing projects, allergies, routines. Ignore one-off requests, small talk, and anything already known. Keep each fact one short sentence in third person, with any conditions the user attached. Never store passwords, card numbers or codes.\n\nFor each fact give a category (person, place, project, preference, profile, fact) and the entity it is about when there is one (a person's name, a place, a project name), else null.\n\nAlready known:\n${known}\n\nUser: ${userText.slice(0, 3000)}\nAssistant: ${assistantText.slice(0, 1500)}\n\nReply with JSON only: {"facts":[{"kind":"person|place|project|preference|profile|fact","entity":"Bola"|null,"content":"..."}]} or {"facts":[]}.`;
  try {
    const result = await complete([{ role: "user", content: prompt }], [], { temperature: 0 });
    const json = result.content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return [];
    const facts = (JSON.parse(json) as { facts?: Array<{ kind?: string; content?: string; entity?: string | null }> }).facts || [];
    const saved: Memory[] = [];
    for (const fact of facts.slice(0, 5)) if (fact.content && !/password|\b\d{12,19}\b|cvv|otp/i.test(fact.content)) saved.push(await saveMemory(userId, fact.content, fact.kind, "auto", typeof fact.entity === "string" ? fact.entity : null));
    return saved.filter((item) => item.created !== false);
  } catch {
    return [];
  }
}
