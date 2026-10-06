import { complete } from "@/lib/assistant/llm";
import { newId, ready } from "@/lib/assistant/db";

export type MemoryKind = "profile" | "preference" | "person" | "place" | "project" | "fact";
export type Memory = { id: string; kind: MemoryKind; content: string; source: string; updatedAt: string };

const KINDS: MemoryKind[] = ["profile", "preference", "person", "place", "project", "fact"];
function normalizeKind(kind?: string): MemoryKind { return KINDS.includes(kind as MemoryKind) ? kind as MemoryKind : "fact"; }

function row(item: Record<string, unknown>): Memory {
  return { id: String(item.id), kind: normalizeKind(String(item.kind)), content: String(item.content), source: String(item.source), updatedAt: new Date(item.updated_at as string).toISOString() };
}

export async function listMemories(userId: string, limit = 200) {
  const db = await ready();
  const rows = await db`select * from public.elias_memories where user_id = ${userId} order by updated_at desc limit ${limit}`;
  return rows.map(row);
}

export async function searchMemories(userId: string, query: string, limit = 8) {
  const db = await ready();
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2).slice(0, 12).join(" | ");
  if (!terms) return [];
  const rows = await db`select *, ts_rank(tsv, to_tsquery('english', ${terms})) as rank from public.elias_memories
    where user_id = ${userId} and tsv @@ to_tsquery('english', ${terms}) order by rank desc, updated_at desc limit ${limit}`;
  return rows.map(row);
}

/** Saves a memory unless a near-identical one exists; returns the stored record. */
export async function saveMemory(userId: string, content: string, kind?: string, source = "chat") {
  const db = await ready();
  const text = content.trim().slice(0, 600);
  if (!text) throw new Error("Memory content is empty.");
  const existing = await db`select * from public.elias_memories where user_id = ${userId} and lower(content) = ${text.toLowerCase()} limit 1`;
  if (existing[0]) {
    await db`update public.elias_memories set updated_at = now() where id = ${existing[0].id as string}`;
    return row(existing[0]);
  }
  const id = newId("mem");
  const rows = await db`insert into public.elias_memories (id, user_id, kind, content, source) values (${id}, ${userId}, ${normalizeKind(kind)}, ${text}, ${source}) returning *`;
  return row(rows[0]);
}

export async function updateMemory(userId: string, id: string, content: string) {
  const db = await ready();
  const rows = await db`update public.elias_memories set content = ${content.trim().slice(0, 600)}, updated_at = now() where id = ${id} and user_id = ${userId} returning *`;
  return rows[0] ? row(rows[0]) : null;
}

export async function deleteMemory(userId: string, id: string) {
  const db = await ready();
  const rows = await db`delete from public.elias_memories where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

/** The memory block injected into every turn: core profile facts plus whatever matches this message. */
export async function memoryContext(userId: string, query: string) {
  const [core, matches] = await Promise.all([
    ready().then((db) => db`select * from public.elias_memories where user_id = ${userId} and kind in ('profile','preference','person') order by updated_at desc limit 25`).then((rows) => rows.map(row)),
    searchMemories(userId, query, 10).catch(() => [] as Memory[]),
  ]);
  const seen = new Set<string>();
  const items = [...core, ...matches].filter((item) => !seen.has(item.id) && seen.add(item.id));
  if (!items.length) return "No saved memories about this user yet.";
  return items.map((item) => `- [${item.id}] (${item.kind}) ${item.content}`).join("\n");
}

/** After a turn, ask a model for durable facts worth remembering and store them. Best effort. */
export async function extractMemories(userId: string, userText: string, assistantText: string, known: string) {
  if (userText.trim().length < 12) return [];
  const prompt = `You maintain long-term memory for a personal assistant. From the exchange below, extract only durable facts about the USER worth remembering for months: identity, location, work, people in their life (with relation), standing preferences, ongoing projects, allergies, routines. Ignore one-off requests, small talk, and anything already known. Keep each fact one short sentence in third person, with any conditions the user attached. Never store passwords, card numbers or codes.\n\nAlready known:\n${known}\n\nUser: ${userText.slice(0, 3000)}\nAssistant: ${assistantText.slice(0, 1500)}\n\nReply with JSON only: {"facts":[{"kind":"profile|preference|person|place|project|fact","content":"..."}]} or {"facts":[]}.`;
  try {
    const result = await complete([{ role: "user", content: prompt }], [], { temperature: 0 });
    const json = result.content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return [];
    const facts = (JSON.parse(json) as { facts?: Array<{ kind?: string; content?: string }> }).facts || [];
    const saved: Memory[] = [];
    for (const fact of facts.slice(0, 5)) if (fact.content && !/password|\b\d{12,19}\b|cvv|otp/i.test(fact.content)) saved.push(await saveMemory(userId, fact.content, fact.kind, "auto"));
    return saved;
  } catch {
    return [];
  }
}
