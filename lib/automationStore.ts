import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";

export type AutomationTrigger = "webhook" | "manual";
export type AutomationApprovalPolicy = "always" | "risky" | "never";
export type AutomationStatus = "active" | "paused";

export type AutomationRecord = {
  id: string;
  userId: string;
  name: string;
  description: string;
  objective: string;
  instructions: string;
  trigger: AutomationTrigger;
  approvalPolicy: AutomationApprovalPolicy;
  allowedTools: string[];
  preferredProvider?: string;
  preferredModel?: string;
  status: AutomationStatus;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
  webhookSecretHash?: string;
};

export type PublicAutomation = Omit<AutomationRecord, "webhookSecretHash" | "userId"> & { hasWebhookSecret: boolean };

type LocalState = { records: Map<string, AutomationRecord>; loaded: boolean };
declare global { var __eliasAutomationStore: LocalState | undefined; var __eliasAutomationDb: ReturnType<typeof postgres> | undefined; var __eliasAutomationSchema: Promise<void> | undefined; }

function storePath() { return process.env.ELIAS_AUTOMATION_STORE_PATH || join(process.cwd(), ".elias", "automations.json"); }
function useRemoteStore() {
  if (process.env.VERCEL && !process.env.POSTGRES_URL) throw new Error("Durable automation storage is not configured. Add POSTGRES_URL to the Vercel Production environment and redeploy.");
  return Boolean(process.env.POSTGRES_URL);
}
function db() { globalThis.__eliasAutomationDb ||= postgres(process.env.POSTGRES_URL!, { max: 1, prepare: false }); return globalThis.__eliasAutomationDb; }
async function ensureSchema() {
  if (!useRemoteStore()) return;
  globalThis.__eliasAutomationSchema ||= (async () => {
    await db()`create table if not exists public.elias_automations (id text primary key, user_id text not null, automation jsonb not null, updated_at timestamptz not null default now())`;
    // RLS on, no policies: the app connects as owner; Supabase anon/authenticated roles get nothing.
    await db()`alter table public.elias_automations enable row level security`;
    await db()`create index if not exists elias_automations_user_idx on public.elias_automations(user_id, updated_at desc)`;
  })();
  await globalThis.__eliasAutomationSchema;
}
function state() {
  if (!globalThis.__eliasAutomationStore) globalThis.__eliasAutomationStore = { records: new Map(), loaded: false };
  const current = globalThis.__eliasAutomationStore;
  if (!current.loaded) {
    current.loaded = true;
    const filePath = storePath();
    if (existsSync(filePath)) {
      try { const records = JSON.parse(readFileSync(filePath, "utf8")) as AutomationRecord[]; records.forEach((record) => current.records.set(record.id, record)); } catch { /* best effort local storage */ }
    }
  }
  return current;
}
function clone<T>(value: T): T { return structuredClone(value); }
function persistLocal() { try { const filePath = storePath(); mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, JSON.stringify([...state().records.values()]), "utf8"); } catch { /* best effort local storage */ } }
function decode(value: unknown): AutomationRecord | undefined {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return undefined; } })() : value;
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Partial<AutomationRecord>;
  if (typeof record.id !== "string" || typeof record.userId !== "string" || typeof record.name !== "string" || typeof record.objective !== "string") return undefined;
  return clone(record as AutomationRecord);
}
function publicRecord(record: AutomationRecord): PublicAutomation {
  const { userId: _userId, webhookSecretHash: _hash, ...rest } = record;
  return { ...rest, hasWebhookSecret: Boolean(record.webhookSecretHash) };
}
function hashSecret(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function makeWebhookSecret() { return `ela_${randomBytes(24).toString("base64url")}`; }
export function verifyWebhookSecret(record: AutomationRecord, secret: string) { return Boolean(record.webhookSecretHash && secret && hashSecret(secret) === record.webhookSecretHash); }

async function remoteList(userId: string) { await ensureSchema(); const rows = await db()<Array<{ automation: unknown }>>`select automation from public.elias_automations where user_id = ${userId} order by updated_at desc`; return rows.map((row) => decode(row.automation)).filter((record): record is AutomationRecord => Boolean(record)); }
async function remoteGet(id: string, userId: string) { await ensureSchema(); const rows = await db()<Array<{ automation: unknown }>>`select automation from public.elias_automations where id = ${id} and user_id = ${userId} limit 1`; return rows[0] ? decode(rows[0].automation) : undefined; }
async function remoteGetById(id: string) { await ensureSchema(); const rows = await db()<Array<{ automation: unknown }>>`select automation from public.elias_automations where id = ${id} limit 1`; return rows[0] ? decode(rows[0].automation) : undefined; }
async function remoteSave(record: AutomationRecord) { await ensureSchema(); record.updatedAt = Date.now(); await db()`insert into public.elias_automations (id, user_id, automation, updated_at) values (${record.id}, ${record.userId}, ${JSON.stringify(record)}::jsonb, now()) on conflict (id) do update set automation = excluded.automation, updated_at = now()`; return clone(record); }
async function save(record: AutomationRecord) { return useRemoteStore() ? remoteSave(record) : (() => { record.updatedAt = Date.now(); state().records.set(record.id, clone(record)); persistLocal(); return clone(record); })(); }

export async function listAutomations(userId: string) { const records = useRemoteStore() ? await remoteList(userId) : [...state().records.values()].filter((record) => record.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt); return records.map(publicRecord); }
export async function getAutomation(id: string, userId: string) { const record = useRemoteStore() ? await remoteGet(id, userId) : state().records.get(id); return record && record.userId === userId ? clone(record) : undefined; }
export async function getAutomationByIdForTrigger(id: string) { const record = useRemoteStore() ? await remoteGetById(id) : state().records.get(id); return record ? clone(record) : undefined; }
export async function createAutomation(input: Omit<AutomationRecord, "id" | "createdAt" | "updatedAt" | "runCount" | "webhookSecretHash"> & { webhookSecret?: string }) {
  const now = Date.now();
  const record: AutomationRecord = { ...input, id: `automation_${randomBytes(12).toString("hex")}`, createdAt: now, updatedAt: now, runCount: 0, webhookSecretHash: input.webhookSecret ? hashSecret(input.webhookSecret) : undefined };
  const saved = await save(record);
  return { record: publicRecord(saved), webhookSecret: input.webhookSecret };
}
export async function updateAutomation(id: string, userId: string, update: Partial<Pick<AutomationRecord, "name" | "description" | "objective" | "instructions" | "trigger" | "approvalPolicy" | "allowedTools" | "preferredProvider" | "preferredModel" | "status">>) {
  const record = await getAutomation(id, userId); if (!record) return undefined; Object.assign(record, update); return publicRecord(await save(record));
}
export async function deleteAutomation(id: string, userId: string) { const record = await getAutomation(id, userId); if (!record) return false; if (useRemoteStore()) { await ensureSchema(); await db()`delete from public.elias_automations where id = ${id} and user_id = ${userId}`; } else { state().records.delete(id); persistLocal(); } return true; }
export async function recordAutomationRun(id: string, userId: string) { const record = await getAutomation(id, userId); if (!record) return undefined; record.lastRunAt = Date.now(); record.runCount += 1; return save(record); }
export async function rotateWebhookSecret(id: string, userId: string) { const record = await getAutomation(id, userId); if (!record) return undefined; const secret = makeWebhookSecret(); record.webhookSecretHash = hashSecret(secret); await save(record); return { automation: publicRecord(record), webhookSecret: secret }; }
