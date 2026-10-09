/**
 * In-memory Google (OAuth token endpoint, userinfo, revoke, Gmail, Calendar, Drive) for tests and evals.
 * Plug it in with setGoogleFetch(mock.fetch) (lib/assistant/google.ts) or createGoogleClient({ fetch: mock.fetch }).
 * Only the endpoints Elias calls are implemented; anything else is a 404 so a test notices.
 */
import type { FetchLike } from "@/lib/assistant/googleCore";

export type MockMessage = {
  id: string; threadId: string; from: string; to: string; cc?: string; subject: string; date?: string; body: string; snippet?: string;
  labels?: string[]; messageId?: string; references?: string; replyTo?: string; listUnsubscribe?: boolean;
};
export type MockEvent = { id: string; summary: string; start: string; end: string; location?: string; attendees?: string[]; status?: string };
export type MockFile = { id: string; name: string; mimeType: string; text: string; modifiedTime?: string };
export type MockGoogleOptions = {
  email?: string; scope?: string; messages?: MockMessage[]; events?: MockEvent[]; files?: MockFile[];
  /** What the token endpoint does for a refresh_token grant: issue a new access token, or fail like Google does after 7 days in testing mode. */
  refresh?: "ok" | "invalid_grant" | "revoked" | "down";
  /** Access tokens the APIs accept; refreshes add to it. */
  validTokens?: string[];
  /** Token returned by the authorization_code exchange. */
  codeTokens?: { access: string; refresh?: string; scope?: string };
  /** Return 403 accessNotConfigured for this API, like a project where it isn't enabled. */
  disabledApi?: "drive" | "gmail" | "calendar";
};
export type MockCall = { method: string; url: string; body?: string };

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function createMockGoogle(options: MockGoogleOptions = {}) {
  const state = {
    email: options.email || "user@example.com",
    scope: options.scope ?? "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    refresh: options.refresh || "ok",
    disabledApi: options.disabledApi,
    messages: [...(options.messages || [])],
    events: [...(options.events || [])],
    files: [...(options.files || [])],
    drafts: new Map<string, { raw: string; threadId?: string }>(),
    sent: [] as Array<{ raw: string; threadId?: string; decoded: string }>,
    valid: new Set(options.validTokens || ["access-1"]),
    revoked: [] as string[],
    calls: [] as MockCall[],
    refreshes: 0,
    counter: 0,
  };
  const nextId = (prefix: string) => `${prefix}${++state.counter}`;

  const headersOf = (message: MockMessage, only?: string[]) => {
    const all = [
      { name: "From", value: message.from }, { name: "To", value: message.to }, ...(message.cc ? [{ name: "Cc", value: message.cc }] : []),
      { name: "Subject", value: message.subject }, { name: "Date", value: message.date || "Fri, 9 Oct 2026 08:00:00 +0100" },
      { name: "Message-ID", value: message.messageId || `<${message.id}@mail.example.com>` },
      ...(message.references ? [{ name: "References", value: message.references }] : []), ...(message.replyTo ? [{ name: "Reply-To", value: message.replyTo }] : []),
      ...(message.listUnsubscribe ? [{ name: "List-Unsubscribe", value: "<mailto:unsub@example.com>" }] : []),
    ];
    return only?.length ? all.filter((item) => only.some((name) => name.toLowerCase() === item.name.toLowerCase())) : all;
  };
  const gmailMessage = (message: MockMessage, format: string, only?: string[]) => ({
    id: message.id, threadId: message.threadId, snippet: message.snippet ?? message.body.slice(0, 100), labelIds: message.labels || ["INBOX", "UNREAD"],
    payload: format === "metadata" ? { headers: headersOf(message, only) } : { mimeType: "multipart/alternative", headers: headersOf(message), parts: [{ mimeType: "text/plain", body: { data: b64(message.body) } }] },
  });
  const shapeEvent = (event: MockEvent) => ({
    id: event.id, status: event.status || "confirmed", summary: event.summary, location: event.location, htmlLink: `https://calendar.google.com/event?eid=${event.id}`,
    start: event.start.includes("T") ? { dateTime: event.start } : { date: event.start }, end: event.end.includes("T") ? { dateTime: event.end } : { date: event.end },
    attendees: event.attendees?.length ? [{ email: state.email, self: true, responseStatus: "accepted" }, ...event.attendees.map((email) => ({ email, responseStatus: "needsAction" }))] : undefined,
  });
  /** Gmail query subset: in:inbox, is:unread, is:important, from:x, subject:x, newer_than (ignored), free words. */
  const matches = (message: MockMessage, query: string) => query.split(/\s+/).filter(Boolean).every((term) => {
    const labels = message.labels || ["INBOX", "UNREAD"];
    if (term === "in:inbox") return labels.includes("INBOX");
    if (term === "is:unread") return labels.includes("UNREAD");
    if (term === "is:important") return labels.includes("IMPORTANT");
    if (term.startsWith("newer_than:")) return true;
    if (term.startsWith("from:")) return message.from.toLowerCase().includes(term.slice(5).toLowerCase());
    if (term.startsWith("subject:")) return message.subject.toLowerCase().includes(term.slice(8).toLowerCase());
    return `${message.subject} ${message.body} ${message.from}`.toLowerCase().includes(term.toLowerCase());
  });

  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : init.body ? String(init.body) : undefined;
    state.calls.push({ method, url: url.toString(), body });
    const path = url.pathname;

    if (url.host === "oauth2.googleapis.com" && path === "/token") {
      const form = new URLSearchParams(body || "");
      if (form.get("grant_type") === "authorization_code") {
        const tokens = options.codeTokens || { access: "access-code", refresh: "refresh-secret-1" };
        state.valid.add(tokens.access);
        if (tokens.scope) state.scope = tokens.scope;
        return json(200, { access_token: tokens.access, refresh_token: tokens.refresh, expires_in: 3599, scope: state.scope, token_type: "Bearer" });
      }
      state.refreshes += 1;
      if (state.refresh === "down") return json(503, { error: "backend_error" });
      if (state.refresh === "invalid_grant") return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      if (state.refresh === "revoked") return json(400, { error: "invalid_grant", error_description: "Token has been revoked." });
      const access = `access-r${state.refreshes}`;
      state.valid.add(access);
      return json(200, { access_token: access, expires_in: 3599, scope: state.scope, token_type: "Bearer" });
    }
    if (url.host === "oauth2.googleapis.com" && path === "/revoke") { state.revoked.push(new URLSearchParams(body || "").get("token") || ""); return json(200, {}); }

    const auth = new Headers(init.headers).get("authorization") || "";
    if (!state.valid.has(auth.replace(/^Bearer /, ""))) return json(401, { error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } });
    if (url.host === "openidconnect.googleapis.com") return json(200, { email: state.email, email_verified: true });

    const api = url.host === "gmail.googleapis.com" ? "gmail" : path.startsWith("/calendar/") ? "calendar" : path.startsWith("/drive/") ? "drive" : "";
    if (api && api === state.disabledApi) return json(403, { error: { code: 403, message: `${api} API has not been used in project 1 before or it is disabled.`, errors: [{ reason: "accessNotConfigured" }], status: "PERMISSION_DENIED" } });
    if (api === "drive" && !state.scope.includes("drive")) return json(403, { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }], status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } });

    /* Gmail */
    const gmail = path.match(/^\/gmail\/v1\/users\/me\/(.*)$/)?.[1];
    if (url.host === "gmail.googleapis.com" && gmail !== undefined) {
      const only = url.searchParams.getAll("metadataHeaders");
      const format = url.searchParams.get("format") || "full";
      if (gmail === "messages" && method === "GET") {
        const hits = state.messages.filter((message) => matches(message, url.searchParams.get("q") || ""));
        const max = Number(url.searchParams.get("maxResults") || 100);
        return json(200, { messages: hits.slice(0, max).map((message) => ({ id: message.id, threadId: message.threadId })), resultSizeEstimate: hits.length });
      }
      const one = gmail.match(/^messages\/([^/]+)$/);
      if (one && method === "GET") { const message = state.messages.find((item) => item.id === decodeURIComponent(one[1])); return message ? json(200, gmailMessage(message, format, only)) : json(404, { error: { code: 404, message: "Not Found" } }); }
      const thread = gmail.match(/^threads\/([^/]+)$/);
      if (thread && method === "GET") {
        const items = state.messages.filter((item) => item.threadId === decodeURIComponent(thread[1]));
        return items.length ? json(200, { id: decodeURIComponent(thread[1]), messages: items.map((item) => gmailMessage(item, format, only)) }) : json(404, { error: { code: 404, message: "Not Found" } });
      }
      if (gmail === "drafts" && method === "POST") { const data = JSON.parse(body || "{}"); const id = nextId("draft"); state.drafts.set(id, data.message); return json(200, { id, message: { id: nextId("m"), threadId: data.message?.threadId || nextId("t") } }); }
      const draft = gmail.match(/^drafts\/([^/]+)$/);
      if (draft && method === "PUT") { const data = JSON.parse(body || "{}"); state.drafts.set(decodeURIComponent(draft[1]), data.message); return json(200, { id: decodeURIComponent(draft[1]) }); }
      if (gmail === "drafts/send" && method === "POST") {
        const id = JSON.parse(body || "{}").id as string;
        const message = state.drafts.get(id);
        if (!message) return json(404, { error: { code: 404, message: "Draft not found" } });
        state.drafts.delete(id);
        state.sent.push({ ...message, decoded: Buffer.from(message.raw, "base64url").toString("utf8") });
        return json(200, { id: nextId("sent"), threadId: message.threadId || nextId("t") });
      }
      if (gmail === "messages/send" && method === "POST") {
        const data = JSON.parse(body || "{}");
        state.sent.push({ raw: data.raw, threadId: data.threadId, decoded: Buffer.from(data.raw, "base64url").toString("utf8") });
        return json(200, { id: nextId("sent"), threadId: data.threadId || nextId("t") });
      }
    }

    /* Calendar */
    if (path === "/calendar/v3/calendars/primary/events" && method === "GET") {
      const from = new Date(url.searchParams.get("timeMin") || 0).getTime();
      const to = new Date(url.searchParams.get("timeMax") || "2100-01-01").getTime();
      const items = state.events.filter((event) => new Date(event.end).getTime() > from && new Date(event.start).getTime() < to).sort((a, b) => a.start.localeCompare(b.start));
      return json(200, { items: items.map(shapeEvent) });
    }
    if (path === "/calendar/v3/calendars/primary/events" && method === "POST") {
      const data = JSON.parse(body || "{}");
      const event: MockEvent = { id: nextId("ev"), summary: data.summary, start: data.start.dateTime || data.start.date, end: data.end.dateTime || data.end.date, location: data.location, attendees: data.attendees?.map((item: { email: string }) => item.email) };
      state.events.push(event);
      return json(200, shapeEvent(event));
    }
    const ev = path.match(/^\/calendar\/v3\/calendars\/primary\/events\/([^/]+)$/);
    if (ev) {
      const index = state.events.findIndex((item) => item.id === decodeURIComponent(ev[1]));
      if (index < 0) return json(404, { error: { code: 404, message: "Not Found" } });
      if (method === "GET") return json(200, shapeEvent(state.events[index]));
      if (method === "DELETE") { state.events.splice(index, 1); return new Response(null, { status: 204 }); }
      if (method === "PATCH") {
        const data = JSON.parse(body || "{}");
        const event = state.events[index];
        state.events[index] = { ...event, ...(data.summary ? { summary: data.summary } : {}), ...(data.location ? { location: data.location } : {}), ...(data.start ? { start: data.start.dateTime || data.start.date } : {}), ...(data.end ? { end: data.end.dateTime || data.end.date } : {}) };
        return json(200, shapeEvent(state.events[index]));
      }
    }
    if (path === "/calendar/v3/freeBusy" && method === "POST") {
      const data = JSON.parse(body || "{}");
      const from = new Date(data.timeMin).getTime();
      const to = new Date(data.timeMax).getTime();
      const busy = state.events.filter((event) => event.start.includes("T") && new Date(event.end).getTime() > from && new Date(event.start).getTime() < to).map((event) => ({ start: event.start, end: event.end }));
      return json(200, { calendars: { primary: { busy } } });
    }

    /* Drive */
    if (path === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") || "";
      const term = q.match(/name contains '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, "$1").toLowerCase() || "";
      const hits = state.files.filter((file) => !term || file.name.toLowerCase().includes(term) || file.text.toLowerCase().includes(term));
      return json(200, { files: hits.map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime || "2026-10-01T10:00:00.000Z", webViewLink: `https://docs.google.com/d/${file.id}`, size: String(file.text.length), owners: [{ displayName: "Me" }] })) });
    }
    const file = path.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/);
    if (file && method === "GET") {
      const hit = state.files.find((item) => item.id === decodeURIComponent(file[1]));
      if (!hit) return json(404, { error: { code: 404, message: "File not found" } });
      if (file[2] || url.searchParams.get("alt") === "media") return new Response(hit.text, { status: 200, headers: { "content-type": "text/plain" } });
      return json(200, { id: hit.id, name: hit.name, mimeType: hit.mimeType, modifiedTime: hit.modifiedTime || "2026-10-01T10:00:00.000Z", webViewLink: `https://docs.google.com/d/${hit.id}`, size: String(hit.text.length) });
    }
    return json(404, { error: { code: 404, message: `mock google: no route for ${method} ${url.host}${path}` } });
  };

  return { state, fetch };
}
