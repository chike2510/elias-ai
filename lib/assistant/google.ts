import { decrypt, encrypt, ready } from "@/lib/assistant/db";

export const GOOGLE_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(request: Request) {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/api/connect/google/callback`;
}

export function googleAuthUrl(request: Request, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "", redirect_uri: googleRedirectUri(request), response_type: "code",
    scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };

export async function exchangeGoogleCode(request: Request, code: string, userId: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: googleRedirectUri(request), grant_type: "authorization_code" }),
  });
  const data = await response.json() as TokenResponse;
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Google token exchange failed.");
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${data.access_token}` } }).then((res) => res.json() as Promise<{ email?: string }>).catch(() => ({} as { email?: string }));
  const db = await ready();
  const expires = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  const refresh = data.refresh_token ? encrypt(data.refresh_token) : null;
  await db`insert into public.elias_oauth_tokens (user_id, provider, email, scope, access_token, refresh_token, expires_at)
    values (${userId}, 'google', ${profile.email || null}, ${data.scope || null}, ${encrypt(data.access_token)}, ${refresh}, ${expires})
    on conflict (user_id, provider) do update set email = excluded.email, scope = excluded.scope, access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, public.elias_oauth_tokens.refresh_token), expires_at = excluded.expires_at, updated_at = now()`;
  return profile.email || null;
}

export async function googleConnection(userId: string) {
  const db = await ready();
  const rows = await db`select email, scope, updated_at from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
  return rows[0] ? { email: rows[0].email as string | null, scope: rows[0].scope as string | null } : null;
}

export async function disconnectGoogle(userId: string) {
  const db = await ready();
  await db`delete from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
}

async function accessToken(userId: string) {
  const db = await ready();
  const rows = await db`select * from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
  const record = rows[0];
  if (!record) throw new Error("Google is not connected. Ask the user to connect Google in Elias (Connectors > Google).");
  if (new Date(record.expires_at as string).getTime() > Date.now() + 60_000) return decrypt(record.access_token as string);
  if (!record.refresh_token) throw new Error("Google access expired. Ask the user to reconnect Google.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: decrypt(record.refresh_token as string), grant_type: "refresh_token" }),
  });
  const data = await response.json() as TokenResponse;
  if (!response.ok || !data.access_token) throw new Error("Google access could not be refreshed. Ask the user to reconnect Google.");
  await db`update public.elias_oauth_tokens set access_token = ${encrypt(data.access_token)}, expires_at = ${new Date(Date.now() + (data.expires_in || 3600) * 1000)}, updated_at = now() where user_id = ${userId} and provider = 'google'`;
  return data.access_token;
}

async function google<T>(userId: string, url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(userId);
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google API ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: GmailHeader[] };
type GmailMessage = { id: string; threadId: string; snippet?: string; labelIds?: string[]; payload?: GmailPart };

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function bodyText(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts || []) { const text = bodyText(child); if (text) return text; }
  if (part.mimeType === "text/html" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return "";
}

export async function gmailSearch(userId: string, query: string, max = 10) {
  const list = await google<{ messages?: Array<{ id: string }> }>(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(max, 25)) })}`);
  const messages = await Promise.all((list.messages || []).map((item) => google<GmailMessage>(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
  return messages.map((message) => ({ id: message.id, threadId: message.threadId, from: header(message, "From"), subject: header(message, "Subject"), date: header(message, "Date"), snippet: message.snippet, unread: message.labelIds?.includes("UNREAD") }));
}

export async function gmailRead(userId: string, id: string) {
  const message = await google<GmailMessage>(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  return { id: message.id, threadId: message.threadId, from: header(message, "From"), to: header(message, "To"), cc: header(message, "Cc"), subject: header(message, "Subject"), date: header(message, "Date"), messageId: header(message, "Message-ID"), body: bodyText(message.payload).slice(0, 12_000) };
}

function rawEmail(input: { to: string; subject: string; body: string; cc?: string; inReplyTo?: string }) {
  const lines = [`To: ${input.to}`, ...(input.cc ? [`Cc: ${input.cc}`] : []), `Subject: ${input.subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8",
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : []), "", input.body];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function gmailDraft(userId: string, input: { to: string; subject: string; body: string; cc?: string; threadId?: string; inReplyTo?: string }) {
  const draft = await google<{ id: string }>(userId, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: JSON.stringify({ message: { raw: rawEmail(input), ...(input.threadId ? { threadId: input.threadId } : {}) } }) });
  return { draftId: draft.id };
}

export async function gmailSend(userId: string, input: { to: string; subject: string; body: string; cc?: string; threadId?: string; inReplyTo?: string }) {
  const sent = await google<{ id: string }>(userId, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: rawEmail(input), ...(input.threadId ? { threadId: input.threadId } : {}) }) });
  return { messageId: sent.id };
}

type CalendarEvent = { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; attendees?: Array<{ email: string; responseStatus?: string }>; htmlLink?: string; hangoutLink?: string };

export async function calendarList(userId: string, timeMin: string, timeMax: string) {
  const data = await google<{ items?: CalendarEvent[] }>(userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" })}`);
  return (data.items || []).map((event) => ({ id: event.id, title: event.summary, start: event.start?.dateTime || event.start?.date, end: event.end?.dateTime || event.end?.date, location: event.location, attendees: event.attendees?.map((item) => item.email), link: event.hangoutLink || event.htmlLink }));
}

export async function calendarCreate(userId: string, input: { summary: string; start: string; end: string; timezone?: string; location?: string; description?: string; attendees?: string[] }) {
  const event = await google<CalendarEvent>(userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${input.attendees?.length ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify({ summary: input.summary, location: input.location, description: input.description, start: { dateTime: input.start, timeZone: input.timezone }, end: { dateTime: input.end, timeZone: input.timezone }, attendees: input.attendees?.map((email) => ({ email })) }),
  });
  return { id: event.id, link: event.htmlLink };
}

export async function calendarDelete(userId: string, eventId: string) {
  await google(userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  return { deleted: eventId };
}
