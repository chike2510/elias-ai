/**
 * v5 Google core: token lifecycle + Gmail / Calendar / Drive calls, with the token store and fetch injected
 * so it runs against the real Google APIs in the app and against lib/assistant/googleMock.ts in tests.
 * No database or Next.js imports here (google.ts wires the Postgres store).
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose"];
export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const BASE_SCOPES = ["openid", "email", "profile", ...GMAIL_SCOPES, ...CALENDAR_SCOPES];
/** Google drops refresh tokens of apps in "Testing" publishing status 7 days after consent. */
export const TESTING_REFRESH_DAYS = 7;

export type ConnectionStatus = "ok" | "expired" | "revoked";
export type TokenRecord = {
  email: string | null; scope: string | null; accessToken: string; refreshToken: string | null;
  expiresAt: Date | null; connectedAt: Date | null; status: ConnectionStatus; lastError: string | null; extraScopes: string[];
};
/** Values in and out of the store are plaintext; the store encrypts at rest. */
export type TokenStore = {
  load(userId: string): Promise<TokenRecord | null>;
  saveAccess(userId: string, accessToken: string, expiresAt: Date, refreshToken?: string | null): Promise<void>;
  markBroken(userId: string, status: Exclude<ConnectionStatus, "ok">, error: string): Promise<void>;
  wantScope?(userId: string, scope: string): Promise<void>;
};

export type ReconnectReason = "not_connected" | "expired" | "revoked" | "missing_scope";
/** Anything that only the user can fix by (re)connecting Google. The chat turns it into a reconnect card. */
export class GoogleReconnectError extends Error {
  readonly reconnect = true;
  constructor(readonly reason: ReconnectReason, message: string, readonly scope?: "gmail" | "calendar" | "drive") { super(message); this.name = "GoogleReconnectError"; }
}
export function isReconnectError(error: unknown): error is GoogleReconnectError {
  return Boolean(error && typeof error === "object" && (error as { reconnect?: unknown }).reconnect === true);
}

const REASON_TEXT: Record<ReconnectReason, string> = {
  not_connected: "Google isn't connected.",
  expired: "Google access expired (while Elias is in Google's testing mode it signs out every 7 days).",
  revoked: "Google access was removed from the Google account.",
  missing_scope: "Google is connected without the permission this needs.",
};
export const reconnectText = (reason: ReconnectReason) => `${REASON_TEXT[reason]} The user sees a Reconnect Google button in the chat; tell them in one friendly line to tap it, then you can finish this.`;

export type GoogleClient = { userId: string; request<T>(url: string, init?: RequestInit): Promise<T>; requestText(url: string): Promise<string>; email(): Promise<string | null>; scopes(): Promise<string[]> };

export function scopeFlags(scope: string | null | undefined) {
  const granted = new Set((scope || "").split(/\s+/).filter(Boolean));
  return {
    gmail: GMAIL_SCOPES.some((item) => granted.has(item)) || granted.has("https://www.googleapis.com/auth/gmail.readonly"),
    gmailSend: granted.has("https://www.googleapis.com/auth/gmail.compose") || granted.has("https://www.googleapis.com/auth/gmail.modify") || granted.has("https://www.googleapis.com/auth/gmail.send"),
    calendar: CALENDAR_SCOPES.some((item) => granted.has(item)),
    drive: granted.has(DRIVE_SCOPE) || granted.has("https://www.googleapis.com/auth/drive"),
  };
}

export function createGoogleClient(input: { userId: string; store: TokenStore; fetch?: FetchLike; clientId?: string; clientSecret?: string; now?: () => number }): GoogleClient {
  const doFetch = input.fetch || ((url, init) => fetch(url, init));
  const now = input.now || Date.now;
  let record: TokenRecord | null | undefined;

  async function load() {
    if (record === undefined) record = await input.store.load(input.userId);
    if (!record) throw new GoogleReconnectError("not_connected", "Google is not connected. Ask the user to connect Google in Elias.");
    if (record.status !== "ok") throw new GoogleReconnectError(record.status, `${REASON_TEXT[record.status]} Ask the user to reconnect Google.`);
    return record;
  }

  async function refresh(current: TokenRecord) {
    if (!current.refreshToken) {
      await input.store.markBroken(input.userId, "expired", "no refresh token");
      throw new GoogleReconnectError("expired", "Google access expired and there is no refresh token. Ask the user to reconnect Google.");
    }
    let response: Response;
    try {
      response = await doFetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: input.clientId ?? process.env.GOOGLE_CLIENT_ID ?? "", client_secret: input.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: current.refreshToken, grant_type: "refresh_token" }).toString(),
      });
    } catch (error) {
      throw new Error(`Couldn't reach Google to refresh access (${error instanceof Error ? error.message : String(error)}). Try again shortly.`);
    }
    const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !data.access_token) {
      // invalid_grant = refresh token expired (7-day testing limit), revoked, or password changed: only a reconnect fixes it.
      if (data.error === "invalid_grant" || data.error === "unauthorized_client") {
        const revoked = /revoked/i.test(data.error_description || "");
        await input.store.markBroken(input.userId, revoked ? "revoked" : "expired", `${data.error}: ${data.error_description || ""}`.slice(0, 200));
        throw new GoogleReconnectError(revoked ? "revoked" : "expired", `${REASON_TEXT[revoked ? "revoked" : "expired"]} Ask the user to reconnect Google.`);
      }
      throw new Error(`Google couldn't refresh access right now (${response.status} ${data.error || ""}). Try again shortly.`);
    }
    const expiresAt = new Date(now() + (data.expires_in || 3600) * 1000);
    await input.store.saveAccess(input.userId, data.access_token, expiresAt, data.refresh_token || null);
    record = { ...current, accessToken: data.access_token, expiresAt, refreshToken: data.refresh_token || current.refreshToken };
    return data.access_token;
  }

  async function token(force = false) {
    const current = await load();
    if (!force && current.expiresAt && current.expiresAt.getTime() > now() + 60_000) return current.accessToken;
    return refresh(current);
  }

  async function raw(url: string, init: RequestInit = {}) {
    const call = async (access: string) => doFetch(url, { ...init, headers: { Authorization: `Bearer ${access}`, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) }, cache: "no-store" } as RequestInit);
    let response = await call(await token());
    if (response.status === 401) {
      // The stored access token can be dead before its expiry (revoked, password change): refresh once, then give up.
      response = await call(await token(true));
      if (response.status === 401) {
        await input.store.markBroken(input.userId, "revoked", "401 after refresh");
        throw new GoogleReconnectError("revoked", `${REASON_TEXT.revoked} Ask the user to reconnect Google.`);
      }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(text)) {
        const scope = url.includes("/drive/") ? "drive" : url.includes("/calendar/") ? "calendar" : "gmail";
        if (scope === "drive") await input.store.wantScope?.(input.userId, DRIVE_SCOPE).catch(() => undefined);
        throw new GoogleReconnectError("missing_scope", `Google is connected without ${scope === "drive" ? "Drive" : scope === "calendar" ? "Calendar" : "Gmail"} access. Ask the user to reconnect Google and allow it.`, scope);
      }
      if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) {
        const api = url.includes("/drive/") ? "Google Drive API" : url.includes("/calendar/") ? "Google Calendar API" : "Gmail API";
        throw new Error(`The ${api} isn't enabled in Elias's Google Cloud project yet, so this can't run. The owner enables it in the Google Cloud console (APIs & Services > Library). Tell the user in one line.`);
      }
      if (response.status === 404) throw new Error(`Google couldn't find that (404). ${text.slice(0, 160)}`);
      if (response.status === 429) throw new Error("Google is rate-limiting requests right now. Try again in a minute.");
      throw new Error(`Google API ${response.status}: ${text.slice(0, 300)}`);
    }
    return response;
  }

  return {
    userId: input.userId,
    async request<T>(url: string, init: RequestInit = {}) { const text = await (await raw(url, init)).text(); return (text ? JSON.parse(text) : {}) as T; },
    async requestText(url: string) { return (await raw(url)).text(); },
    async email() { return (await load()).email; },
    async scopes() { return ((await load()).scope || "").split(/\s+/).filter(Boolean); },
  };
}

/* ---------------- Gmail ---------------- */

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; size?: number }; parts?: GmailPart[]; headers?: GmailHeader[] };
export type GmailMessage = { id: string; threadId: string; snippet?: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart };

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const header = (message: GmailMessage, name: string) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";

export function bodyText(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts || []) { const text = bodyText(child); if (text) return text; }
  if (part.mimeType === "text/html" && part.body?.data) return htmlToText(Buffer.from(part.body.data, "base64url").toString("utf8"));
  return "";
}

function htmlToText(html: string) {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** Drops the quoted history below a reply so a thread reads as a conversation, not nested copies. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((line, index) => /^On .{4,200}wrote:\s*$/.test(line.trim()) || (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) || (/^From: /.test(line) && index > 0 && /^\s*$/.test(lines[index - 1] || "")));
  return (cut > 0 ? lines.slice(0, cut) : lines).filter((line) => !line.startsWith(">")).join("\n").trim();
}

function attachments(part?: GmailPart, out: string[] = []) {
  if (!part) return out;
  if (part.filename) out.push(part.filename);
  for (const child of part.parts || []) attachments(child, out);
  return out;
}

const addressOf = (value: string) => (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase();
const nameOf = (value: string) => value.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || addressOf(value);
const splitAddresses = (value: string) => value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => item.trim()).filter(Boolean);

const metadata = (id: string, headers: string[]) => `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&${headers.map((item) => `metadataHeaders=${encodeURIComponent(item)}`).join("&")}`;

export async function gmailSearch(client: GoogleClient, query: string, max = 10) {
  const list = await client.request<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>(`${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(Math.max(1, max), 25)) })}`);
  const messages = await Promise.all((list.messages || []).map((item) => client.request<GmailMessage>(metadata(item.id, ["From", "Subject", "Date"]))));
  return messages.map((message) => ({ id: message.id, threadId: message.threadId, from: header(message, "From"), subject: header(message, "Subject"), date: header(message, "Date"), snippet: message.snippet, unread: Boolean(message.labelIds?.includes("UNREAD")) }));
}

export async function gmailRead(client: GoogleClient, id: string) {
  const message = await client.request<GmailMessage>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
  return { id: message.id, threadId: message.threadId, from: header(message, "From"), to: header(message, "To"), cc: header(message, "Cc"), subject: header(message, "Subject"), date: header(message, "Date"), messageId: header(message, "Message-ID"), attachments: attachments(message.payload), body: bodyText(message.payload).slice(0, 12_000) };
}

/** A whole thread, oldest first, quoted history stripped, capped so long threads keep their newest messages. */
export async function gmailThread(client: GoogleClient, threadId: string) {
  const thread = await client.request<{ id: string; messages?: GmailMessage[] }>(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  const all = (thread.messages || []).map((message) => ({
    id: message.id, from: header(message, "From"), to: header(message, "To"), cc: header(message, "Cc"), date: header(message, "Date"),
    unread: Boolean(message.labelIds?.includes("UNREAD")), attachments: attachments(message.payload), body: stripQuoted(bodyText(message.payload) || message.snippet || "").slice(0, 4000),
  }));
  let budget = 16_000;
  const kept: typeof all = [];
  for (const message of [...all].reverse()) { if (budget <= 0) break; budget -= message.body.length; kept.unshift(message); }
  const first = thread.messages?.[0];
  const last = thread.messages?.[thread.messages.length - 1];
  return {
    threadId: thread.id, subject: first ? header(first, "Subject") : "", messageCount: all.length, omitted: all.length - kept.length,
    participants: [...new Set(all.flatMap((item) => [item.from, ...splitAddresses(item.to), ...splitAddresses(item.cc)]).filter(Boolean).map(nameOf))].slice(0, 12),
    lastMessageId: last?.id || null, messages: kept,
  };
}

export type TriageItem = { id: string; threadId: string; from: string; subject: string; date: string; snippet: string; why: string };
export type Triage = {
  window: string; unread: number; scanned: number; summary: string;
  needsReply: TriageItem[]; important: TriageItem[]; money: TriageItem[];
  updates: { count: number; senders: string[] }; promotions: { count: number; senders: string[] };
};

const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|updates?|alerts?|info|support|hello|team|news|marketing)@/i;
const MONEY = /\b(invoice|receipt|payment|paid|bill|statement|debit|credit alert|transaction|due|overdue|subscription|renewal|refund|transfer)\b/i;
const QUESTION = /\?|\b(can you|could you|please|let me know|are you|would you|when can|confirm)\b/i;

/** Sorts unread inbox mail into what needs the user (reply / important / money) and what can wait (updates / promotions). Read-only. */
export async function gmailTriage(client: GoogleClient, options: { days?: number; max?: number } = {}): Promise<Triage> {
  const days = Math.min(Math.max(1, Math.round(options.days || 2)), 14);
  const max = Math.min(Math.max(5, options.max || 30), 40);
  const self = (await client.email().catch(() => null))?.toLowerCase() || "";
  const query = `in:inbox is:unread newer_than:${days}d`;
  const list = await client.request<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>(`${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`);
  const messages = await Promise.all((list.messages || []).map((item) => client.request<GmailMessage>(metadata(item.id, ["From", "To", "Cc", "Subject", "Date", "List-Unsubscribe", "Precedence", "Reply-To"]))));
  const triage: Triage = { window: `last ${days} day${days === 1 ? "" : "s"}`, unread: Math.max(list.resultSizeEstimate || 0, messages.length), scanned: messages.length, summary: "", needsReply: [], important: [], money: [], updates: { count: 0, senders: [] }, promotions: { count: 0, senders: [] } };
  const bump = (bucket: { count: number; senders: string[] }, from: string) => { bucket.count += 1; const name = nameOf(from); if (!bucket.senders.includes(name) && bucket.senders.length < 5) bucket.senders.push(name); };
  for (const message of messages) {
    const labels = new Set(message.labelIds || []);
    const from = header(message, "From");
    const subject = header(message, "Subject") || "(no subject)";
    const snippet = (message.snippet || "").slice(0, 160);
    const item = (why: string): TriageItem => ({ id: message.id, threadId: message.threadId, from: nameOf(from), subject, date: header(message, "Date"), snippet, why });
    const bulk = Boolean(header(message, "List-Unsubscribe")) || /bulk|list/i.test(header(message, "Precedence")) || AUTOMATED.test(addressOf(from));
    const toMe = !self || [...splitAddresses(header(message, "To")), ...splitAddresses(header(message, "Cc"))].some((value) => addressOf(value) === self);
    if (labels.has("CATEGORY_PROMOTIONS") || labels.has("CATEGORY_SOCIAL")) { bump(triage.promotions, from); continue; }
    if (MONEY.test(`${subject} ${snippet}`) && !labels.has("CATEGORY_PROMOTIONS")) { triage.money.push(item("money")); continue; }
    if (!bulk && toMe && !labels.has("CATEGORY_UPDATES") && !labels.has("CATEGORY_FORUMS")) { triage.needsReply.push(item(QUESTION.test(`${subject} ${snippet}`) ? "asks you something" : "from a person, to you")); continue; }
    if (labels.has("IMPORTANT") || labels.has("STARRED")) { triage.important.push(item(labels.has("STARRED") ? "starred" : "marked important")); continue; }
    bump(triage.updates, from);
  }
  triage.needsReply.sort((a, b) => Number(b.why === "asks you something") - Number(a.why === "asks you something"));
  const parts = [
    triage.needsReply.length ? `${triage.needsReply.length} may need a reply` : "",
    triage.important.length ? `${triage.important.length} important` : "",
    triage.money.length ? `${triage.money.length} about money` : "",
    triage.updates.count ? `${triage.updates.count} updates` : "",
    triage.promotions.count ? `${triage.promotions.count} promotions` : "",
  ].filter(Boolean);
  triage.summary = messages.length ? `${triage.unread} unread in the ${triage.window}: ${parts.join(", ")}.` : `No unread email in the ${triage.window}.`;
  triage.needsReply = triage.needsReply.slice(0, 8); triage.important = triage.important.slice(0, 6); triage.money = triage.money.slice(0, 6);
  return triage;
}

/** Header values can't carry CR/LF (header injection); non-ASCII subjects are RFC 2047 encoded. */
const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const encodeHeader = (value: string) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

export type EmailInput = { to: string; subject: string; body: string; cc?: string; threadId?: string; inReplyTo?: string; references?: string };

export function rawEmail(input: EmailInput) {
  const lines = [`To: ${clean(input.to)}`, ...(input.cc ? [`Cc: ${clean(input.cc)}`] : []), `Subject: ${encodeHeader(clean(input.subject))}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit",
    ...(input.inReplyTo ? [`In-Reply-To: ${clean(input.inReplyTo)}`, `References: ${clean(input.references || input.inReplyTo)}`] : []), "", input.body.replace(/\r?\n/g, "\r\n")];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

const validRecipients = (value: string) => splitAddresses(value).every((item) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(addressOf(item)));

export async function gmailDraft(client: GoogleClient, input: EmailInput) {
  if (!input.to || !validRecipients(input.to)) throw new Error(`"${input.to}" isn't a valid recipient list.`);
  const draft = await client.request<{ id: string; message?: { id: string; threadId: string } }>(`${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message: { raw: rawEmail(input), ...(input.threadId ? { threadId: input.threadId } : {}) } }) });
  return { draftId: draft.id, threadId: draft.message?.threadId || input.threadId || null };
}

/** Drafts a reply in the thread with the right recipients and threading headers. Never sends. */
export async function gmailDraftReply(client: GoogleClient, input: { threadId?: string; messageId?: string; body: string; replyAll?: boolean }) {
  if (!input.body?.trim()) throw new Error("The reply body is empty.");
  let target: GmailMessage | undefined;
  if (input.messageId) target = await client.request<GmailMessage>(metadata(input.messageId, ["From", "Reply-To", "To", "Cc", "Subject", "Message-ID", "References"]));
  else if (input.threadId) {
    const thread = await client.request<{ messages?: GmailMessage[] }>(`${GMAIL}/threads/${encodeURIComponent(input.threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
    const self = (await client.email().catch(() => null))?.toLowerCase();
    const messages = thread.messages || [];
    // Reply to the newest message someone else sent; fall back to the newest one.
    target = [...messages].reverse().find((message) => addressOf(header(message, "From")) !== self) || messages[messages.length - 1];
  } else throw new Error("Give the thread_id (or message_id) to reply to.");
  if (!target) throw new Error("That thread has no messages.");
  const self = (await client.email().catch(() => null))?.toLowerCase() || "";
  const fromSelf = addressOf(header(target, "From")) === self;
  const to = fromSelf ? header(target, "To") : header(target, "Reply-To") || header(target, "From");
  const toSet = new Set(splitAddresses(to).map(addressOf));
  const cc = input.replyAll ? splitAddresses([fromSelf ? "" : header(target, "To"), header(target, "Cc")].filter(Boolean).join(", ")).filter((item) => { const address = addressOf(item); return address !== self && !toSet.has(address); }).join(", ") : "";
  const subjectRaw = header(target, "Subject");
  const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
  const inReplyTo = header(target, "Message-ID");
  const references = [header(target, "References"), inReplyTo].filter(Boolean).join(" ");
  const draft = await gmailDraft(client, { to, cc: cc || undefined, subject, body: input.body, threadId: target.threadId, inReplyTo: inReplyTo || undefined, references: references || undefined });
  return { ...draft, to, cc: cc || undefined, subject, body: input.body, inReplyTo: inReplyTo || undefined, references: references || undefined, note: "Saved as a draft in Gmail. To send it, call gmail_send with draft_id and these fields (the user approves first)." };
}

/** Sends an email. Callers must have the user's approval (the gmail_send tool always asks). With draft_id the draft is updated to the approved text and sent, so it doesn't linger in Drafts. */
export async function gmailSend(client: GoogleClient, input: EmailInput & { draftId?: string }) {
  if (!input.to || !validRecipients(input.to)) throw new Error(`"${input.to}" isn't a valid recipient list.`);
  if (input.draftId) {
    const message = { raw: rawEmail(input), ...(input.threadId ? { threadId: input.threadId } : {}) };
    await client.request(`${GMAIL}/drafts/${encodeURIComponent(input.draftId)}`, { method: "PUT", body: JSON.stringify({ id: input.draftId, message }) });
    const sent = await client.request<{ id: string; threadId?: string }>(`${GMAIL}/drafts/send`, { method: "POST", body: JSON.stringify({ id: input.draftId }) });
    return { messageId: sent.id, threadId: sent.threadId || input.threadId || null, sentFromDraft: input.draftId };
  }
  const sent = await client.request<{ id: string; threadId?: string }>(`${GMAIL}/messages/send`, { method: "POST", body: JSON.stringify({ raw: rawEmail(input), ...(input.threadId ? { threadId: input.threadId } : {}) }) });
  return { messageId: sent.id, threadId: sent.threadId || input.threadId || null };
}

/* ---------------- Calendar ---------------- */

const CAL = "https://www.googleapis.com/calendar/v3";
type CalendarEvent = { id: string; status?: string; summary?: string; description?: string; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string }; location?: string; attendees?: Array<{ email: string; responseStatus?: string; self?: boolean; organizer?: boolean }>; organizer?: { email?: string; self?: boolean }; htmlLink?: string; hangoutLink?: string };

function zoneParts(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: String(parts.weekday) };
}
/** The UTC instant of a wall-clock time in a timezone. */
export function zoned(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i += 1) { const p = zoneParts(new Date(guess), timezone); guess += Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); }
  return new Date(guess);
}
export function validTz(timezone?: string) { try { if (!timezone) return false; new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return true; } catch { return false; } }

/** "today" | "tomorrow" | weekday name | YYYY-MM-DD → that local date. */
export function resolveDay(value: string | undefined, timezone: string, now = new Date()) {
  const today = zoneParts(now, timezone);
  const base = Date.UTC(today.year, today.month - 1, today.day);
  const text = (value || "today").trim().toLowerCase();
  let ms = base;
  if (text === "tomorrow") ms = base + 86400_000;
  else if (text === "yesterday") ms = base - 86400_000;
  else if (/^\d{4}-\d{2}-\d{2}/.test(text)) ms = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
  else {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = days.findIndex((day) => text.replace(/^(next|this)\s+/, "").startsWith(day.slice(0, 3)));
    if (target >= 0) { const current = new Date(base).getUTCDay(); let diff = (target - current + 7) % 7; if (diff === 0 && text.startsWith("next")) diff = 7; ms = base + diff * 86400_000; }
  }
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
const ymd = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const addDays = (d: { year: number; month: number; day: number }, n: number) => { const date = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * 86400_000); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }; };
const localTime = (iso: string | undefined, timezone: string) => !iso ? "" : !iso.includes("T") ? "all day" : new Date(iso).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });

const shapeEvent = (event: CalendarEvent) => ({
  id: event.id, title: event.summary || "(untitled)", start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date,
  location: event.location, attendees: event.attendees?.filter((item) => !item.self).map((item) => item.email), link: event.hangoutLink || event.htmlLink,
  myResponse: event.attendees?.find((item) => item.self)?.responseStatus,
});

export async function calendarList(client: GoogleClient, timeMin: string, timeMax: string) {
  const data = await client.request<{ items?: CalendarEvent[] }>(`${CAL}/calendars/primary/events?${new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" })}`);
  return (data.items || []).filter((event) => event.status !== "cancelled").map(shapeEvent);
}

/** A day-by-day agenda in the user's timezone. */
export async function calendarAgenda(client: GoogleClient, input: { date?: string; days?: number; timezone: string; now?: Date }) {
  const timezone = validTz(input.timezone) ? input.timezone : "Africa/Lagos";
  const days = Math.min(Math.max(1, Math.round(input.days || 1)), 14);
  const first = resolveDay(input.date, timezone, input.now);
  const from = zoned(first.year, first.month, first.day, 0, 0, timezone);
  const last = addDays(first, days);
  const to = zoned(last.year, last.month, last.day, 0, 0, timezone);
  const events = await calendarList(client, from.toISOString(), to.toISOString());
  const byDay = Array.from({ length: days }, (_, index) => { const day = addDays(first, index); return { date: ymd(day), label: zoned(day.year, day.month, day.day, 12, 0, timezone).toLocaleDateString("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "short" }), events: [] as Array<ReturnType<typeof shapeEvent> & { time: string }> }; });
  for (const event of events) {
    const key = event.start?.includes("T") ? ymd(zoneParts(new Date(event.start), timezone)) : (event.start || "").slice(0, 10);
    const bucket = byDay.find((item) => item.date === key) || (event.start && !event.start.includes("T") && key < byDay[0].date ? byDay[0] : undefined);
    bucket?.events.push({ ...event, time: event.start?.includes("T") ? `${localTime(event.start, timezone)}–${localTime(event.end, timezone)}` : "all day" });
  }
  return { timezone, from: from.toISOString(), to: to.toISOString(), total: events.length, days: byDay };
}

/** Free slots inside working hours, from the primary calendar's busy times (freeBusy). */
export async function calendarFreeTime(client: GoogleClient, input: { date?: string; days?: number; timezone: string; dayStart?: string; dayEnd?: string; minMinutes?: number; now?: Date }) {
  const timezone = validTz(input.timezone) ? input.timezone : "Africa/Lagos";
  const days = Math.min(Math.max(1, Math.round(input.days || 1)), 14);
  const minMinutes = Math.min(Math.max(15, Math.round(input.minMinutes || 30)), 8 * 60);
  const hm = (value: string | undefined, fallback: string) => { const match = (value || fallback).match(/^(\d{1,2}):(\d{2})$/) || fallback.match(/^(\d{1,2}):(\d{2})$/)!; return [Math.min(23, Number(match[1])), Math.min(59, Number(match[2]))]; };
  const [sh, sm] = hm(input.dayStart, "09:00");
  const [eh, em] = hm(input.dayEnd, "18:00");
  const now = input.now || new Date();
  const first = resolveDay(input.date, timezone, now);
  const last = addDays(first, days);
  const timeMin = zoned(first.year, first.month, first.day, 0, 0, timezone).toISOString();
  const timeMax = zoned(last.year, last.month, last.day, 0, 0, timezone).toISOString();
  const data = await client.request<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> }>(`${CAL}/freeBusy`, { method: "POST", body: JSON.stringify({ timeMin, timeMax, timeZone: timezone, items: [{ id: "primary" }] }) });
  const busy = (data.calendars?.primary?.busy || []).map((item) => [new Date(item.start).getTime(), new Date(item.end).getTime()] as const).sort((a, b) => a[0] - b[0]);
  const slots: Array<{ start: string; end: string; minutes: number; label: string }> = [];
  for (let index = 0; index < days; index += 1) {
    const day = addDays(first, index);
    let cursor = Math.max(zoned(day.year, day.month, day.day, sh, sm, timezone).getTime(), Math.ceil(now.getTime() / 900_000) * 900_000);
    const end = zoned(day.year, day.month, day.day, eh, em, timezone).getTime();
    const push = (from: number, to: number) => {
      const minutes = Math.round((to - from) / 60_000);
      if (minutes >= minMinutes) slots.push({ start: new Date(from).toISOString(), end: new Date(to).toISOString(), minutes, label: `${new Date(from).toLocaleDateString("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" })} ${localTime(new Date(from).toISOString(), timezone)}–${localTime(new Date(to).toISOString(), timezone)}` });
    };
    for (const [bStart, bEnd] of busy) {
      if (bEnd <= cursor || bStart >= end) continue;
      if (bStart > cursor) push(cursor, Math.min(bStart, end));
      cursor = Math.max(cursor, bEnd);
      if (cursor >= end) break;
    }
    if (cursor < end) push(cursor, end);
  }
  return { timezone, workingHours: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}–${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`, minMinutes, busyCount: busy.length, slots: slots.slice(0, 30) };
}

export async function calendarGet(client: GoogleClient, eventId: string) {
  return shapeEvent(await client.request<CalendarEvent>(`${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}`));
}

const when = (value: string, timezone?: string) => /T/.test(value) ? { dateTime: value, ...(timezone ? { timeZone: timezone } : {}) } : { date: value };

export async function calendarCreate(client: GoogleClient, input: { summary: string; start: string; end: string; timezone?: string; location?: string; description?: string; attendees?: string[] }) {
  if (!input.summary || !input.start || !input.end) throw new Error("An event needs a title, a start and an end.");
  if (/T/.test(input.start) && new Date(input.end).getTime() <= new Date(input.start).getTime()) throw new Error("The event ends before it starts.");
  const event = await client.request<CalendarEvent>(`${CAL}/calendars/primary/events?sendUpdates=${input.attendees?.length ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify({ summary: input.summary, location: input.location, description: input.description, start: when(input.start, input.timezone), end: when(input.end, input.timezone), attendees: input.attendees?.map((email) => ({ email })) }),
  });
  return { id: event.id, title: event.summary || input.summary, start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, link: event.htmlLink, invited: input.attendees || [] };
}

/** Moves (and optionally renames) an event; attendees are notified when there are any. */
export async function calendarMove(client: GoogleClient, input: { eventId: string; start: string; end?: string; timezone?: string; summary?: string; location?: string }) {
  const current = await client.request<CalendarEvent>(`${CAL}/calendars/primary/events/${encodeURIComponent(input.eventId)}`);
  let end = input.end;
  if (!end) {
    // Keep the original length when only a new start is given.
    const length = new Date(current.end?.dateTime || current.end?.date || 0).getTime() - new Date(current.start?.dateTime || current.start?.date || 0).getTime();
    end = new Date(new Date(input.start).getTime() + (length > 0 ? length : 3600_000)).toISOString();
  }
  if (/T/.test(input.start) && new Date(end).getTime() <= new Date(input.start).getTime()) throw new Error("The event would end before it starts.");
  const guests = (current.attendees || []).filter((item) => !item.self).length;
  const patch = { start: when(input.start, input.timezone), end: when(end, input.timezone), ...(input.summary ? { summary: input.summary } : {}), ...(input.location ? { location: input.location } : {}) };
  const event = await client.request<CalendarEvent>(`${CAL}/calendars/primary/events/${encodeURIComponent(input.eventId)}?sendUpdates=${guests ? "all" : "none"}`, { method: "PATCH", body: JSON.stringify(patch) });
  return { id: event.id, title: event.summary || current.summary, from: current.start?.dateTime || current.start?.date, start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, link: event.htmlLink, notified: guests };
}

export async function calendarDelete(client: GoogleClient, eventId: string) {
  await client.request(`${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  return { deleted: eventId };
}

/* ---------------- Drive (read-only, opt-in scope) ---------------- */

const DRIVE = "https://www.googleapis.com/drive/v3";
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string; size?: string; owners?: Array<{ displayName?: string }> };

async function requireDrive(client: GoogleClient) {
  if (!scopeFlags((await client.scopes()).join(" ")).drive) throw new GoogleReconnectError("missing_scope", "Google is connected without Drive access. Ask the user to reconnect Google and allow Drive (read-only).", "drive");
}

export async function driveSearch(client: GoogleClient, query: string, max = 10) {
  await requireDrive(client);
  const term = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = term ? `(name contains '${term}' or fullText contains '${term}') and trashed = false` : "trashed = false";
  const data = await client.request<{ files?: DriveFile[] }>(`${DRIVE}/files?${new URLSearchParams({ q, pageSize: String(Math.min(Math.max(1, max), 25)), orderBy: term ? "" : "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink,size,owners(displayName))", supportsAllDrives: "true", includeItemsFromAllDrives: "true" }).toString().replace(/orderBy=&/, "")}`);
  return (data.files || []).map((file) => ({ id: file.id, name: file.name, type: file.mimeType.replace("application/vnd.google-apps.", "google-"), modified: file.modifiedTime, link: file.webViewLink, owner: file.owners?.[0]?.displayName }));
}

const EXPORTS: Record<string, string> = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };

export async function driveRead(client: GoogleClient, fileId: string) {
  await requireDrive(client);
  const file = await client.request<DriveFile>(`${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,webViewLink,size&supportsAllDrives=true`);
  const base = { id: file.id, name: file.name, type: file.mimeType, modified: file.modifiedTime, link: file.webViewLink };
  let text: string | null = null;
  if (EXPORTS[file.mimeType]) text = await client.requestText(`${DRIVE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(EXPORTS[file.mimeType])}`);
  else if (/^text\/|json|csv|xml|markdown/.test(file.mimeType) && Number(file.size || 0) < 2_000_000) text = await client.requestText(`${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  if (text === null) return { ...base, text: null, note: "This file type can't be read as text here; share the link with the user." };
  return { ...base, text: text.slice(0, 12_000), truncated: text.length > 12_000 };
}
