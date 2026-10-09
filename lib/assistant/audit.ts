import { ready } from "@/lib/assistant/db";

/** Tools that change something outside this conversation. Every call to one is written to elias_audit_log. */
export const SIDE_EFFECT_TOOLS = new Set([
  "memory_save", "memory_update", "memory_forget",
  "gmail_draft", "gmail_send", "calendar_create", "calendar_delete",
  "schedule_create", "schedule_update",
  "browser_click", "browser_type", "browser_select",
  "github_issue_create", "vercel_redeploy",
  "code_commit", "code_open_pr", "code_merge_pr",
]);

/* v5 Google (appended): reply drafts and event moves change the user's Gmail / Calendar. */
SIDE_EFFECT_TOOLS.add("gmail_draft_reply");
SIDE_EFFECT_TOOLS.add("calendar_move");

export const isSideEffect = (tool: string) => SIDE_EFFECT_TOOLS.has(tool);

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cvv|cvc|otp|pin\b|card/i;
const CARD_NUMBER = /\b(?:\d[ -]?){13,19}\b/g;

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { value *= 2; if (value > 9) value -= 9; }
    sum += value;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** Masks anything that looks like a payment card number. */
export function redactText(text: string) {
  return text.replace(CARD_NUMBER, (match) => luhn(match.replace(/\D/g, "")) ? "[card redacted]" : match);
}

/** A short, redacted, human summary of a tool call's arguments for the audit log. */
export function summarizeArgs(args: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(args)) {
    if (key.startsWith("_")) continue;
    let value: string;
    if (SECRET_KEY.test(key)) value = "[redacted]";
    else if (typeof raw === "string") value = redactText(raw).replace(/\s+/g, " ").slice(0, key === "body" || key === "prompt" ? 60 : 120) + (raw.length > (key === "body" || key === "prompt" ? 60 : 120) ? "…" : "");
    else value = redactText(JSON.stringify(raw ?? null)).slice(0, 120);
    parts.push(`${key}=${value}`);
  }
  return parts.join("; ").slice(0, 600);
}

/**
 * Hard safety rules that hold whatever the model says: never type a payment card number or a password
 * into a page, and never call a tool that moves money. Returns the reason to refuse, or null.
 */
export function unsafeCall(tool: string, args: Record<string, unknown>) {
  if (/(^|_)(transfer|payout|withdraw|charge|refund|send_money|initiate_payment)/.test(tool)) return "Elias never initiates payments or transfers.";
  const text = JSON.stringify(args);
  const cards = text.match(CARD_NUMBER) || [];
  if (cards.some((match) => luhn(match.replace(/\D/g, "")))) return "That includes a payment card number. Elias never types or sends card numbers; the user should enter them on the site themselves.";
  if (tool === "browser_type" && /password|passcode|one[- ]time|otp/i.test(String(args.field || args.label || ""))) return "Elias never types passwords or one-time codes.";
  return null;
}

export type AuditEntry = { id: number; tool: string; argsSummary: string; status: string; result: string | null; approvalId: string | null; conversationId: string | null; origin: string; createdAt: string };

export async function recordAudit(entry: { userId: string; tool: string; args: Record<string, unknown>; status: "ok" | "error" | "pending_approval" | "declined" | "blocked"; result?: unknown; approvalId?: string | null; conversationId?: string | null; origin?: string }) {
  try {
    const db = await ready();
    const result = entry.result === undefined ? null : redactText(typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result) ?? "null").slice(0, 300);
    await db`insert into public.elias_audit_log (user_id, tool, args_summary, status, result, approval_id, conversation_id, origin)
      values (${entry.userId}, ${entry.tool}, ${summarizeArgs(entry.args)}, ${entry.status}, ${result}, ${entry.approvalId || null}, ${entry.conversationId || null}, ${entry.origin || "chat"})`;
  } catch { /* auditing must never break a turn */ }
}

export async function listAudit(userId: string, limit = 100): Promise<AuditEntry[]> {
  const db = await ready();
  const rows = await db`select * from public.elias_audit_log where user_id = ${userId} order by id desc limit ${limit}`;
  return rows.map((item) => ({ id: Number(item.id), tool: String(item.tool), argsSummary: String(item.args_summary), status: String(item.status), result: (item.result as string) || null, approvalId: (item.approval_id as string) || null, conversationId: (item.conversation_id as string) || null, origin: String(item.origin), createdAt: new Date(item.created_at as string).toISOString() }));
}
