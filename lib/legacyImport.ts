"use client";

import { getConversations, getMemories, type ConversationRecord } from "@/lib/persistence";
import { announceConversationsChanged, api } from "@/lib/chatClient";

const DONE_KEY = "elias.legacyImport.v1";
const IDS_KEY = "elias.legacyImport.v1.ids";
const BATCH_BYTES = 2_500_000;

/** Map from old local conversation id to its server id, so old /chat?id= links keep working. */
export function importedIdFor(localId: string): string | null {
  try { return (JSON.parse(window.localStorage.getItem(IDS_KEY) || "{}") as Record<string, string>)[localId] || null; } catch { return null; }
}

let running: Promise<number> | null = null;

/**
 * One-time upload of IndexedDB conversations (and local memories) to the server. Idempotent on
 * both sides: the server keys each conversation by its local id, and the browser records which
 * ones are done. Local data is left in place; nothing is deleted.
 */
export function migrateLegacyConversations(): Promise<number> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(0);
  if (window.localStorage.getItem(DONE_KEY)) return Promise.resolve(0);
  running ||= (async () => {
    const done = JSON.parse(window.localStorage.getItem(IDS_KEY) || "{}") as Record<string, string>;
    let conversations: ConversationRecord[] = [];
    try { conversations = await getConversations(); } catch { conversations = []; }
    const pending = conversations.filter((item) => item?.id && !done[item.id] && item.messages?.some((message) => message.role !== "system" && message.content?.trim()));
    let memories: Array<{ content: string; kind: string }> = [];
    try { memories = (await getMemories()).map((item) => ({ content: `${item.title}: ${item.value}`.slice(0, 600), kind: item.kind === "preference" ? "preference" : item.kind === "project" ? "project" : "fact" })); } catch { memories = []; }
    let imported = 0;
    const batches: ConversationRecord[][] = [];
    let batch: ConversationRecord[] = [];
    let size = 0;
    for (const item of pending) {
      const slim = { id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messages: item.messages.map((message) => ({ role: message.role, content: message.content, createdAt: message.createdAt })) } as ConversationRecord;
      const bytes = JSON.stringify(slim).length;
      if (batch.length && (size + bytes > BATCH_BYTES || batch.length >= 25)) { batches.push(batch); batch = []; size = 0; }
      batch.push(slim); size += bytes;
    }
    if (batch.length) batches.push(batch);
    if (!batches.length) batches.push([]);
    for (const [index, items] of batches.entries()) {
      const result = await api<{ imported: string[]; skipped: string[]; map: Record<string, string> }>("/api/assistant/import", { method: "POST", body: JSON.stringify({ conversations: items, memories: index === 0 ? memories : [] }) });
      Object.assign(done, result.map);
      imported += result.imported.length;
      window.localStorage.setItem(IDS_KEY, JSON.stringify(done));
    }
    window.localStorage.setItem(DONE_KEY, new Date().toISOString());
    if (imported) announceConversationsChanged();
    return imported;
  })().finally(() => { running = null; });
  return running;
}
