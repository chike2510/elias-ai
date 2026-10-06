/** Structured message attachments the chat renders as cards instead of markdown walls. */
export type LinkItem = { title: string; url: string; snippet?: string };
export type EmailItem = { id?: string; from: string; subject: string; date?: string; snippet?: string; unread?: boolean };
export type EventItem = { id?: string; title: string; start?: string; end?: string; location?: string; link?: string; attendees?: string[] };
export type WeatherCard = { kind: "weather"; place: string; summary: string; now?: number; high?: number; low?: number; rainChance?: number };
export type Card =
  | { kind: "links"; title: string; items: LinkItem[] }
  | { kind: "emails"; title: string; items: EmailItem[] }
  | { kind: "events"; title: string; items: EventItem[] }
  | { kind: "schedule"; title: string; name: string; when: string }
  | WeatherCard;

export type ConnectCard = { provider: "google" | "browser"; configured: boolean };
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
  github_api: "Checking GitHub…", weather: "Checking the weather…", daily_brief: "Pulling your day together…",
};

export function statusLabel(tool: string) {
  return STATUS_LABELS[tool] || "Working…";
}
