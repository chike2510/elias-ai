import { createHash } from "node:crypto";
import { completeStream, type ContentPart, type LlmMessage } from "@/lib/assistant/llm";
import { fileContext, parseChoice, resolveRoute, toStored, type ChatAttachment, type ModelTier, type StoredAttachment } from "@/lib/assistant/modelRouter";
import { newId, ready } from "@/lib/assistant/db";
import { extractMemories, memoryContext, saveMemory } from "@/lib/assistant/memory";
import { approvalSummary, hasTool, runTool, toolSchemasFor, type ToolContext } from "@/lib/assistant/tools";
import { browserConfigured, closeAll, type BrowserHandle } from "@/lib/assistant/browser";
import { DRIVE_SCOPE, dbTokenStore, googleConfigured, googleConnection, isReconnectError, reconnectText, type GoogleConnection } from "@/lib/assistant/google";
import { googleApprovalDetails, googleCardFor, EDITABLE_ARGS, statusLabel, type ApprovalDetails, type Card, type ConnectCard, type MemoryChip } from "@/lib/assistant/cards";
import { briefCards, briefConnect, type BriefData } from "@/lib/assistant/brief";
import { recordAudit } from "@/lib/assistant/audit";
import { getCodeSet, isCodeTool } from "@/lib/assistant/code/github";
import { CODE_PROMPT, codeSetSummary } from "@/lib/assistant/code/prompt";
import { codeCardFor } from "@/lib/assistant/code/cards";
import { suggestFollowUps } from "@/lib/assistant/followups";
import { extractChoices } from "@/lib/richReply";
import { cleanReplyQuote, withReplyContext } from "@/lib/messageMenu";

const MAX_STEPS = 10;
/** Code turns read, edit, commit and verify, so they get a bigger tool budget. */
const CODE_MAX_STEPS = 16;
const HISTORY_MESSAGES = 30;

export type Approval = { id: string; tool: string; summary: string; status: string; createdAt: string; conversationId: string | null; result?: string | null; details: ApprovalDetails; editable: string[] };
export type StoredMessage = { id: number; role: "user" | "assistant" | "event"; content: string; meta: Record<string, unknown>; createdAt: string };
export type TurnResult = { conversationId: string; messageId?: number; reply: string; approvals: Approval[]; actions: Array<{ tool: string; ok: boolean }>; model?: string; tier?: ModelTier; memoriesSaved?: number; memories: MemoryChip[]; cards: Card[]; connect: ConnectCard[]; steps: string[]; choices?: string[]; followUps?: string[] };

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
  origin?: "chat" | "schedule" | "approval" | "job";
  /** Tool-loop bound for this turn (background job slices use fewer). */
  maxSteps?: number;
  /** Where the message came from when not the web app (e.g. "telegram"), for the audit log. */
  channel?: string;
  onEvent?: (event: TurnEvent) => void;
  /** Turn-only context appended to the system prompt (not stored in the conversation). */
  extraContext?: string;
  /** Cards to attach to the reply regardless of tool use (e.g. the daily brief). */
  presetCards?: Card[];
  /** Connect/Reconnect cards to attach regardless of tool use (e.g. a brief whose Google access expired). */
  presetConnect?: ConnectCard[];
  title?: string;
  /** Images (sent to a vision model) and extracted documents (injected as context) for this message. */
  attachments?: ChatAttachment[];
  /** "auto" (default), "fast", "strong" or "<provider>/<model>". */
  modelChoice?: string;
  /** "code" offers the repo_/code_ tools (coding workspace and code jobs). Default: from the conversation's kind. */
  mode?: "chat" | "code";
  /** Code jobs: the chat whose working set the repo tools use. */
  codeConversationId?: string;
  /** Text of an earlier message the user is replying to (long-press > Reply). Saved on meta.replyTo and given to the model as context. */
  replyTo?: string;
};

/** Code mode for a conversation: kind 'code', or the work conversation of a code job (which uses its parent chat's working set). */
export async function conversationMode(userId: string, conversationId: string): Promise<{ mode: "chat" | "code"; codeKey: string }> {
  const db = await ready();
  const conv = (await db`select kind from public.elias_conversations where id = ${conversationId} and user_id = ${userId}`)[0];
  if (conv?.kind === "code") return { mode: "code", codeKey: conversationId };
  if (conv?.kind === "job") {
    const job = (await db`select conversation_id from public.elias_jobs where work_conversation_id = ${conversationId} and kind = 'code' limit 1`.catch(() => []))[0];
    if (job) return { mode: "code", codeKey: String(job.conversation_id) };
  }
  return { mode: "chat", codeKey: conversationId };
}

/** History entry for a stored user message: its text plus what was attached (recent document text is kept). */
function historyUserContent(item: StoredMessage, recent: boolean) {
  const attachments = Array.isArray(item.meta.attachments) ? item.meta.attachments as StoredAttachment[] : [];
  const content = withReplyContext(item.content, typeof item.meta.replyTo === "string" ? item.meta.replyTo : undefined, recent ? 1200 : 300);
  if (!attachments.length) return content;
  const images = attachments.filter((entry) => entry.kind === "image").map((entry) => `[Image attached earlier: ${entry.name}]`);
  const files = attachments.filter((entry) => entry.kind === "file");
  const docs = recent ? fileContext(files, 8_000, 16_000) : files.map((entry) => `[File attached earlier: ${entry.name}]`).join("\n");
  return [content, ...images, docs].filter(Boolean).join("\n\n");
}

function systemPrompt(input: { name?: string; timezone: string; memories: string; googleEmail: string | null; googleStatus?: GoogleConnection | null; googleConfigured: boolean; browser: boolean; origin: string; extra?: string }) {
  const now = new Date();
  return `You are Elias, a personal AI that runs errands across the user's life: memory of them, their Gmail and Calendar, the web, a real browser, GitHub, weather and scheduled tasks.

VOICE: You are texting. Reply like a sharp, warm friend would by text message.
- 1 to 3 short sentences, usually under 50 words. Answer first. Take a side when recommending.
- No headings, no bold labels, no bullet walls. A short list (max 5 items, one line each) only when the user asked for several things.
- The chat shows cards for search results, emails, calendar events, weather and approvals. Do not repeat what a card shows: give the one-line takeaway ("3 unread, the one from your bank needs a reply today").
- Links: at most one inline link, only when it's the thing they need.
- Use tables only when the user asks to compare things. Keep them phone-sized: at most 4 short columns, the name in the first column.
- Asking the user to pick (a time, an option, yes or no before acting)? End the reply with one line: [[choices: Option A | Option B | Option C]] (2 to 4 options, each under 30 characters, written as the user's reply). The chat turns it into tap-to-reply buttons and hides the line.
- Only when the user asks for depth (a guide, report, plan or breakdown): open with the answer in 1 to 2 sentences, then one "## " heading per section. The chat folds long answers into sections.
- No filler ("Great question", "I'd be happy to", "Let me know if").

NOW: ${now.toLocaleString("en-GB", { timeZone: input.timezone, dateStyle: "full", timeStyle: "short" })} (${input.timezone}). ISO ${now.toISOString()}.
USER: ${input.name || "unknown name"}.
GOOGLE: ${input.googleEmail ? `connected as ${input.googleEmail} (Gmail, Calendar${input.googleStatus?.scopes.drive ? ", Drive read-only" : "; Drive not allowed yet, drive_ tools show a Reconnect button"}). For "check my email" use gmail_triage; for the day use calendar_agenda; creating or moving events and sending email always pause for approval.` : input.googleStatus && input.googleStatus.status !== "ok" ? `connected as ${input.googleStatus.email || "the user"} but access ${input.googleStatus.status} (Google testing mode signs out every 7 days). Still call the tool: the chat shows a Reconnect Google button.` : input.googleConfigured ? "not connected. If a request needs Gmail or Calendar, still call the tool: the chat shows the user a Connect Google button." : "not available on this server yet (the owner hasn't added Google OAuth keys). Say so in one line if they ask for email or calendar."}
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
- Dev and money tools: github_* (issues, PRs, CI), vercel_* (projects, deployments, redeploy), supabase_health, and read-only paystack_*/flutterwave_*/payments_summary. You can read balances and transactions but never move money; refuse transfers or payments plainly.
- If a tool fails, try another way once, then say plainly what blocked you and the next option.
${input.origin === "schedule" ? "- This turn was started by a scheduled task, not by the user typing. Do the job and reply with the result only. If nothing noteworthy, say so in one line." : ""}${input.origin === "job" ? "- This turn is one slice of a background job the user handed off. Nobody is watching live: work through the steps, then follow the job instructions for how to end your reply." : "- For long work (deep research across many sources, or a multi-step task that will take a while), offer or use start_background_job so the user can get on with their day; the result is posted back here with a notification."}${input.extra ? `\n\n${input.extra}` : ""}`;
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
    from public.elias_conversations c where c.user_id = ${userId} and c.kind <> 'job' order by c.updated_at desc limit 60`;
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
  return { id: String(item.id), tool, summary: String(item.summary), status: String(item.status), createdAt: new Date(item.created_at as string).toISOString(), conversationId: (item.conversation_id as string) || null, result: (item.result as string) || null, details: googleApprovalDetails(tool, args, String(item.summary)), editable: EDITABLE_ARGS[tool] || [] };
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

const GOOGLE_TOOLS = /^(gmail_|calendar_|drive_)/;
const BROWSER_TOOLS = /^browser_/;

/** One user turn: memory + history in, tool loop (streamed), reply out. */
export async function runTurn(options: RunOptions): Promise<TurnResult> {
  const emit = (event: TurnEvent) => { try { options.onEvent?.(event); } catch { /* a closed stream must not break the turn */ } };
  const timezone = options.timezone || "Africa/Lagos";
  const origin = options.origin || "chat";
  const conversationId = await ensureConversation(options.userId, options.conversationId, options.title || options.text, origin === "schedule" ? "schedule" : origin === "job" ? "job" : options.mode === "code" ? "code" : "chat");
  const code = options.mode ? { mode: options.mode, codeKey: options.codeConversationId || conversationId } : await conversationMode(options.userId, conversationId).catch(() => ({ mode: "chat" as const, codeKey: conversationId }));
  const codeExtra = code.mode === "code" ? `${CODE_PROMPT}\n\n${codeSetSummary(await getCodeSet(options.userId, code.codeKey).catch(() => null))}` : "";
  emit({ type: "conversation", conversationId });
  const [history, memories, google] = await Promise.all([
    getMessages(options.userId, conversationId, HISTORY_MESSAGES),
    memoryContext(options.userId, options.text).catch(() => "Memory unavailable this turn."),
    googleConnection(options.userId).catch(() => null),
  ]);
  // A row whose refresh token died (7-day testing expiry, revoked) is not "connected": tools get the reconnect card instead.
  const googleOk = Boolean(google && google.status === "ok");
  const attachments = origin === "chat" ? options.attachments || [] : [];
  const images = attachments.filter((item) => item.kind === "image");
  const files = attachments.filter((item) => item.kind === "file");
  const background = origin === "schedule" || origin === "job";
  const replyTo = origin === "chat" ? cleanReplyQuote(options.replyTo) : undefined;
  if (origin !== "approval") await addMessage(options.userId, conversationId, background ? "event" : "user", options.text, background ? { kind: origin } : { ...(attachments.length ? { attachments: toStored(attachments) } : {}), ...(replyTo ? { replyTo } : {}) });
  const userText = [origin === "schedule" ? `[Scheduled task] ${options.text}` : origin === "job" ? `[Background job] ${options.text}` : withReplyContext(options.text, replyTo), fileContext(files)].filter(Boolean).join("\n\n");
  const userContent: string | ContentPart[] = images.length
    ? [{ type: "text", text: userText || "What's in this image?" }, ...images.map((image): ContentPart => ({ type: "image_url", image_url: { url: image.dataUrl } }))]
    : userText;
  const lastUserIndexes = new Set(history.map((item, index) => item.role === "user" ? index : -1).filter((index) => index >= 0).slice(-3));

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt({ name: options.userName, timezone, memories, googleEmail: googleOk ? google?.email || null : null, googleStatus: google, googleConfigured: googleConfigured(), browser: browserConfigured(), origin, extra: [codeExtra, options.extraContext].filter(Boolean).join("\n\n") || undefined }) },
    ...history.map((item, index) => ({ item, index })).filter(({ item }) => item.role !== "event" || item.meta.kind === "approval").map(({ item, index }): LlmMessage => item.role === "assistant" ? { role: "assistant", content: item.content } : { role: "user", content: item.role === "event" ? `[system note] ${item.content}` : historyUserContent(item, lastUserIndexes.has(index)) }),
    { role: "user", content: userContent },
  ];

  const browsers = new Map<string, BrowserHandle>();
  const ctx: ToolContext = { userId: options.userId, conversationId, timezone, githubToken: options.githubToken, browsers, origin: options.channel || origin, codeConversationId: code.codeKey };
  const tools = toolSchemasFor(code.mode);
  const approvals: Approval[] = [];
  const actions: TurnResult["actions"] = [];
  const cards: Card[] = [...(options.presetCards || [])];
  const connect: ConnectCard[] = [...(options.presetConnect || [])];
  const memoriesSaved: TurnResult["memories"] = [];
  const steps: string[] = [];
  let reply = "";
  let model: string | undefined;
  let tier: ModelTier | undefined;
  // Code mode runs on the strong tier unless the user picked a specific model.
  const choice = parseChoice(code.mode === "code" && (!options.modelChoice || options.modelChoice === "auto" || options.modelChoice === "fast") ? "strong" : options.modelChoice);
  const db = await ready();
  const addCard = (card: Card | null) => {
    if (!card) return;
    const index = cards.findIndex((item) => item.kind === card.kind && (card.kind !== "list" || (item as { title?: string }).title === card.title));
    if (index >= 0) cards[index] = card; else cards.push(card);
    emit({ type: "card", card });
  };
  const addConnect = (item: ConnectCard) => { if (!connect.some((existing) => existing.provider === item.provider)) { connect.push(item); emit({ type: "connect", connect: item }); } };

  try {
    const maxSteps = Math.max(1, options.maxSteps ?? (code.mode === "code" ? CODE_MAX_STEPS : MAX_STEPS));
    for (let step = 0; step < maxSteps; step += 1) {
      let streamed = false;
      const route = resolveRoute(choice, { text: options.text, images: images.length, files: files.length, step, usedTool: actions.length > 0 });
      tier = route.tier;
      const result = await completeStream(messages, tools, (text) => { streamed = true; emit({ type: "delta", text }); }, { route });
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
        else if (code.mode !== "code" && isCodeTool(name)) {
          output = "Error: repo and code tools only run in the coding workspace (/agent). Tell the user in one line to open the Code workspace for repo changes.";
          actions.push({ tool: name, ok: false });
        }
        else if (GOOGLE_TOOLS.test(name) && google && !googleOk && googleConfigured()) {
          addConnect({ provider: "google", configured: true, reconnect: true, reason: google.status === "revoked" ? "revoked" : "expired", email: google.email });
          output = reconnectText(google.status === "revoked" ? "revoked" : "expired");
          actions.push({ tool: name, ok: false });
        } else if (GOOGLE_TOOLS.test(name) && !googleOk) {
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
              await recordAudit({ userId: options.userId, tool: name, args, status: "pending_approval", approvalId: id, conversationId, origin: options.channel || origin });
              emit({ type: "approval", approval });
              output = `PAUSED FOR APPROVAL (id ${id}). The user now sees an approval card with: ${summary}. Do not retry this call. Tell the user in one short line what is waiting for their go-ahead.`;
            } else {
              const raw = await runTool(name, args, ctx);
              output = compact(raw);
              actions.push({ tool: name, ok: true });
              if (name === "daily_brief") { for (const card of briefCards(raw as BriefData)) addCard(card); const again = briefConnect(raw as BriefData); if (again) addConnect(again); }
              else addCard(codeCardFor(name, raw) ?? googleCardFor(name, raw));
              if ((name === "memory_save" || name === "memory_update") && raw && typeof raw === "object" && "id" in raw && (raw as { created?: boolean }).created !== false) {
                const chip = { id: String((raw as { id: string }).id), content: String((raw as { content?: string }).content || "") };
                if (!memoriesSaved.some((item) => item.id === chip.id)) { memoriesSaved.push(chip); emit({ type: "memory", memory: chip }); }
              }
            }
          } catch (error) {
            if (isReconnectError(error)) {
              // Expired/revoked mid-turn, or a missing permission (e.g. Drive): show Reconnect Google instead of an error.
              addConnect({ provider: "google", configured: googleConfigured(), reconnect: error.reason !== "not_connected", reason: error.reason, scope: error.scope, email: google?.email || null });
              // Drive is opt-in: remember it so the next Connect/Reconnect asks Google for drive.readonly too.
              if (error.scope === "drive") await dbTokenStore.wantScope?.(options.userId, DRIVE_SCOPE).catch(() => undefined);
              output = reconnectText(error.reason);
            } else output = `Error: ${error instanceof Error ? error.message : String(error)}`;
            actions.push({ tool: name, ok: false });
          }
        }
        emit({ type: "tool_done", id: call.id, tool: name, ok: !output.startsWith("Error") });
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
      if (step === maxSteps - 1) {
        const final = await completeStream([...messages, { role: "user", content: "[system] Step limit reached. Reply to the user now with what you have, in a few lines." }], [], (text) => emit({ type: "delta", text }), { route: resolveRoute(choice, { text: options.text, images: images.length, step, usedTool: true }) });
        reply = final.content;
        model = `${final.provider}/${final.model}`;
      }
    }
  } finally {
    await closeAll(browsers);
  }

  const extractedChoices = extractChoices(reply.trim());
  const choices = extractedChoices.choices;
  reply = extractedChoices.text.trim() || (approvals.length ? "That's ready for your go-ahead." : connect.length ? "Connect it below and I'll take it from there." : choices.length ? "Pick one:" : "Done.");
  const meta: Record<string, unknown> = { model, tier, actions, approvals: approvals.map((item) => item.id), cards, connect, memories: memoriesSaved, steps, ...(choices.length ? { choices } : {}) };
  const messageId = await addMessage(options.userId, conversationId, "assistant", reply, meta);
  let followUps: string[] = [];
  if (origin === "chat") {
    // Follow-up chips are skipped when the reply already offers quick replies, waits on an approval or a connect, or is a code turn.
    const wantFollowUps = !choices.length && !approvals.length && !connect.length && code.mode !== "code" && !options.channel;
    const [extracted, suggested] = await Promise.all([
      extractMemories(options.userId, options.text, reply, memories).catch(() => []),
      wantFollowUps ? suggestFollowUps(options.text, reply).catch(() => []) : Promise.resolve([] as string[]),
    ]);
    followUps = suggested;
    if (followUps.length) await mergeMessageMeta(messageId, { followUps });
    for (const item of extracted) {
      if (memoriesSaved.some((chip) => chip.id === item.id)) continue;
      const chip = { id: item.id, content: item.content };
      memoriesSaved.push(chip);
      emit({ type: "memory", memory: chip });
    }
    if (extracted.length) await mergeMessageMeta(messageId, { memories: memoriesSaved });
  }
  const result: TurnResult = { conversationId, messageId, reply, approvals, actions, model, tier, memoriesSaved: memoriesSaved.length, memories: memoriesSaved, cards, connect, steps, choices, followUps };
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
  let reconnect: ConnectCard | null = null;
  if (input.decision === "decline") {
    note = `User DECLINED: ${summary}`;
    await recordAudit({ userId: input.userId, tool, args, status: "declined", approvalId: input.approvalId, conversationId, origin: "approval" });
  } else {
    const browsers = new Map<string, BrowserHandle>();
    try {
      const { _context: _ignored, ...callArgs } = args;
      const { codeKey } = await conversationMode(input.userId, conversationId).catch(() => ({ codeKey: conversationId }));
      const output = await runTool(tool, callArgs, { userId: input.userId, conversationId, timezone: input.timezone || "Africa/Lagos", githubToken: input.githubToken, browsers, approved: true, approvalId: input.approvalId, origin: "approval", codeConversationId: codeKey });
      const text = compact(output).slice(0, 4000);
      await db`update public.elias_approvals set status = 'done', result = ${text} where id = ${input.approvalId}`;
      note = `User APPROVED and it was executed: ${summary}\nResult: ${text}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db`update public.elias_approvals set status = 'failed', result = ${message} where id = ${input.approvalId}`;
      note = `User approved but execution FAILED: ${summary}\nError: ${message}`;
      if (isReconnectError(error)) { reconnect = { provider: "google", configured: googleConfigured(), reconnect: error.reason !== "not_connected", reason: error.reason, scope: error.scope }; note += "\nThe user sees a Reconnect Google button; after reconnecting they can approve it again."; }
    } finally {
      await closeAll(browsers);
    }
  }
  await addMessage(input.userId, conversationId, "event", note, { kind: "approval", approvalId: input.approvalId });
  return runTurn({ userId: input.userId, userName: input.userName, conversationId, text: `[system note] ${note}\nConfirm the outcome to the user in one or two lines, or continue the task if more steps remain.`, timezone: input.timezone, githubToken: input.githubToken, origin: "approval", presetConnect: reconnect ? [reconnect] : undefined });
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
