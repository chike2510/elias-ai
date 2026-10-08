import type { ToolSchema } from "@/lib/assistant/llm";
import { deleteMemory, saveMemory, searchMemories, updateMemory } from "@/lib/assistant/memory";
import { calendarCreate, calendarDelete, calendarList, gmailDraft, gmailRead, gmailSearch, gmailSend } from "@/lib/assistant/google";
import { createSchedule, describeSpec, listSchedules, setScheduleStatus } from "@/lib/assistant/schedules";
import { elementLabel, endBrowser, looksConsequential, openBrowser, snapshot, type BrowserHandle } from "@/lib/assistant/browser";
import { fetchUrl, searchWeb } from "@/lib/webSearch";
import { cityFromTimezone, gatherBrief, getSettings, weatherFor } from "@/lib/assistant/brief";
import { CONNECTOR_TOOLS, connectorGate } from "@/lib/assistant/connectors";
import { isSideEffect, recordAudit, unsafeCall } from "@/lib/assistant/audit";
import { CODE_TOOLS, isCodeTool } from "@/lib/assistant/code/github";

export type ToolContext = {
  userId: string;
  conversationId: string;
  timezone: string;
  githubToken?: string;
  browsers: Map<string, BrowserHandle>;
  /** true when the user already approved this exact call. */
  approved?: boolean;
  /** The approval this call executes, for the audit log. */
  approvalId?: string;
  /** chat | schedule | approval | telegram, for the audit log. */
  origin?: string;
};

type Args = Record<string, unknown>;
type Tool = {
  schema: ToolSchema["function"];
  /** Returns a human summary when this call needs the user's go-ahead first, else null. */
  needsApproval?: (args: Args, ctx: ToolContext) => Promise<string | null> | string | null;
  run: (args: Args, ctx: ToolContext) => Promise<unknown>;
};

const str = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });

const TOOLS: Record<string, Tool> = {
  get_time: {
    schema: { name: "get_time", description: "Current date and time in a timezone (defaults to the user's).", parameters: obj({ timezone: s("IANA timezone, e.g. Africa/Lagos") }) },
    run: async (args, ctx) => { const tz = str(args.timezone, ctx.timezone); return { timezone: tz, now: new Date().toLocaleString("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "long" }), iso: new Date().toISOString() }; },
  },
  web_search: {
    schema: { name: "web_search", description: "Search the web for current information. Returns titles, URLs and snippets.", parameters: obj({ query: s("Search query") }, ["query"]) },
    run: async (args) => (await searchWeb(str(args.query))).slice(0, 8),
  },
  web_open: {
    schema: { name: "web_open", description: "Fetch a public web page as text. Use to read a search result before relying on it.", parameters: obj({ url: s("https URL") }, ["url"]) },
    run: async (args) => ({ url: args.url, text: (await fetchUrl(str(args.url))).slice(0, 12_000) }),
  },
  weather: {
    schema: { name: "weather", description: "Current weather and today's high/low/rain chance for a place (free open-meteo). Defaults to the user's saved city or their timezone's city.", parameters: obj({ place: s("City or town, e.g. 'Owerri' or 'Lagos, Nigeria'") }) },
    run: async (args, ctx) => weatherFor(str(args.place) || (await getSettings(ctx.userId).catch(() => null))?.city || cityFromTimezone(ctx.timezone)),
  },
  daily_brief: {
    schema: { name: "daily_brief", description: "Gather the user's day in one call: today's calendar and important unread email (when Google is connected), reminders due today, approvals waiting, and the weather. Use for 'plan my day', 'brief me', 'what's my day like'.", parameters: obj({ place: s("Optional weather place") }) },
    run: async (args, ctx) => gatherBrief(ctx.userId, ctx.timezone, str(args.place) || null),
  },

  memory_save: {
    schema: { name: "memory_save", description: "Remember a durable fact about the user (who they are, people, places, preferences, projects). One short third-person sentence with its conditions.", parameters: obj({ content: s("The fact"), kind: { type: "string", enum: ["person", "place", "project", "preference", "profile", "fact"] }, entity: s("Who or what it's about, e.g. 'Bola' or 'Port Harcourt' (optional)") }, ["content"]) },
    run: async (args, ctx) => saveMemory(ctx.userId, str(args.content), str(args.kind), "chat", str(args.entity) || null),
  },
  memory_search: {
    schema: { name: "memory_search", description: "Search long-term memory about the user.", parameters: obj({ query: s("What to look for") }, ["query"]) },
    run: async (args, ctx) => searchMemories(ctx.userId, str(args.query), 10),
  },
  memory_update: {
    schema: { name: "memory_update", description: "Rewrite a saved memory that changed (use its id from the memory block).", parameters: obj({ id: s("Memory id"), content: s("New content"), kind: { type: "string", enum: ["person", "place", "project", "preference", "profile", "fact"] }, entity: s("Who or what it's about (optional)") }, ["id", "content"]) },
    run: async (args, ctx) => updateMemory(ctx.userId, str(args.id), str(args.content), { kind: str(args.kind) || undefined, entity: typeof args.entity === "string" ? args.entity : undefined }),
  },
  memory_forget: {
    schema: { name: "memory_forget", description: "Delete a saved memory when the user asks you to forget it.", parameters: obj({ id: s("Memory id") }, ["id"]) },
    run: async (args, ctx) => ({ deleted: await deleteMemory(ctx.userId, str(args.id)) }),
  },

  gmail_search: {
    schema: { name: "gmail_search", description: "Search the user's Gmail with Gmail query syntax (e.g. 'is:unread newer_than:2d', 'from:bank').", parameters: obj({ query: s("Gmail query"), max: { type: "number" } }, ["query"]) },
    run: async (args, ctx) => gmailSearch(ctx.userId, str(args.query), Number(args.max) || 10),
  },
  gmail_read: {
    schema: { name: "gmail_read", description: "Read one email in full by id.", parameters: obj({ id: s("Message id") }, ["id"]) },
    run: async (args, ctx) => gmailRead(ctx.userId, str(args.id)),
  },
  gmail_draft: {
    schema: { name: "gmail_draft", description: "Save an email draft in Gmail (does not send).", parameters: obj({ to: s("Recipients, comma separated"), subject: s("Subject"), body: s("Plain-text body"), cc: s("Cc"), threadId: s("Thread to reply in"), inReplyTo: s("Message-ID header being replied to") }, ["to", "subject", "body"]) },
    run: async (args, ctx) => gmailDraft(ctx.userId, args as never),
  },
  gmail_send: {
    schema: { name: "gmail_send", description: "Send an email from the user's Gmail. Always needs the user's approval; the user sees the full draft on an approval card.", parameters: obj({ to: s("Recipients, comma separated"), subject: s("Subject"), body: s("Plain-text body"), cc: s("Cc"), threadId: s("Thread to reply in"), inReplyTo: s("Message-ID header being replied to") }, ["to", "subject", "body"]) },
    needsApproval: (args) => `Send email to ${str(args.to)}${args.cc ? ` (cc ${str(args.cc)})` : ""}\nSubject: ${str(args.subject)}\n\n${str(args.body)}`,
    run: async (args, ctx) => gmailSend(ctx.userId, args as never),
  },
  calendar_list: {
    schema: { name: "calendar_list", description: "List events on the user's primary Google Calendar between two ISO times.", parameters: obj({ time_min: s("ISO start"), time_max: s("ISO end") }, ["time_min", "time_max"]) },
    run: async (args, ctx) => calendarList(ctx.userId, str(args.time_min), str(args.time_max)),
  },
  calendar_create: {
    schema: { name: "calendar_create", description: "Create an event on the user's calendar. Inviting attendees needs approval.", parameters: obj({ summary: s("Title"), start: s("ISO start with offset"), end: s("ISO end with offset"), timezone: s("IANA timezone"), location: s("Location"), description: s("Notes"), attendees: { type: "array", items: { type: "string" } } }, ["summary", "start", "end"]) },
    needsApproval: (args) => Array.isArray(args.attendees) && args.attendees.length ? `Create "${str(args.summary)}" ${str(args.start)} to ${str(args.end)} and invite ${(args.attendees as string[]).join(", ")}` : null,
    run: async (args, ctx) => calendarCreate(ctx.userId, { ...(args as Record<string, never>), summary: str(args.summary), start: str(args.start), end: str(args.end), timezone: str(args.timezone, ctx.timezone) }),
  },
  calendar_delete: {
    schema: { name: "calendar_delete", description: "Delete an event from the user's calendar. Needs approval.", parameters: obj({ event_id: s("Event id"), title: s("Event title for the approval card") }, ["event_id"]) },
    needsApproval: (args) => `Delete calendar event "${str(args.title, str(args.event_id))}"`,
    run: async (args, ctx) => calendarDelete(ctx.userId, str(args.event_id)),
  },

  schedule_create: {
    schema: {
      name: "schedule_create",
      description: "Schedule Elias to do something later or repeatedly (reminders, daily briefings, recurring checks). The prompt runs as a fresh instruction to you at each run, and the reply is posted to the user's chat.",
      parameters: obj({
        name: s("Short name"),
        prompt: s("Self-contained instruction to run each time, e.g. 'Summarise my unread email from the last 24h'"),
        schedule: obj({ type: { type: "string", enum: ["once", "interval", "daily", "weekly"] }, at: s("ISO time with offset, for once"), minutes: { type: "number", description: "For interval, min 15" }, time: s("HH:MM local, for daily/weekly"), days: { type: "array", items: { type: "number" }, description: "0=Sun..6=Sat, for weekly" } }, ["type"]),
        timezone: s("IANA timezone; defaults to the user's"),
      }, ["name", "prompt", "schedule"]),
    },
    run: async (args, ctx) => { const created = await createSchedule(ctx.userId, { name: str(args.name), prompt: str(args.prompt), schedule: (args.schedule || {}) as Args, timezone: str(args.timezone, ctx.timezone), conversationId: ctx.conversationId }); return { ...created, when: describeSpec(created.spec, created.timezone) }; },
  },
  schedule_list: {
    schema: { name: "schedule_list", description: "List the user's scheduled tasks.", parameters: obj({}) },
    run: async (_args, ctx) => (await listSchedules(ctx.userId)).map((item) => ({ id: item.id, name: item.name, when: describeSpec(item.spec, item.timezone), status: item.status, nextRunAt: item.nextRunAt })),
  },
  schedule_update: {
    schema: { name: "schedule_update", description: "Pause, resume or cancel a scheduled task.", parameters: obj({ id: s("Schedule id"), status: { type: "string", enum: ["active", "paused", "cancelled"] } }, ["id", "status"]) },
    run: async (args, ctx) => setScheduleStatus(ctx.userId, str(args.id), str(args.status) as "active"),
  },

  start_background_job: {
    schema: {
      name: "start_background_job",
      description: "Hand off long work to run in the background: deep research across many sources, or a multi-step task that will take a while. Returns at once; the result is posted to this chat and the user gets a notification. Use when the user asks for it, or for work that needs more than a few tool calls.",
      parameters: obj({ title: s("Short title, e.g. 'Compare 3 laptops under 600k'"), prompt: s("Self-contained instructions: the goal, constraints, what the final answer should contain"), kind: { type: "string", enum: ["research", "task"] } }, ["title", "prompt"]),
    },
    run: async (args, ctx) => {
      const jobs = await import("@/lib/assistant/jobs");
      if (await jobs.isJobConversation(ctx.conversationId)) throw new Error("You are already inside a background job; do the work here instead of starting another.");
      const job = await jobs.createJob(ctx.userId, { title: str(args.title), prompt: str(args.prompt), kind: str(args.kind), conversationId: ctx.conversationId, timezone: ctx.timezone });
      const kicked = await jobs.kickJobs(job.id);
      return { id: job.id, title: job.title, status: job.status, note: kicked ? "Started now." : "Queued; it starts within 5 minutes.", tell_user: "It's running in the background. The result will be posted here with a notification; they can follow it in Tasks." };
    },
  },
  background_jobs: {
    schema: { name: "background_jobs", description: "List the user's background jobs and their status.", parameters: obj({}) },
    run: async (_args, ctx) => (await (await import("@/lib/assistant/jobs")).listJobs(ctx.userId, 10)).map((job) => ({ id: job.id, title: job.title, status: job.status, slices: job.slices, lastStep: job.steps[job.steps.length - 1]?.summary || null, result: job.result?.slice(0, 600) || null })),
  },

  browser_open: {
    schema: { name: "browser_open", description: "Open a URL in a real remote browser (for sites needing interaction: forms, carts, bookings, logged-in pages). Returns a snapshot with numbered elements.", parameters: obj({ url: s("URL") }, ["url"]) },
    run: async (args, ctx) => { const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers); await page.goto(str(args.url), { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200); return snapshot(page); },
  },
  browser_snapshot: {
    schema: { name: "browser_snapshot", description: "Re-read the current browser page.", parameters: obj({}) },
    run: async (_args, ctx) => snapshot((await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers)).page),
  },
  browser_click: {
    schema: { name: "browser_click", description: "Click a numbered element from the latest snapshot. Set final=true for any click that pays, places an order, books, sends, or deletes; that waits for the user's approval.", parameters: obj({ element: { type: "number" }, final: { type: "boolean" }, summary: s("For final clicks: what it buys/books and the total shown") }, ["element"]) },
    needsApproval: async (args, ctx) => {
      if (ctx.approved) return null;
      const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers);
      const label = await elementLabel(page, Number(args.element));
      return args.final === true || looksConsequential(label) ? `${str(args.summary, "Final step on " + page.url())}\nButton: "${label}"` : null;
    },
    run: async (args, ctx) => { const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers); await page.locator(`[data-elias-id="${Number(args.element)}"]`).first().click(); await page.waitForLoadState("domcontentloaded").catch(() => undefined); await page.waitForTimeout(1500); return snapshot(page); },
  },
  browser_type: {
    schema: { name: "browser_type", description: "Type into a numbered input from the latest snapshot. Never type card numbers or passwords the user did not give for this purpose.", parameters: obj({ element: { type: "number" }, text: s("Text"), submit: { type: "boolean", description: "Press Enter after" } }, ["element", "text"]) },
    run: async (args, ctx) => { const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers); const field = page.locator(`[data-elias-id="${Number(args.element)}"]`).first(); await field.fill(str(args.text)); if (args.submit) { await field.press("Enter"); await page.waitForTimeout(1500); } return snapshot(page); },
  },
  browser_select: {
    schema: { name: "browser_select", description: "Choose an option in a numbered <select>.", parameters: obj({ element: { type: "number" }, value: s("Option label or value") }, ["element", "value"]) },
    run: async (args, ctx) => { const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers); const field = page.locator(`[data-elias-id="${Number(args.element)}"]`).first(); await field.selectOption({ label: str(args.value) }).catch(() => field.selectOption(str(args.value))); return snapshot(page); },
  },
  browser_close: {
    schema: { name: "browser_close", description: "Close the browser for this conversation when the job is done.", parameters: obj({}) },
    run: async (_args, ctx) => { await endBrowser(ctx.userId, ctx.conversationId, ctx.browsers); return { closed: true }; },
  },

  github_api: {
    schema: { name: "github_api", description: "Read from the GitHub REST API with the user's connected account (GET only), e.g. '/user/repos?sort=updated', '/repos/owner/repo/issues'.", parameters: obj({ path: s("API path starting with /") }, ["path"]) },
    run: async (args, ctx) => {
      if (!ctx.githubToken) throw new Error("GitHub repository access is not connected. Ask the user to connect GitHub in Connectors.");
      const path = str(args.path);
      if (!path.startsWith("/")) throw new Error("path must start with /");
      const response = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" }, cache: "no-store" });
      const text = await response.text();
      if (!response.ok) throw new Error(`GitHub ${response.status}: ${text.slice(0, 300)}`);
      return text.slice(0, 12_000);
    },
  },

  ...CONNECTOR_TOOLS,
  ...CODE_TOOLS,
};

export function toolSchemas(): ToolSchema[] {
  return Object.values(TOOLS).map((tool) => ({ type: "function", function: tool.schema }));
}

export function hasTool(name: string) {
  return name in TOOLS;
}

export async function approvalSummary(name: string, args: Args, ctx: ToolContext) {
  const tool = TOOLS[name];
  const unsafe = unsafeCall(name, args);
  if (unsafe) {
    await recordAudit({ userId: ctx.userId, tool: name, args, status: "blocked", result: unsafe, conversationId: ctx.conversationId, origin: ctx.origin });
    throw new Error(`Refused: ${unsafe}`);
  }
  const gate = connectorGate(name);
  if (gate) throw new Error(gate);
  if (!tool?.needsApproval || ctx.approved) return null;
  return tool.needsApproval(args, ctx);
}

/** Runs a tool. Side-effect tools are written to the audit log (redacted), whatever the outcome. */
export async function runTool(name: string, args: Args, ctx: ToolContext) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool ${name}.`);
  const unsafe = unsafeCall(name, args);
  if (unsafe) {
    await recordAudit({ userId: ctx.userId, tool: name, args, status: "blocked", result: unsafe, approvalId: ctx.approvalId, conversationId: ctx.conversationId, origin: ctx.origin });
    throw new Error(`Refused: ${unsafe}`);
  }
  if (!isSideEffect(name)) return tool.run(args, ctx);
  try {
    const result = await tool.run(args, ctx);
    await recordAudit({ userId: ctx.userId, tool: name, args, status: "ok", result, approvalId: ctx.approvalId, conversationId: ctx.conversationId, origin: ctx.origin });
    return result;
  } catch (error) {
    await recordAudit({ userId: ctx.userId, tool: name, args, status: "error", result: error instanceof Error ? error.message : String(error), approvalId: ctx.approvalId, conversationId: ctx.conversationId, origin: ctx.origin });
    throw error;
  }
}

/* v4 coding agent: repo_* and code_* tools are offered only in code mode (the coding workspace and code jobs). */
export function toolSchemasFor(mode: "chat" | "code" = "chat"): ToolSchema[] {
  return toolSchemas().filter((tool) => mode === "code" || !isCodeTool(tool.function.name));
}
