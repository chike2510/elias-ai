import { createHash } from "node:crypto";
import { completeStream, type LlmMessage } from "@/lib/assistant/llm";
import { newId, ready } from "@/lib/assistant/db";
import { extractMemories, memoryContext, saveMemory } from "@/lib/assistant/memory";
import { approvalSummary, hasTool, runTool, toolSchemas, type ToolContext } from "@/lib/assistant/tools";
import { browserConfigured, closeAll, type BrowserHandle } from "@/lib/assistant/browser";
import { googleConfigured, googleConnection } from "@/lib/assistant/google";
import { approvalDetails, cardFor, EDITABLE_ARGS, statusLabel, type ApprovalDetails, type Card, type ConnectCard, type MemoryChip } from "@/lib/assistant/cards";
import { briefCards, type BriefData } from "@/lib/assistant/brief";

const MAX_STEPS = 10;
const HISTORY_MESSAGES = 30;

export type Approval = { id: string; tool: string; summary: string; status: string; createdAt: string; conversationId: string | null; result?: string | null; details: ApprovalDetails; editable: string[] };
export type StoredMessage = { id: number; role: "user" | "assistant" | "event"; content: string; meta: Record<string, unknown>; createdAt: string };
export type TurnResult = { conversationId: string; messageId?: number; reply: string; approvals: Approval[]; actions: Array<{ tool: string; ok: boolean }>; model?: string; memoriesSaved?: number; memories: MemoryChip[]; cards: Card[]; connect: ConnectCard[]; steps: string[] };

/** Events streamed to the client while a turn runs. */
export type TurnEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "status"; id: string; tool: string; label: string }
  | { type: "tool_done"; id: string; tool: string; ok: boolean }
  | { type: "card"; card: Card }
  | { type: "connect"; connect: ConnectCard }
  | { type: "approval"; approval: Approval }
  | { type: "memory"; memory: MemoryChip }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; result: TurnResult }
  | { type: "error"; message: string };

type RunOptions = {
  userId: string; userName?: string; conversationId?: string; text: string; timezone?: string; githubToken?: string;
  origin?: "chat" | "schedule" | "approval";
  onEvent?: (event: TurnEvent) => void;
  /** Turn-only context appended to the system prompt (not stored in the conversation). */
  extraContext?: string;
  /** Cards to attach to the reply regardless of tool use (e.g. the daily brief). */
  presetCards?: Card[];
  title?: string;
};

function systemPrompt(input: { name?: string; timezone: string; memories: string; googleEmail: string | null; googleConfigured: boolean; browser: boolean; origin: string; extra?: string }) {
  const now = new Date();
  return `You are Elias, a personal AI that runs errands across the user's life: memory of them, their Gmail and Calendar, the web, a real browser, GitHub, weather and scheduled tasks.

VOICE: You are texting. Reply like a sharp, warm friend would by text message.
- 1 to 3 short sentences, usually under 50 words. Answer first. Take a side when recommending.
- No headings, no bold labels, no bullet walls. A short list (max 5 items, one line each) only when the user asked for several things.
- The chat shows cards for search results, emails, calendar events, weather and approvals. Do not repeat what a card shows: give the one-line takeaway ("3 unread, the one from your bank needs a reply today").
- Links: at most one inline link, only when it's the thing they need.
- Use tables only when the user asks to compare things.
- No filler ("Great question", "I'd be happy to", "Let me know if").

NOW: ${now.toLocaleString("en-GB", { timeZone: input.timezone, dateStyle: "full", timeStyle: "short" })} (${input.timezone}). ISO ${now.toISOString()}.
USER: ${input.name || "unknown name"}.
GOOGLE: ${input.googleEmail ? `connected as ${input.googleEmail}` : input.googleConfigured ? "not connected. If a request needs Gmail or Calendar, still call the tool: the chat shows the user a Connect Google button." : "not available on this server yet (the owner hasn't added Google OAuth keys). Say so in one line if they ask for email or calendar."}
BROWSER: ${input.browser ? "available" : "not configured; use web_search/web_open, and say interactive browsing isn't set up if they need it"}.

WHAT YOU REMEMBER ABOUT THE USER (use it quietly, never recite it):
${input.memories}

RULES
- Use tools instead of guessing. Search the web for anything current (prices, news, hours, scores) and open a page before stating facts the user will act on.
- "Plan my day", "brief me", "what's my day like": call daily_brief once, then reply with the plan in a few lines.
- When the user tells you a durable fact about themselves, their people, places or preferences, call memory_save. If something changed, memory_update. If they ask you to forget, memory_forget.
- Prefer web_search/web_open for reading. Use browser_* only for interaction (forms, carts, bookings, logged-in pages).
- Sending email, inviting people, deleting events, paying, ordering or booking all go through an approval card: just call the tool; the system pauses it for the user. Then tell the user in one line what is waiting on their tap. Never claim something was sent or bought unless the tool result says so.
- Never ask for or type passwords, card numbers or one-time codes in chat.
- For "remind me", "every morning", "check daily" requests, use schedule_create with a self-contained prompt.
- If a tool fails, try another way once, then say plainly what blocked you and the next option.
${input.origin === "schedule" ? "- This turn was started by a scheduled task, not by the user typing. Do the job and reply with the result only. If nothing noteworthy, say so in one line." : ""}${input.extra ? `\n\n${input.extra}` : ""}`;
}

export async function ensureConversation(userId: string, conversationId: string | undefined, title: string, kind = "chat") {
  const db = await ready();
  if (conversationId) {
    const found = await db`select id from public.elias_conversations where id = ${conversationId} and user_id = ${userId}`;
    if (found[0]) return conversationId;
  }
  const id = newId("conv");
  await db`insert into public.elias_conversations (id, user_id, title, kind) values (${id}, ${userId}, ${title.replace(/\s+/g, " ").trim().slice(0, 80) || "New conversation"}, ${kind})`;
  return id;
}

export async function addMessage(userId: string, conversationId: string, role: StoredMessage["role"], content: string, meta: Record<string, unknown> = {}) {
  const db = await ready();
  const rows = await db`insert into public.elias_messages (conversation_id, user_id, role, content, meta) values (${conversationId}, ${userId}, ${role}, ${content}, ${db.json(meta as never)}) returning id`;
  await db`update public.elias_conversations set updated_at = now() where id = ${conversationId}`;
  return Number(rows[0].id);
}

async function mergeMessageMeta(messageId: number, patch: Record<string, unknown>) {
  const db = await ready();
  await db`update public.elias_messages set meta = meta || ${db.json(patch as never)} where id = ${messageId}`;
}

export async function listConversations(userId: string) {
  const db = await ready();
  const rows = await db`select c.id, c.title, c.kind, c.source, c.updated_at,
    (select count(*) from public.elias_approvals a where a.conversation_id = c.id and a.status = 'pending')::int as pending,
    (select left(m.content, 140) from public.elias_messages m where m.conversation_id = c.id and m.role = 'assistant' order by m.id desc limit 1) as preview
    from public.elias_conversations c where c.user_id = ${userId} order by c.updated_at desc limit 60`;
  return rows.map((item) => ({ id: String(item.id), title: String(item.title), kind: String(item.kind), source: String(item.source || "server"), updatedAt: new Date(item.updated_at as string).toISOString(), pendingApprovals: Number(item.pending), preview: (item.preview as string) || "" }));
}

export async function renameConversation(userId: string, conversationId: string, title: string) {
  const db = await ready();
  await db`update public.elias_conversations set title = ${title.trim().slice(0, 80) || "Conversation"} where id = ${conversationId} and user_id = ${userId}`;
}

export async function getMessages(userId: string, conversationId: string, limit = 200): Promise<StoredMessage[]> {
  const db = await ready();
  const rows = await db`select * from (select * from public.elias_messages where conversation_id = ${conversationId} and user_id = ${userId} order by id desc limit ${limit}) m order by id asc`;
  return rows.map((item) => ({ id: Number(item.id), role: item.role as StoredMessage["role"], content: String(item.content), meta: (item.meta || {}) as Record<string, unknown>, createdAt: new Date(item.created_at as string).toISOString() }));
}

export async function deleteConversation(userId: string, conversationId: string) {
  const db = await ready();
  await db`delete from public.elias_conversations where id = ${conversationId} and user_id = ${userId}`;
}

function approvalRow(item: Record<string, unknown>): Approval {
  const tool = String(item.tool);
  const args = (item.args || {}) as Record<string, unknown>;
  return { id: String(item.id), tool, summary: String(item.summary), status: String(item.status), createdAt: new Date(item.created_at as string).toISOString(), conversationId: (item.conversation_id as string) || null, result: (item.result as string) || null, details: approvalDetails(tool, args, String(item.summary)), editable: EDITABLE_ARGS[tool] || [] };
}

export async function listApprovals(userId: string, conversationId?: string) {
  const db = await ready();
  const rows = conversationId
    ? await db`select * from public.elias_approvals where user_id = ${userId} and conversation_id = ${conversationId} order by created_at desc limit 50`
    : await db`select * from public.elias_approvals where user_id = ${userId} order by (status = 'pending') desc, created_at desc limit 50`;
  return rows.map(approvalRow);
}

function safeArgs(raw: string) {
  try { const parsed = JSON.parse(raw || "{}"); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function compact(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "null").slice(0, 14_000);
}

const GOOGLE_TOOLS = /^(gmail_|calendar_)/;
const BROWSER_TOOLS = /^browser_/;

/** One user turn: memory + history in, tool loop (streamed), reply out. */
export async function runTurn(options: RunOptions): Promise<TurnResult> {
  const emit = (event: TurnEvent) => { try { options.onEvent?.(event); } catch { /* a closed stream must not break the turn */ } };
  const timezone = options.timezone || "Africa/Lagos";
  const origin = options.origin || "chat";
  const conversationId = await ensureConversation(options.userId, options.conversationId, options.title || options.text, origin === "schedule" ? "schedule" : "chat");
  emit({ type: "conversation", conversationId });
  const [history, memories, google] = await Promise.all([
    getMessages(options.userId, conversationId, HISTORY_MESSAGES),
    memoryContext(options.userId, options.text).catch(() => "Memory unavailable this turn."),
    googleConnection(options.userId).catch(() => null),
  ]);
  if (origin !== "approval") await addMessage(options.userId, conversationId, origin === "schedule" ? "event" : "user", options.text, origin === "schedule" ? { kind: "schedule" } : {});

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt({ name: options.userName, timezone, memories, googleEmail: google?.email || null, googleConfigured: googleConfigured(), browser: browserConfigured(), origin, extra: options.extraContext }) },
    ...history.filter((item) => item.role !== "event" || item.meta.kind === "approval").map((item): LlmMessage => item.role === "assistant" ? { role: "assistant", content: item.content } : { role: "user", content: item.role === "event" ? `[system note] ${item.content}` : item.content }),
    { role: "user", content: origin === "schedule" ? `[Scheduled task] ${options.text}` : options.text },
  ];

  const browsers = new Map<string, BrowserHandle>();
  const ctx: ToolContext = { userId: options.userId, conversationId, timezone, githubToken: options.githubToken, browsers };
  const tools = toolSchemas();
  const approvals: Approval[] = [];
  const actions: TurnResult["actions"] = [];
  const cards: Card[] = [...(options.presetCards || [])];
  const connect: ConnectCard[] = [];
  const memoriesSaved: TurnResult["memories"] = [];
  const steps: string[] = [];
  let reply = "";
  let model: string | undefined;
  const db = await ready();
  const addCard = (card: Card | null) => {
    if (!card) return;
    const index = cards.findIndex((item) => item.kind === card.kind);
    if (index >= 0) cards[index] = card; else cards.push(card);
    emit({ type: "card", card });
  };
  const addConnect = (item: ConnectCard) => { if (!connect.some((existing) => existing.provider === item.provider)) { connect.push(item); emit({ type: "connect", connect: item }); } };

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      let streamed = false;
      const result = await completeStream(messages, tools, (text) => { streamed = true; emit({ type: "delta", text }); });
      model = `${result.provider}/${result.model}`;
      if (!result.toolCalls.length) { reply = result.content; break; }
      if (streamed) emit({ type: "reset" });
      messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        const name = call.function.name;
        const args = safeArgs(call.function.arguments);
        let output: string;
        const label = statusLabel(name);
        emit({ type: "status", id: call.id, tool: name, label });
        if (!steps.includes(label)) steps.push(label);
        if (!hasTool(name)) output = `Error: unknown tool ${name}.`;
        else if (GOOGLE_TOOLS.test(name) && !google) {
          addConnect({ provider: "google", configured: googleConfigured() });
          output = googleConfigured()
            ? "Google isn't connected. The user now sees a Connect Google button in the chat. Tell them in one line to tap it, then you can finish this."
            : "Google isn't available on this server yet (the owner hasn't added Google OAuth keys). Tell the user in one line.";
          actions.push({ tool: name, ok: false });
        } else if (BROWSER_TOOLS.test(name) && !browserConfigured()) {
          addConnect({ provider: "browser", configured: false });
          output = "The remote browser isn't configured on this server. Use web_search/web_open instead, or tell the user in one line that interactive browsing isn't set up.";
          actions.push({ tool: name, ok: false });
        } else {
          try {
            const summary = await approvalSummary(name, args, ctx);
            if (summary) {
              const id = newId("apr");
              if (BROWSER_TOOLS.test(name)) args._context = { url: browsers.get(conversationId)?.page.url() || "" };
              const rows = await db`insert into public.elias_approvals (id, user_id, conversation_id, tool, args, summary) values (${id}, ${options.userId}, ${conversationId}, ${name}, ${db.json(args as never)}, ${summary}) returning *`;
              const approval = approvalRow(rows[0]);
              approvals.push(approval);
              emit({ type: "approval", approval });
              output = `PAUSED FOR APPROVAL (id ${id}). The user now sees an approval card with: ${summary}. Do not retry this call. Tell the user in one short line what is waiting for their go-ahead.`;
            } else {
              const raw = await runTool(name, args, ctx);
              output = compact(raw);
              actions.push({ tool: name, ok: true });
              if (name === "daily_brief") for (const card of briefCards(raw as BriefData)) addCard(card);
              else addCard(cardFor(name, raw));
              if ((name === "memory_save" || name === "memory_update") && raw && typeof raw === "object" && "id" in raw) {
                const chip = { id: String((raw as { id: string }).id), content: String((raw as { content?: string }).content || "") };
                if (!memoriesSaved.some((item) => item.id === chip.id)) { memoriesSaved.push(chip); emit({ type: "memory", memory: chip }); }
              }
            }
          } catch (error) {
            output = `Error: ${error instanceof Error ? error.message : String(error)}`;
            actions.push({ tool: name, ok: false });
          }
        }
        emit({ type: "tool_done", id: call.id, tool: name, ok: !output.startsWith("Error") });
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
      if (step === MAX_STEPS - 1) {
        const final = await completeStream([...messages, { role: "user", content: "[system] Step limit reached. Reply to the user now with what you have, in a few lines." }], [], (text) => emit({ type: "delta", text }));
        reply = final.content;
      }
    }
  } finally {
    await closeAll(browsers);
  }

  reply = reply.trim() || (approvals.length ? "That's ready for your go-ahead." : connect.length ? "Connect it below and I'll take it from there." : "Done.");
  const meta = { model, actions, approvals: approvals.map((item) => item.id), cards, connect, memories: memoriesSaved, steps };
  const messageId = await addMessage(options.userId, conversationId, "assistant", reply, meta);
  if (origin === "chat") {
    const extracted = await extractMemories(options.userId, options.text, reply, memories).catch(() => []);
    for (const item of extracted) {
      if (memoriesSaved.some((chip) => chip.id === item.id)) continue;
      const chip = { id: item.id, content: item.content };
      memoriesSaved.push(chip);
      emit({ type: "memory", memory: chip });
    }
    if (extracted.length) await mergeMessageMeta(messageId, { memories: memoriesSaved });
  }
  const result: TurnResult = { conversationId, messageId, reply, approvals, actions, model, memoriesSaved: memoriesSaved.length, memories: memoriesSaved, cards, connect, steps };
  emit({ type: "done", result });
  return result;
}

/** Executes or declines an approval (optionally with user edits), records it, and lets Elias follow up. */
export async function decideApproval(input: { userId: string; userName?: string; approvalId: string; decision: "approve" | "decline"; timezone?: string; githubToken?: string; edits?: Record<string, unknown> }) {
  const db = await ready();
  const claimed = await db`update public.elias_approvals set status = ${input.decision === "approve" ? "running" : "declined"}, decided_at = now()
    where id = ${input.approvalId} and user_id = ${input.userId} and status = 'pending' returning *`;
  const approval = claimed[0];
  if (!approval) throw new Error("That approval is no longer pending.");
  const conversationId = String(approval.conversation_id);
  const tool = String(approval.tool);
  let args = approval.args as Record<string, unknown>;
  let summary = String(approval.summary);
  if (input.decision === "approve" && input.edits && Object.keys(input.edits).length) {
    const allowed = EDITABLE_ARGS[tool] || [];
    const changes = Object.fromEntries(Object.entries(input.edits).filter(([key]) => allowed.includes(key)).map(([key, value]) => [key, key === "attendees" && typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value]));
    if (Object.keys(changes).length) {
      args = { ...args, ...changes };
      summary = tool === "gmail_send" ? `Send email to ${args.to}${args.cc ? ` (cc ${args.cc})` : ""}\nSubject: ${args.subject}\n\n${args.body}` : `${summary}\n(edited by the user: ${Object.keys(changes).join(", ")})`;
      await db`update public.elias_approvals set args = ${db.json(args as never)}, summary = ${summary} where id = ${input.approvalId}`;
    }
  }
  let note: string;
  if (input.decision === "decline") {
    note = `User DECLINED: ${summary}`;
  } else {
    const browsers = new Map<string, BrowserHandle>();
    try {
      const { _context: _ignored, ...callArgs } = args;
      const output = await runTool(tool, callArgs, { userId: input.userId, conversationId, timezone: input.timezone || "Africa/Lagos", githubToken: input.githubToken, browsers, approved: true });
      const text = compact(output).slice(0, 4000);
      await db`update public.elias_approvals set status = 'done', result = ${text} where id = ${input.approvalId}`;
      note = `User APPROVED and it was executed: ${summary}\nResult: ${text}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db`update public.elias_approvals set status = 'failed', result = ${message} where id = ${input.approvalId}`;
      note = `User approved but execution FAILED: ${summary}\nError: ${message}`;
    } finally {
      await closeAll(browsers);
    }
  }
  await addMessage(input.userId, conversationId, "event", note, { kind: "approval", approvalId: input.approvalId });
  return runTurn({ userId: input.userId, userName: input.userName, conversationId, text: `[system note] ${note}\nConfirm the outcome to the user in one or two lines, or continue the task if more steps remain.`, timezone: input.timezone, githubToken: input.githubToken, origin: "approval" });
}

/* ---------- one-time import of conversations kept in the browser (IndexedDB) ---------- */

export type ImportConversation = { id: string; title?: string; createdAt?: number; updatedAt?: number; messages?: Array<{ role?: string; content?: string; createdAt?: number }> };

function importedId(userId: string, localId: string) {
  return `imp_${createHash("sha256").update(`${userId}:${localId}`).digest("base64url").slice(0, 22)}`;
}

function validDate(value: unknown, fallback: Date) {
  const date = typeof value === "number" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) && date.getTime() > 946684800000 && date.getTime() < Date.now() + 86400000 ? date : fallback;
}

/**
 * Idempotent: each local conversation maps to a stable server id; a conversation that was
 * already imported is skipped, so retries and multiple devices never duplicate anything.
 */
export async function importConversations(userId: string, items: ImportConversation[]) {
  const db = await ready();
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const item of items.slice(0, 50)) {
    if (!item || typeof item.id !== "string" || !item.id) continue;
    const id = importedId(userId, item.id);
    const messages = (Array.isArray(item.messages) ? item.messages : [])
      .filter((message) => message && typeof message.content === "string" && message.content.trim() && (message.role === "user" || message.role === "assistant"))
      .slice(-500);
    if (!messages.length) { skipped.push(item.id); continue; }
    const now = new Date();
    const updated = validDate(item.updatedAt, now);
    const created = validDate(item.createdAt, updated);
    const inserted = await db.begin(async (tx) => {
      const rows = await tx`insert into public.elias_conversations (id, user_id, title, kind, source, created_at, updated_at)
        values (${id}, ${userId}, ${(item.title || messages[0].content || "Imported chat").replace(/\s+/g, " ").trim().slice(0, 80)}, 'chat', 'import', ${created}, ${updated})
        on conflict (id) do nothing returning id`;
      if (!rows[0]) return false;
      for (const message of messages) {
        await tx`insert into public.elias_messages (conversation_id, user_id, role, content, meta, created_at)
          values (${id}, ${userId}, ${message.role as string}, ${String(message.content).slice(0, 20_000)}, ${tx.json({ imported: true } as never)}, ${validDate(message.createdAt, updated)})`;
      }
      return true;
    });
    (inserted ? imported : skipped).push(item.id);
  }
  await db`insert into public.elias_user_settings (user_id, legacy_import_at) values (${userId}, now()) on conflict (user_id) do update set legacy_import_at = now(), updated_at = now()`;
  return { imported, skipped, map: Object.fromEntries(items.filter((item) => item?.id).map((item) => [item.id, importedId(userId, item.id)])) };
}

/** Local memories from the old IndexedDB store; saveMemory de-duplicates, so this is idempotent too. */
export async function importMemories(userId: string, items: Array<{ content?: string; kind?: string }>) {
  let count = 0;
  for (const item of items.slice(0, 200)) {
    if (typeof item?.content !== "string" || !item.content.trim()) continue;
    await saveMemory(userId, item.content, item.kind, "import");
    count += 1;
  }
  return count;
}
