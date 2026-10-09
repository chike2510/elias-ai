import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve("package.json"));
const ts = require("typescript");
const cache = new Map();

/** Transpiles a TS module; resolves relative and @/ imports to other TS files. */
function load(sourcePath) {
  if (cache.has(sourcePath)) return cache.get(sourcePath).exports;
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(sourcePath);
  loaded.filename = sourcePath;
  cache.set(sourcePath, loaded);
  loaded.require = (id) => {
    if (id.startsWith("@/")) return load(path.resolve(id.slice(2) + ".ts"));
    if (id.startsWith(".")) return load(path.resolve(path.dirname(sourcePath), id + ".ts"));
    return require(id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const core = load(path.resolve("lib/assistant/googleCore.ts"));
const { createMockGoogle } = load(path.resolve("lib/assistant/googleMock.ts"));
const cards = load(path.resolve("lib/assistant/cards.ts"));
const statusText = load(path.resolve("lib/googleStatusText.ts"));

const SELF = "me@example.com";
const DRIVE = "https://www.googleapis.com/auth/drive.readonly";

/** A token store in memory, with the same contract as the Postgres one (plaintext in and out). */
function memoryStore(record) {
  const state = { record: record ? { email: SELF, scope: "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 3600_000), connectedAt: new Date(), status: "ok", lastError: null, extraScopes: [], ...record } : null, broken: [], wanted: [] };
  return {
    state,
    async load() { return state.record ? { ...state.record } : null; },
    async saveAccess(_user, accessToken, expiresAt, refreshToken) { Object.assign(state.record, { accessToken, expiresAt, ...(refreshToken ? { refreshToken } : {}) }); },
    async markBroken(_user, status, error) { state.record.status = status; state.record.lastError = error; state.broken.push(status); },
    async wantScope(_user, scope) { state.wanted.push(scope); },
  };
}
const client = (store, mock) => core.createGoogleClient({ userId: "u1", store, fetch: mock.fetch, clientId: "cid", clientSecret: "csecret" });

test("expired access token is refreshed and saved before the call", async () => {
  const mock = createMockGoogle({ email: SELF, messages: [{ id: "m1", threadId: "t1", from: "Ada <ada@example.com>", to: SELF, subject: "Hi", body: "Lunch?" }] });
  const store = memoryStore({ accessToken: "stale", expiresAt: new Date(Date.now() - 1000) });
  const found = await core.gmailSearch(client(store, mock), "is:unread", 5);
  assert.equal(found.length, 1);
  assert.equal(mock.state.refreshes, 1);
  assert.equal(store.state.record.accessToken, "access-r1");
  const refreshCall = mock.state.calls.find((call) => call.url.includes("/token"));
  assert.match(refreshCall.body, /grant_type=refresh_token/);
  assert.match(refreshCall.body, /refresh_token=refresh-1/);
});

test("invalid_grant (7-day testing expiry) marks the connection expired and asks for a reconnect", async () => {
  const mock = createMockGoogle({ refresh: "invalid_grant" });
  const store = memoryStore({ expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(core.gmailSearch(client(store, mock), "x"), (error) => core.isReconnectError(error) && error.reason === "expired");
  assert.deepEqual(store.state.broken, ["expired"]);
  // Once broken, calls fail fast without touching Google.
  const before = mock.state.calls.length;
  await assert.rejects(core.calendarList(client(store, mock), "2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z"), (error) => core.isReconnectError(error) && error.reason === "expired");
  assert.equal(mock.state.calls.length, before);
});

test("a revoked grant is reported as revoked; Google being down is not a reconnect", async () => {
  const revoked = memoryStore({ expiresAt: new Date(0) });
  await assert.rejects(core.gmailSearch(client(revoked, createMockGoogle({ refresh: "revoked" })), "x"), (error) => error.reason === "revoked");
  const down = memoryStore({ expiresAt: new Date(0) });
  await assert.rejects(core.gmailSearch(client(down, createMockGoogle({ refresh: "down" })), "x"), (error) => !core.isReconnectError(error) && /try again/i.test(error.message));
  assert.equal(down.state.record.status, "ok");
});

test("401 before expiry refreshes once and retries; 401 after refresh is a revoke", async () => {
  const mock = createMockGoogle({ validTokens: [] });
  const store = memoryStore({ accessToken: "dead" });
  const events = await core.calendarList(client(store, mock), "2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z");
  assert.deepEqual(events, []);
  assert.equal(mock.state.refreshes, 1);
  const never = createMockGoogle({ validTokens: [] });
  never.fetch = ((inner) => async (url, init) => String(url).includes("/token") ? new Response(JSON.stringify({ access_token: "also-dead", expires_in: 3600 }), { status: 200 }) : inner(url, init))(never.fetch);
  const store2 = memoryStore({ accessToken: "dead" });
  await assert.rejects(core.calendarList(client(store2, never), "a", "b"), (error) => error.reason === "revoked");
  assert.deepEqual(store2.state.broken, ["revoked"]);
});

test("no row → not_connected reconnect error", async () => {
  await assert.rejects(core.gmailSearch(client(memoryStore(null), createMockGoogle()), "x"), (error) => error.reason === "not_connected");
});

test("inbox triage buckets: needs reply, money, updates, promotions", async () => {
  const mock = createMockGoogle({ email: SELF, messages: [
    { id: "a", threadId: "ta", from: "Ada Obi <ada@example.com>", to: SELF, subject: "Can you review the deck?", body: "Could you look before Friday?" },
    { id: "b", threadId: "tb", from: "Fidelity Bank <alerts@fidelity.example>", to: SELF, subject: "Debit alert", body: "NGN 5,000 debit" },
    { id: "c", threadId: "tc", from: "GitHub <notifications@github.com>", to: SELF, subject: "[repo] CI passed", body: "All good", listUnsubscribe: true, labels: ["INBOX", "UNREAD", "CATEGORY_UPDATES"] },
    { id: "d", threadId: "td", from: "Shop <deals@shop.example>", to: SELF, subject: "50% off", body: "Sale", labels: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"] },
    { id: "e", threadId: "te", from: "Old <old@example.com>", to: SELF, subject: "Read already", body: "x", labels: ["INBOX"] },
  ] });
  const triage = await core.gmailTriage(client(memoryStore({ email: SELF }), mock), { days: 2 });
  assert.equal(triage.scanned, 4);
  assert.deepEqual(triage.needsReply.map((item) => [item.id, item.why]), [["a", "asks you something"]]);
  assert.deepEqual(triage.money.map((item) => item.id), ["b"]);
  assert.equal(triage.updates.count, 1);
  assert.equal(triage.promotions.count, 1);
  assert.match(triage.summary, /4 unread.*1 may need a reply.*1 about money.*1 updates.*1 promotions/);
  const card = cards.googleCardFor("gmail_triage", triage);
  assert.equal(card.kind, "emails");
  assert.deepEqual(card.items.map((item) => item.id), ["a", "b"]);
});

test("draft reply threads correctly; send from draft; header injection is neutralised", async () => {
  const mock = createMockGoogle({ email: SELF, messages: [
    { id: "m1", threadId: "t1", from: "Ada <ada@example.com>", to: `${SELF}, Bo <bo@example.com>`, cc: "cy@example.com", subject: "Plans", body: "Friday?", messageId: "<m1@x>" },
  ] });
  const c = client(memoryStore({ email: SELF }), mock);
  const draft = await core.gmailDraftReply(c, { threadId: "t1", body: "Friday works.", replyAll: true });
  assert.equal(draft.to, "Ada <ada@example.com>");
  assert.equal(draft.subject, "Re: Plans");
  assert.equal(draft.inReplyTo, "<m1@x>");
  assert.match(draft.cc, /bo@example\.com/);
  assert.match(draft.cc, /cy@example\.com/);
  assert.doesNotMatch(draft.cc, /me@example\.com/);
  assert.equal(mock.state.sent.length, 0, "drafting never sends");
  await core.gmailSend(c, { to: draft.to, subject: draft.subject, body: draft.body, threadId: draft.threadId, inReplyTo: draft.inReplyTo, references: draft.references, draftId: draft.draftId });
  assert.equal(mock.state.sent.length, 1);
  assert.match(mock.state.sent[0].decoded, /In-Reply-To: <m1@x>/);
  assert.equal(mock.state.drafts.size, 0);
  const raw = Buffer.from(core.rawEmail({ to: "a@b.co", subject: "Hi\r\nBcc: evil@x.com", body: "x" }), "base64url").toString("utf8");
  assert.doesNotMatch(raw, /\r\nBcc:/);
  assert.match(Buffer.from(core.rawEmail({ to: "a@b.co", subject: "Ẹ káàrọ̀", body: "x" }), "base64url").toString("utf8"), /Subject: =\?UTF-8\?B\?/);
  await assert.rejects(core.gmailSend(c, { to: "not an address", subject: "x", body: "y" }), /valid recipient/);
});

test("agenda groups by the user's day; free time skips busy blocks; move keeps the length", async () => {
  const mock = createMockGoogle({ events: [
    { id: "e1", summary: "Standup", start: "2026-10-09T09:00:00+01:00", end: "2026-10-09T09:30:00+01:00" },
    { id: "e2", summary: "Late call", start: "2026-10-09T23:30:00+01:00", end: "2026-10-10T00:15:00+01:00", attendees: ["ada@example.com"] },
    { id: "e3", summary: "Lunch", start: "2026-10-10T12:00:00+01:00", end: "2026-10-10T13:00:00+01:00" },
  ] });
  const c = client(memoryStore({}), mock);
  const now = new Date("2026-10-09T06:00:00Z");
  const agenda = await core.calendarAgenda(c, { date: "today", days: 2, timezone: "Africa/Lagos", now });
  assert.deepEqual(agenda.days.map((day) => day.events.map((event) => event.title)), [["Standup", "Late call"], ["Lunch"]]);
  assert.equal(agenda.days[0].events[0].time, "09:00–09:30");
  const free = await core.calendarFreeTime(c, { date: "2026-10-09", timezone: "Africa/Lagos", now, minMinutes: 30 });
  assert.deepEqual(free.slots.map((slot) => [slot.start, slot.end]), [["2026-10-09T08:30:00.000Z", "2026-10-09T17:00:00.000Z"]]);
  const created = await core.calendarCreate(c, { summary: "Focus", start: "2026-10-10T15:00:00+01:00", end: "2026-10-10T16:00:00+01:00", timezone: "Africa/Lagos" });
  assert.equal(created.title, "Focus");
  assert.match(mock.state.calls.at(-1).url, /sendUpdates=none/);
  const moved = await core.calendarMove(c, { eventId: "e2", start: "2026-10-10T18:00:00+01:00", timezone: "Africa/Lagos" });
  assert.equal(new Date(moved.end).getTime() - new Date(moved.start).getTime(), 45 * 60_000);
  assert.equal(moved.notified, 1);
  assert.match(mock.state.calls.at(-1).url, /sendUpdates=all/);
  await assert.rejects(core.calendarCreate(c, { summary: "Bad", start: "2026-10-10T16:00:00+01:00", end: "2026-10-10T15:00:00+01:00" }), /ends before/);
  const agendaCard = cards.googleCardFor("calendar_agenda", agenda);
  assert.equal(agendaCard.kind, "events");
  assert.equal(agendaCard.items.length, 3);
});

test("Drive: without the scope it asks to reconnect (and remembers to request Drive); with it, reads a Doc", async () => {
  const files = [{ id: "f1", name: "Budget 2026", mimeType: "application/vnd.google-apps.document", text: "Rent 500k" }];
  const store = memoryStore({});
  await assert.rejects(core.driveSearch(client(store, createMockGoogle({ files })), "budget"), (error) => error.reason === "missing_scope" && error.scope === "drive");
  const scope = `openid email ${DRIVE}`;
  const withDrive = memoryStore({ scope });
  const mock = createMockGoogle({ files, scope });
  const hits = await core.driveSearch(client(withDrive, mock), "budget");
  assert.deepEqual(hits.map((hit) => hit.name), ["Budget 2026"]);
  const doc = await core.driveRead(client(withDrive, mock), "f1");
  assert.equal(doc.text, "Rent 500k");
  assert.match(mock.state.calls.at(-1).url, /export\?mimeType=text%2Fplain/);
  // The token has the scope but Google's 403 says it's insufficient: remember to ask for Drive on the next connect.
  const stale = memoryStore({ scope });
  await assert.rejects(core.driveSearch(client(stale, createMockGoogle({ files })), "budget"), (error) => error.reason === "missing_scope");
  assert.deepEqual(stale.state.wanted, [DRIVE]);
  await assert.rejects(core.driveSearch(client(memoryStore({ scope }), createMockGoogle({ files, scope, disabledApi: "drive" })), "budget"), /Google Drive API isn't enabled/);
  assert.equal(cards.googleCardFor("drive_search", hits).kind, "links");
});

test("reconnect copy and the You/Connectors row states", () => {
  assert.match(core.reconnectText("expired"), /every 7 days.*Reconnect Google button/);
  const base = { configured: true, connected: true, email: SELF, status: "ok", renewBy: "2026-10-15T10:00:00Z", expiresSoon: false, drive: false, testing: true };
  assert.equal(statusText.googleRowView(base, "/you").state, "on");
  assert.match(statusText.googleRowView(base, "/you", "Africa/Lagos").detail, /Gmail & Calendar · me@example.com · renew by Thu,? 15 Oct/);
  const soon = statusText.googleRowView({ ...base, expiresSoon: true }, "/you");
  assert.deepEqual([soon.state, soon.action], ["warn", "Reconnect"]);
  const expired = statusText.googleRowView({ ...base, connected: false, status: "expired" }, "/you");
  assert.deepEqual([expired.state, expired.action, expired.href], ["warn", "Reconnect", "/api/connect/google?return=%2Fyou"]);
  assert.equal(statusText.googleRowView({ ...base, connected: false, status: "none" }, "/you").action, "Connect");
  assert.equal(statusText.googleRowView({ configured: false, connected: false, email: null }, "/you").state, "na");
  assert.equal(statusText.googleReturnMessage("?connected=google").tone, "ok");
  assert.match(statusText.googleReturnMessage("?connected=google&missing=calendar").text, /without Calendar/);
  assert.match(statusText.googleReturnMessage("?error=google_cancelled").text, /cancelled/);
  assert.equal(statusText.googleReturnMessage("?tab=1"), null);
});

test("approval: calendar_move gets event details; calendar_create/move/gmail_send always need approval", () => {
  const details = cards.googleApprovalDetails("calendar_move", { event_id: "e2", start: "2026-10-10T18:00:00+01:00" }, 'Move "Late call" from x to y\nGuests notified: ada@example.com');
  assert.deepEqual([details.kind, details.title, details.guests], ["event", "Late call", ["ada@example.com"]]);
  const tools = readFileSync(path.resolve("lib/assistant/tools.ts"), "utf8");
  for (const name of ["calendar_create", "calendar_move", "gmail_send", "calendar_delete"]) {
    const block = tools.slice(tools.indexOf(`  ${name}: {`), tools.indexOf("run:", tools.indexOf(`  ${name}: {`)));
    assert.match(block, /needsApproval: (async )?\(args(, ctx)?\) => [`{]/, `${name} always asks`);
  }
});
