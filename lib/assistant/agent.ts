import { complete, type LlmMessage } from "@/lib/assistant/llm";
import { newId, ready } from "@/lib/assistant/db";
import { extractMemories, memoryContext } from "@/lib/assistant/memory";
import { approvalSummary, hasTool, runTool, toolSchemas, type ToolContext } from "@/lib/assistant/tools";
import { closeAll, type BrowserHandle } from "@/lib/assistant/browser";
import { googleConnection } from "@/lib/assistant/google";

const MAX_STEPS = 10;
const HISTORY_MESSAGES = 30;

export type Approval = { id: string; tool: string; summary: string; status: string; createdAt: string; conversationId: string | null; result?: string | null };
export type StoredMessage = { id: number; role: "user" | "assistant" | "event"; content: string; meta: Record<string, unknown>; createdAt: string };
export type TurnResult = { conversationId: string; reply: string; approvals: Approval[]; actions: Array<{ tool: string; ok: boolean }>; model?: string; memoriesSaved?: number };

type RunOptions = { userId: string; userName?: string; conversationId?: string; text: string; timezone?: string; githubToken?: string; origin?: "chat" | "schedule" | "approval" };

function systemPrompt(input: { name?: string; timezone: string; memories: string; googleEmail: string | null; origin: string }) {
  const now = new Date();
  return `You are Elias, a personal AI that runs errands across the user's life: memory of them, their Gmail and Calendar, the web, a real browser, GitHub, and scheduled tasks.

VOICE: Text like a sharp, warm friend. Answer first, short sentences, usually under 60 words. Take a side when recommending. No filler ("Great question", "I'd be happy to"). No markdown headings. Use a short list only when the user asked for several items.

NOW: ${now.toLocaleString("en-GB", { timeZone: input.timezone, dateStyle: "full", timeStyle: "short" })} (${input.timezone}). ISO ${now.toISOString()}.
USER: ${input.name || "unknown name"}. Google: ${input.googleEmail ? `connected as ${input.googleEmail}` : "not connected (Gmail/Calendar tools will fail; tell the user to connect Google in Connectors if they ask for email or calendar)"}.

WHAT YOU REMEMBER ABOUT THE USER (use it quietly, never recite it):
${input.memories}

RULES
- Use tools instead of guessing. Search the web for anything current (prices, news, hours, scores) and open a page before stating facts the user will act on.
- When the user tells you a durable fact about themselves, their people, places or preferences, call memory_save. If something changed, memory_update. If they ask you to forget, memory_forget.
- Prefer web_search/web_open for reading. Use browser_* only for interaction (forms, carts, bookings, logged-in pages).
- Sending email, inviting people, deleting events, paying, ordering or booking all go through an approval card: just call the tool; the system pauses it for the user. Then tell the user in one line what is waiting on their tap. Never claim something was sent or bought unless the tool result says so.
- Never ask for or type passwords, card numbers or one-time codes in chat.
- For "remind me", "every morning", "check daily" requests, use schedule_create with a self-contained prompt.
- If a tool fails, try another way once, then say plainly what blocked you and the next option.
${input.origin === "schedule" ? "- This turn was started by a scheduled task, not by the user typing. Do the job and reply with the result only. If nothing noteworthy, say so in one line." : ""}`;
}

export async function ensureConversation(userId: string, conversationId: string | undefined, title: string, kind = "chat") {
  const db = await ready();
  if (conversationId) {
    const found = await db`select id from public.elias_conversations where id = ${conversationId} and user_id = ${userId}`;
    if (found[0]) return conversationId;
  }
  const id = newId("conv");
  await db`insert into public.elias_conversations (id, user_id, title, kind) values (${id}, ${userId}, ${title.slice(0, 80) || "New conversation"}, ${kind})`;
  return id;
}

export async function addMessage(userId: string, conversationId: string, role: StoredMessage["role"], content: string, meta: Record<string, unknown> = {}) {
  const db = await ready();
  await db`insert into public.elias_messages (conversation_id, user_id, role, content, meta) values (${conversationId}, ${userId}, ${role}, ${content}, ${db.json(meta as never)})`;
  await db`update public.elias_conversations set updated_at = now() where id = ${conversationId}`;
}

export async function listConversations(userId: string) {
  const db = await ready();
  const rows = await db`select c.id, c.title, c.kind, c.updated_at,
    (select count(*) from public.elias_approvals a where a.conversation_id = c.id and a.status = 'pending')::int as pending
    from public.elias_conversations c where c.user_id = ${userId} order by c.updated_at desc limit 50`;
  return rows.map((item) => ({ id: String(item.id), title: String(item.title), kind: String(item.kind), updatedAt: new Date(item.updated_at as string).toISOString(), pendingApprovals: Number(item.pending) }));
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
  return { id: String(item.id), tool: String(item.tool), summary: String(item.summary), status: String(item.status), createdAt: new Date(item.created_at as string).toISOString(), conversationId: (item.conversation_id as string) || null, result: (item.result as string) || null };
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

/** One user turn: memory + history in, tool loop, reply out. */
export async function runTurn(options: RunOptions): Promise<TurnResult> {
  const timezone = options.timezone || "Africa/Lagos";
  const origin = options.origin || "chat";
  const conversationId = await ensureConversation(options.userId, options.conversationId, origin === "schedule" ? options.text.slice(0, 60) : options.text, origin === "schedule" ? "schedule" : "chat");
  const [history, memories, google] = await Promise.all([
    getMessages(options.userId, conversationId, HISTORY_MESSAGES),
    memoryContext(options.userId, options.text).catch(() => "Memory unavailable this turn."),
    googleConnection(options.userId).catch(() => null),
  ]);
  if (origin !== "approval") await addMessage(options.userId, conversationId, origin === "schedule" ? "event" : "user", options.text, origin === "schedule" ? { kind: "schedule" } : {});

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt({ name: options.userName, timezone, memories, googleEmail: google?.email || null, origin }) },
    ...history.filter((item) => item.role !== "event" || item.meta.kind === "approval").map((item): LlmMessage => item.role === "assistant" ? { role: "assistant", content: item.content } : { role: "user", content: item.role === "event" ? `[system note] ${item.content}` : item.content }),
    { role: "user", content: origin === "schedule" ? `[Scheduled task] ${options.text}` : options.text },
  ];

  const browsers = new Map<string, BrowserHandle>();
  const ctx: ToolContext = { userId: options.userId, conversationId, timezone, githubToken: options.githubToken, browsers };
  const tools = toolSchemas();
  const approvals: Approval[] = [];
  const actions: TurnResult["actions"] = [];
  let reply = "";
  let model: string | undefined;
  const db = await ready();

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const result = await complete(messages, tools);
      model = `${result.provider}/${result.model}`;
      if (!result.toolCalls.length) { reply = result.content; break; }
      messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        const name = call.function.name;
        const args = safeArgs(call.function.arguments);
        let output: string;
        if (!hasTool(name)) output = `Error: unknown tool ${name}.`;
        else {
          try {
            const summary = await approvalSummary(name, args, ctx);
            if (summary) {
              const id = newId("apr");
              const rows = await db`insert into public.elias_approvals (id, user_id, conversation_id, tool, args, summary) values (${id}, ${options.userId}, ${conversationId}, ${name}, ${db.json(args as never)}, ${summary}) returning *`;
              approvals.push(approvalRow(rows[0]));
              output = `PAUSED FOR APPROVAL (id ${id}). The user now sees an approval card with: ${summary}. Do not retry this call. Tell the user in one short line what is waiting for their go-ahead.`;
            } else {
              output = compact(await runTool(name, args, ctx));
              actions.push({ tool: name, ok: true });
            }
          } catch (error) {
            output = `Error: ${error instanceof Error ? error.message : String(error)}`;
            actions.push({ tool: name, ok: false });
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
      if (step === MAX_STEPS - 1) {
        const final = await complete([...messages, { role: "user", content: "[system] Step limit reached. Reply to the user now with what you have, in a few lines." }], []);
        reply = final.content;
      }
    }
  } finally {
    await closeAll(browsers);
  }

  reply = reply.trim() || (approvals.length ? "That's ready for your go-ahead." : "Done.");
  await addMessage(options.userId, conversationId, "assistant", reply, { model, actions, approvals: approvals.map((item) => item.id) });
  const saved = origin === "chat" ? await extractMemories(options.userId, options.text, reply, memories).catch(() => []) : [];
  return { conversationId, reply, approvals, actions, model, memoriesSaved: saved.length };
}

/** Executes or declines an approval, records it, and lets Elias follow up in the same conversation. */
export async function decideApproval(input: { userId: string; userName?: string; approvalId: string; decision: "approve" | "decline"; timezone?: string; githubToken?: string }) {
  const db = await ready();
  const claimed = await db`update public.elias_approvals set status = ${input.decision === "approve" ? "running" : "declined"}, decided_at = now()
    where id = ${input.approvalId} and user_id = ${input.userId} and status = 'pending' returning *`;
  const approval = claimed[0];
  if (!approval) throw new Error("That approval is no longer pending.");
  const conversationId = String(approval.conversation_id);
  let note: string;
  if (input.decision === "decline") {
    note = `User DECLINED: ${approval.summary}`;
  } else {
    const browsers = new Map<string, BrowserHandle>();
    try {
      const output = await runTool(String(approval.tool), approval.args as Record<string, unknown>, { userId: input.userId, conversationId, timezone: input.timezone || "Africa/Lagos", githubToken: input.githubToken, browsers, approved: true });
      const text = compact(output).slice(0, 4000);
      await db`update public.elias_approvals set status = 'done', result = ${text} where id = ${input.approvalId}`;
      note = `User APPROVED and it was executed: ${approval.summary}\nResult: ${text}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db`update public.elias_approvals set status = 'failed', result = ${message} where id = ${input.approvalId}`;
      note = `User approved but execution FAILED: ${approval.summary}\nError: ${message}`;
    } finally {
      await closeAll(browsers);
    }
  }
  await addMessage(input.userId, conversationId, "event", note, { kind: "approval", approvalId: input.approvalId });
  return runTurn({ userId: input.userId, userName: input.userName, conversationId, text: `[system note] ${note}\nConfirm the outcome to the user in one or two lines, or continue the task if more steps remain.`, timezone: input.timezone, githubToken: input.githubToken, origin: "approval" });
}
