/** Structured message attachments the chat renders as cards instead of markdown walls. */
import type { DiffCard } from "@/lib/assistant/code/cards";
import type { ResearchReportCard } from "@/lib/research";
export type LinkItem = { title: string; url: string; snippet?: string };
export type EmailItem = { id?: string; from: string; subject: string; date?: string; snippet?: string; unread?: boolean };
export type EventItem = { id?: string; title: string; start?: string; end?: string; location?: string; link?: string; attendees?: string[] };
export type WeatherCard = { kind: "weather"; place: string; summary: string; now?: number; high?: number; low?: number; rainChance?: number };
export type ListItem = { title: string; detail?: string; url?: string; state?: "ok" | "warn" | "error" | "pending" | "info"; trail?: string };
export type ListCard = { kind: "list"; title: string; icon: "github" | "vercel" | "supabase" | "payments"; items: ListItem[]; footer?: string };
export type ReviewItem = { id: string; content: string; kind: string; entity?: string | null };
export type MemoryReviewCard = { kind: "memory_review"; title: string; items: ReviewItem[] };
export type Card =
  | ListCard
  | MemoryReviewCard
  | { kind: "links"; title: string; items: LinkItem[] }
  | { kind: "emails"; title: string; items: EmailItem[] }
  | { kind: "events"; title: string; items: EventItem[] }
  | { kind: "schedule"; title: string; name: string; when: string }
  | WeatherCard
  | DiffCard
  | ResearchReportCard;

export type ConnectCard = {
  provider: "google" | "browser"; configured: boolean;
  /** v5: Google was connected but needs the user again (token expired/revoked, or a permission like Drive is missing). */
  reconnect?: boolean; reason?: "not_connected" | "expired" | "revoked" | "missing_scope"; scope?: "gmail" | "calendar" | "drive"; email?: string | null;
};
export type MemoryChip = { id: string; content: string };

export type ApprovalDetails =
  | { kind: "email"; to: string; cc?: string; subject: string; body: string }
  | { kind: "event"; title: string; start: string; end: string; guests: string[]; location?: string }
  | { kind: "delete_event"; title: string }
  | { kind: "browser"; url: string; action: string; amount?: string }
  | { kind: "other"; text: string };

const str = (value: unknown) => typeof value === "string" ? value : "";

export function amountIn(text: string) {
  return text.match(/(?:[₦$€£]|NGN|USD|EUR|GBP)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:NGN|USD|EUR|GBP|naira|dollars)/i)?.[0];
}

/** What exactly will happen, from the stored tool call. */
export function approvalDetails(tool: string, args: Record<string, unknown>, summary: string): ApprovalDetails {
  if (tool === "gmail_send") return { kind: "email", to: str(args.to), cc: str(args.cc) || undefined, subject: str(args.subject), body: str(args.body) };
  if (tool === "calendar_create") return { kind: "event", title: str(args.summary), start: str(args.start), end: str(args.end), guests: Array.isArray(args.attendees) ? args.attendees.map(String) : [], location: str(args.location) || undefined };
  if (tool === "calendar_delete") return { kind: "delete_event", title: str(args.title) || str(args.event_id) };
  if (tool.startsWith("browser_")) {
    const context = (args._context || {}) as Record<string, unknown>;
    const button = summary.match(/Button: "([^"]*)"/)?.[1];
    return { kind: "browser", url: str(context.url) || summary.match(/https?:\/\/\S+/)?.[0] || "", action: button ? `Click "${button}"` : summary.split("\n")[0], amount: amountIn(summary) };
  }
  return { kind: "other", text: summary };
}

/** Which arguments the user may change from the approval card's Edit form. */
export const EDITABLE_ARGS: Record<string, string[]> = {
  gmail_send: ["to", "cc", "subject", "body"],
  calendar_create: ["summary", "start", "end", "location", "attendees"],
};

/** Turns a tool's raw output into a card, when it has a natural one. */
export function cardFor(tool: string, output: unknown): Card | null {
  try {
    if (tool === "web_search" && Array.isArray(output)) {
      const items = output.slice(0, 4).map((item: Record<string, unknown>) => ({ title: str(item.title) || str(item.url), url: str(item.url) || str(item.link), snippet: (str(item.snippet) || str(item.description) || str(item.content)).slice(0, 160) })).filter((item) => item.url);
      return items.length ? { kind: "links", title: "Sources", items } : null;
    }
    if (tool === "gmail_search" && Array.isArray(output)) {
      const items = output.slice(0, 5).map((item: Record<string, unknown>) => ({ id: str(item.id), from: str(item.from).replace(/<[^>]+>/, "").trim(), subject: str(item.subject) || "(no subject)", date: str(item.date), snippet: str(item.snippet).slice(0, 140), unread: Boolean(item.unread) }));
      return items.length ? { kind: "emails", title: "Email", items } : null;
    }
    if (tool === "calendar_list" && Array.isArray(output)) {
      const items = output.slice(0, 8).map((item: Record<string, unknown>) => ({ id: str(item.id), title: str(item.title) || "(untitled)", start: str(item.start), end: str(item.end), location: str(item.location) || undefined, link: str(item.link) || undefined }));
      return items.length ? { kind: "events", title: "Calendar", items } : null;
    }
    if (tool === "weather" && output && typeof output === "object" && "summary" in output) return { kind: "weather", ...(output as Omit<WeatherCard, "kind">) };
    const connector = connectorCard(tool, output);
    if (connector) return connector;
    if (tool === "schedule_create" && output && typeof output === "object") {
      const item = output as Record<string, unknown>;
      return { kind: "schedule", title: "Scheduled", name: str(item.name), when: str(item.when) };
    }
  } catch { /* cards are best effort */ }
  return null;
}

export const STATUS_LABELS: Record<string, string> = {
  get_time: "Checking the time…", web_search: "Searching the web…", web_open: "Reading a page…",
  memory_save: "Saving to memory…", memory_search: "Checking memory…", memory_update: "Updating memory…", memory_forget: "Forgetting that…",
  gmail_search: "Reading Gmail…", gmail_read: "Reading Gmail…", gmail_draft: "Drafting an email…", gmail_send: "Preparing the email…",
  calendar_list: "Checking calendar…", calendar_create: "Adding to your calendar…", calendar_delete: "Updating your calendar…",
  schedule_create: "Setting that up…", schedule_list: "Checking your tasks…", schedule_update: "Updating your tasks…",
  browser_open: "Opening the browser…", browser_snapshot: "Reading the page…", browser_click: "Clicking…", browser_type: "Typing…", browser_select: "Choosing an option…", browser_close: "Closing the browser…",
  github_api: "Checking GitHub…", github_issues: "Checking GitHub issues…", github_issue_create: "Preparing the issue…", github_prs: "Checking pull requests…", github_pr_status: "Checking the PR…", github_ci_status: "Checking CI…",
  vercel_projects: "Checking Vercel…", vercel_deployments: "Checking deployments…", vercel_redeploy: "Preparing the redeploy…", supabase_health: "Checking Supabase…",
  paystack_transactions: "Reading Paystack…", paystack_balance: "Checking your Paystack balance…", flutterwave_transactions: "Reading Flutterwave…", flutterwave_balance: "Checking your Flutterwave balance…", payments_summary: "Summing up payments…", weather: "Checking the weather…", daily_brief: "Pulling your day together…",
  start_background_job: "Handing it off to the background…", background_jobs: "Checking background jobs…",
};

export function statusLabel(tool: string) {
  return STATUS_LABELS[tool] || "Working…";
}

const STATE: Record<string, ListItem["state"]> = {
  success: "ok", passing: "ok", ready: "ok", completed: "ok", merged: "info", open: "info", healthy: "ok", active_healthy: "ok",
  failure: "error", failing: "error", error: "error", canceled: "warn", cancelled: "warn", timed_out: "error", closed: "warn",
  pending: "pending", queued: "pending", in_progress: "pending", building: "pending", initializing: "pending", none: "info",
};
const stateOf = (value: unknown) => STATE[String(value ?? "").toLowerCase()] || "info";
const money = (amount: number, currency: string) => `${currency} ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const rec = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
const list = (value: unknown) => (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;

/** Cards for the dev and payments connectors (GitHub, Vercel, Supabase, Paystack, Flutterwave). */
export function connectorCard(tool: string, output: unknown): ListCard | null {
  const data = rec(output);
  if (tool === "github_issues") return { kind: "list", icon: "github", title: `Issues · ${str(data.repo)}`, items: list(data.issues).slice(0, 8).map((item) => ({ title: `#${item.number} ${str(item.title)}`, detail: [str(item.author), list(item.labels).length ? (item.labels as string[]).join(", ") : ""].filter(Boolean).join(" · "), url: str(item.url), state: stateOf(item.state) })) };
  if (tool === "github_issue_create") return { kind: "list", icon: "github", title: "Issue opened", items: [{ title: `#${data.number} ${str(data.title)}`, detail: str(data.repo), url: str(data.url), state: "ok" }] };
  if (tool === "github_prs") return { kind: "list", icon: "github", title: `Pull requests · ${str(data.repo)}`, items: list(data.pulls).slice(0, 8).map((item) => ({ title: `#${item.number} ${str(item.title)}`, detail: `${str(item.branch)} → ${str(item.base)}${item.draft ? " · draft" : ""}`, url: str(item.url), state: stateOf(item.state), trail: str(item.state) })) };
  if (tool === "github_pr_status") {
    const checks = rec(data.checks);
    return { kind: "list", icon: "github", title: `PR #${data.number} · ${str(data.title)}`.slice(0, 90), items: [
      { title: `Checks ${str(checks.overall)}`, detail: `${checks.total} total · ${checks.failing} failing · ${checks.pending} pending`, state: stateOf(checks.overall), url: str(data.url) },
      ...list(checks.runs).filter((run) => run.conclusion && !["success", "skipped", "neutral"].includes(String(run.conclusion))).slice(0, 4).map((run) => ({ title: str(run.name), detail: str(run.conclusion), url: str(run.url), state: "error" as const })),
      { title: `State: ${str(data.state)}${data.draft ? " (draft)" : ""}`, detail: data.mergeableState ? `mergeable: ${str(data.mergeableState)}` : undefined, state: stateOf(data.state) },
    ] };
  }
  if (tool === "github_ci_status") return { kind: "list", icon: "github", title: `CI · ${str(data.repo)}`, items: [
    ...list(data.runs).slice(0, 4).map((run) => ({ title: `${str(run.workflow)} · ${str(run.branch)}`, detail: `${str(run.sha)} · ${str(run.event)}`, url: str(run.url), state: stateOf(run.conclusion || run.status), trail: str(run.conclusion) || str(run.status) })),
    ...list(data.deployments).slice(0, 2).map((item) => ({ title: `Deploy · ${str(item.environment)}`, detail: str(item.sha), url: str(item.url) || undefined, state: stateOf(item.state), trail: str(item.state) })),
  ] };
  if (tool === "vercel_projects" && Array.isArray(output)) return { kind: "list", icon: "vercel", title: "Vercel projects", items: list(output).slice(0, 8).map((item) => { const prod = rec(item.production); return { title: str(item.name), detail: str(item.framework) || undefined, url: str(prod.url) || undefined, state: stateOf(prod.state), trail: str(prod.state) || "no deploys" }; }) };
  if (tool === "vercel_deployments") return { kind: "list", icon: "vercel", title: `Deployments · ${str(data.project)}`, items: list(data.deployments).slice(0, 6).map((item) => ({ title: str(item.commit) || str(item.url), detail: [str(item.target), str(item.branch), str(item.sha)].filter(Boolean).join(" · "), url: str(item.inspect) || str(item.url), state: stateOf(item.state), trail: str(item.state) })) };
  if (tool === "vercel_redeploy") return { kind: "list", icon: "vercel", title: "Redeploy started", items: [{ title: str(data.project), detail: str(data.id), url: str(data.url), state: stateOf(data.state), trail: str(data.state) }] };
  if (tool === "supabase_health") {
    const db = rec(data.database);
    const services = Array.isArray(data.services) ? list(data.services) : [];
    const security = rec(data.security);
    return { kind: "list", icon: "supabase", title: "Supabase health", items: [
      { title: "Database", detail: `${db.latencyMs} ms · ${db.sizeMb} MB · ${db.connections} connections`, state: db.reachable ? "ok" : "error", trail: db.reachable ? "up" : "down" },
      ...services.map((item) => ({ title: str(item.name), detail: str(item.status), state: item.healthy ? "ok" as const : "error" as const })),
      ...(data.security ? [{ title: "Security advisor", detail: `${security.errors} errors · ${security.warnings} warnings`, state: Number(security.errors) ? "error" as const : Number(security.warnings) ? "warn" as const : "ok" as const }] : []),
    ], footer: data.mode === "database" ? "Database check only. Add SUPABASE_ACCESS_TOKEN for service health." : undefined };
  }
  if (tool === "paystack_balance" || tool === "flutterwave_balance") return { kind: "list", icon: "payments", title: tool === "paystack_balance" ? "Paystack balance" : "Flutterwave balance", items: list(output).map((item) => ({ title: money(Number(item.balance ?? item.available), str(item.currency)), detail: item.ledger !== undefined ? `ledger ${money(Number(item.ledger), str(item.currency))}` : undefined, state: "info" as const })) };
  if (tool === "paystack_transactions" || tool === "flutterwave_transactions") return { kind: "list", icon: "payments", title: tool === "paystack_transactions" ? "Paystack" : "Flutterwave", items: list(data.transactions).slice(0, 6).map((item) => ({ title: money(Number(item.amount), str(item.currency)), detail: [str(item.description), str(item.customer)].filter(Boolean).join(" · ").slice(0, 90), state: stateOf(item.status === "successful" ? "success" : item.status === "success" ? "success" : item.status), trail: str(item.at).slice(0, 10) })) };
  if (tool === "payments_summary") return { kind: "list", icon: "payments", title: `Payments · last ${data.days} days`, items: Object.entries(rec(data.byCurrency)).map(([currency, raw]) => { const bucket = rec(raw); return { title: money(Number(bucket.total), currency), detail: `${bucket.successful} successful · ${bucket.failed} failed`, state: "info" as const }; }), footer: "Read-only. Elias never moves money." };
  return null;
}

/* v4 coding agent (appended): PR approvals can be edited; status labels for repo_/code_ tools. */
EDITABLE_ARGS.code_open_pr = ["title", "body"];
Object.assign(STATUS_LABELS, {
  repo_tree: "Looking through the repo", repo_grep: "Searching the code", repo_read: "Reading code",
  code_edit: "Editing code", code_patch: "Applying a patch", code_create_file: "Creating a file", code_delete_file: "Deleting a file",
  code_diff: "Reviewing the diff", code_commit: "Committing", code_verify: "Running checks", code_open_pr: "Opening a PR", code_merge_pr: "Merging",
  code_start_job: "Starting a coding job",
});

/* v5 Google (appended): cards for triage, agenda, free time, Drive and event changes; approval details for calendar_move. */
Object.assign(STATUS_LABELS, {
  gmail_triage: "Sorting your inbox…", gmail_thread: "Reading the thread…", gmail_draft_reply: "Drafting a reply…",
  calendar_agenda: "Checking your calendar…", calendar_free_time: "Finding free time…", calendar_move: "Preparing the change…",
  drive_search: "Searching Drive…", drive_read: "Reading the file…",
});
EDITABLE_ARGS.calendar_move = ["start", "end", "summary"];

export function googleCardFor(tool: string, output: unknown): Card | null {
  try {
    const data = rec(output);
    if (tool === "gmail_triage") {
      const pick = (key: string, why?: string) => list(data[key]).map((item) => ({ id: str(item.id), from: str(item.from), subject: str(item.subject) || "(no subject)", date: str(item.date), snippet: [why || str(item.why), str(item.snippet)].filter(Boolean).join(" · ").slice(0, 140), unread: true }));
      const items = [...pick("needsReply"), ...pick("important"), ...pick("money", "money")].slice(0, 6);
      return items.length ? { kind: "emails", title: "Needs you", items } : null;
    }
    if (tool === "calendar_agenda") {
      const items = list(data.days).flatMap((day) => list(day.events).map((event) => ({ id: str(event.id), title: str(event.title) || "(untitled)", start: str(event.start), end: str(event.end), location: str(event.location) || undefined, link: str(event.link) || undefined, attendees: Array.isArray(event.attendees) ? (event.attendees as string[]) : undefined }))).slice(0, 10);
      return items.length ? { kind: "events", title: list(data.days).length > 1 ? "Agenda" : "Calendar", items } : null;
    }
    if (tool === "calendar_free_time") {
      const items = list(data.slots).slice(0, 8).map((slot) => ({ title: `Free · ${slot.minutes} min`, start: str(slot.start), end: str(slot.end) }));
      return items.length ? { kind: "events", title: `Free time · ${str(data.workingHours)}`, items } : null;
    }
    if ((tool === "calendar_create" || tool === "calendar_move") && data.id) return { kind: "events", title: tool === "calendar_move" ? "Moved" : "Added to your calendar", items: [{ id: str(data.id), title: str(data.title), start: str(data.start), end: str(data.end), link: str(data.link) || undefined, attendees: Array.isArray(data.invited) && data.invited.length ? (data.invited as string[]) : undefined }] };
    if (tool === "drive_search" && Array.isArray(output)) {
      const items = list(output).slice(0, 6).map((file) => ({ title: str(file.name), url: str(file.link), snippet: [str(file.type).replace(/^google-/, "Google "), str(file.owner), str(file.modified).slice(0, 10)].filter(Boolean).join(" · ") })).filter((item) => item.url);
      return items.length ? { kind: "links", title: "Drive", items } : null;
    }
  } catch { /* best effort */ }
  return cardFor(tool, output);
}

export function googleApprovalDetails(tool: string, args: Record<string, unknown>, summary: string): ApprovalDetails {
  if (tool === "calendar_move") return { kind: "event", title: str(args.summary) || str(args.title) || summary.match(/Move "([^"]*)"/)?.[1] || "Event", start: str(args.start), end: str(args.end), guests: (summary.match(/Guests notified: (.*)/)?.[1] || "").split(/,\s*/).filter(Boolean) };
  return approvalDetails(tool, args, summary);
}
