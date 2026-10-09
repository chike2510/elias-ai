import { decrypt, encrypt, ready } from "@/lib/assistant/db";
import { needsReencrypt } from "@/lib/assistant/crypto";
import * as core from "@/lib/assistant/googleCore";
import { BASE_SCOPES, DRIVE_SCOPE, TESTING_REFRESH_DAYS, scopeFlags, type ConnectionStatus, type FetchLike, type GoogleClient, type TokenRecord, type TokenStore } from "@/lib/assistant/googleCore";

export { GoogleReconnectError, isReconnectError, reconnectText, DRIVE_SCOPE } from "@/lib/assistant/googleCore";
export const GOOGLE_SCOPES = BASE_SCOPES;

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** While the OAuth app is in Google's "Testing" status, refresh tokens die 7 days after consent. Set GOOGLE_OAUTH_PUBLISHED=1 once it's published. */
export function googleTestingMode() {
  return process.env.GOOGLE_OAUTH_PUBLISHED !== "1";
}

/* Tests swap in lib/assistant/googleMock.ts here. */
let fetchImpl: FetchLike | undefined;
export function setGoogleFetch(next: FetchLike | undefined) { fetchImpl = next; }
const gfetch: FetchLike = (url, init) => (fetchImpl || ((u, i) => fetch(u, i)))(url, init);

export function googleRedirectUri(request: Request) {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/api/connect/google/callback`;
}

export function googleAuthUrl(request: Request, state: string, extraScopes: string[] = []) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "", redirect_uri: googleRedirectUri(request), response_type: "code",
    scope: [...new Set([...GOOGLE_SCOPES, ...extraScopes])].join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/* v5 columns on elias_oauth_tokens (connected_at, status, last_error, extra_scopes) are created in ready() (lib/assistant/db.ts). */
const db = ready;

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };

/** Code → tokens. Both tokens are stored AES-256-GCM encrypted (ELIAS_ENCRYPTION_KEY); a reconnect clears any expired/revoked state. */
export async function exchangeGoogleCode(request: Request, code: string, userId: string) {
  const response = await gfetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: googleRedirectUri(request), grant_type: "authorization_code" }).toString(),
  });
  const data = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Google token exchange failed.");
  const profile = await gfetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${data.access_token}` } }).then((res) => res.json() as Promise<{ email?: string }>).catch(() => ({} as { email?: string }));
  const sql = await db();
  const expires = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  const refresh = data.refresh_token ? encrypt(data.refresh_token) : null;
  await sql`insert into public.elias_oauth_tokens (user_id, provider, email, scope, access_token, refresh_token, expires_at, connected_at, status, last_error)
    values (${userId}, 'google', ${profile.email || null}, ${data.scope || null}, ${encrypt(data.access_token)}, ${refresh}, ${expires}, now(), 'ok', null)
    on conflict (user_id, provider) do update set email = coalesce(excluded.email, public.elias_oauth_tokens.email), scope = excluded.scope, access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, public.elias_oauth_tokens.refresh_token), expires_at = excluded.expires_at,
    connected_at = case when excluded.refresh_token is not null then now() else public.elias_oauth_tokens.connected_at end,
    status = case when excluded.refresh_token is not null or public.elias_oauth_tokens.refresh_token is not null then 'ok' else public.elias_oauth_tokens.status end,
    last_error = null, updated_at = now()`;
  return { email: profile.email || null, scope: data.scope || "", refreshToken: Boolean(data.refresh_token) };
}

export type GoogleConnection = {
  email: string | null; scope: string | null; status: ConnectionStatus; connectedAt: string | null;
  /** When Google will drop the refresh token (testing mode only). */
  renewBy: string | null; expiresSoon: boolean; scopes: ReturnType<typeof scopeFlags>; driveRequested: boolean;
};

/** Null when there is no row. A row whose refresh token died is returned with status expired/revoked so the UI can offer a reconnect. */
export async function googleConnection(userId: string): Promise<GoogleConnection | null> {
  const sql = await db();
  const rows = await sql`select email, scope, status, connected_at, extra_scopes, refresh_token is not null as has_refresh from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
  const row = rows[0];
  if (!row) return null;
  const connectedAt = row.connected_at ? new Date(row.connected_at as string) : null;
  const renewBy = googleTestingMode() && connectedAt && row.has_refresh ? new Date(connectedAt.getTime() + TESTING_REFRESH_DAYS * 86400_000) : null;
  return {
    email: row.email as string | null, scope: row.scope as string | null, status: (row.status as ConnectionStatus) || "ok", connectedAt: connectedAt?.toISOString() || null,
    renewBy: renewBy?.toISOString() || null, expiresSoon: Boolean(renewBy && renewBy.getTime() - Date.now() < 36 * 3600_000),
    scopes: scopeFlags(row.scope as string | null), driveRequested: String(row.extra_scopes || "").includes(DRIVE_SCOPE),
  };
}

/** Scopes the user asked for beyond the base set (Drive), added on their next connect. */
export async function googleExtraScopes(userId: string) {
  const sql = await db();
  const rows = await sql`select extra_scopes from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
  return String(rows[0]?.extra_scopes || "").split(/\s+/).filter(Boolean);
}

export async function disconnectGoogle(userId: string) {
  const sql = await db();
  const rows = await sql`select access_token, refresh_token from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
  const row = rows[0];
  if (row) {
    // Revoke at Google too (best effort), so the grant doesn't linger in the user's Google account.
    try {
      const token = decrypt((row.refresh_token || row.access_token) as string);
      await gfetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(5000) } as RequestInit);
    } catch { /* already revoked or unreachable: deleting our copy is what matters */ }
  }
  await sql`delete from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
}

/** The Postgres token store: decrypts on load, encrypts on save, migrates plaintext/legacy rows on first read. */
export const dbTokenStore: TokenStore = {
  async load(userId) {
    const sql = await db();
    const rows = await sql`select * from public.elias_oauth_tokens where user_id = ${userId} and provider = 'google'`;
    const row = rows[0];
    if (!row) return null;
    if (needsReencrypt(row.access_token as string) || needsReencrypt(row.refresh_token as string | null)) {
      await sql`update public.elias_oauth_tokens set access_token = ${encrypt(decrypt(row.access_token as string))},
        refresh_token = ${row.refresh_token ? encrypt(decrypt(row.refresh_token as string)) : null} where user_id = ${userId} and provider = 'google'`.catch(() => undefined);
    }
    const record: TokenRecord = {
      email: row.email as string | null, scope: row.scope as string | null, accessToken: decrypt(row.access_token as string),
      refreshToken: row.refresh_token ? decrypt(row.refresh_token as string) : null, expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      connectedAt: row.connected_at ? new Date(row.connected_at as string) : null, status: (row.status as ConnectionStatus) || "ok", lastError: row.last_error as string | null,
      extraScopes: String(row.extra_scopes || "").split(/\s+/).filter(Boolean),
    };
    return record;
  },
  async saveAccess(userId, accessToken, expiresAt, refreshToken) {
    const sql = await db();
    await sql`update public.elias_oauth_tokens set access_token = ${encrypt(accessToken)}, expires_at = ${expiresAt},
      refresh_token = ${refreshToken ? encrypt(refreshToken) : sql`refresh_token`}, updated_at = now() where user_id = ${userId} and provider = 'google'`;
  },
  async markBroken(userId, status, error) {
    const sql = await db();
    await sql`update public.elias_oauth_tokens set status = ${status}, last_error = ${error.slice(0, 300)}, updated_at = now() where user_id = ${userId} and provider = 'google'`;
  },
  async wantScope(userId, scope) {
    const sql = await db();
    await sql`update public.elias_oauth_tokens set extra_scopes = trim(extra_scopes || ' ' || ${scope}) where user_id = ${userId} and provider = 'google' and position(${scope} in extra_scopes) = 0`;
  },
};

export function googleClient(userId: string): GoogleClient {
  return core.createGoogleClient({ userId, store: dbTokenStore, fetch: gfetch });
}

/* userId-based wrappers (the API the rest of the app uses). */
export const gmailSearch = (userId: string, query: string, max = 10) => core.gmailSearch(googleClient(userId), query, max);
export const gmailRead = (userId: string, id: string) => core.gmailRead(googleClient(userId), id);
export const gmailThread = (userId: string, threadId: string) => core.gmailThread(googleClient(userId), threadId);
export const gmailTriage = (userId: string, options: { days?: number; max?: number } = {}) => core.gmailTriage(googleClient(userId), options);
export const gmailDraft = (userId: string, input: core.EmailInput) => core.gmailDraft(googleClient(userId), input);
export const gmailDraftReply = (userId: string, input: { threadId?: string; messageId?: string; body: string; replyAll?: boolean }) => core.gmailDraftReply(googleClient(userId), input);
export const gmailSend = (userId: string, input: core.EmailInput & { draftId?: string }) => core.gmailSend(googleClient(userId), input);
export const calendarList = (userId: string, timeMin: string, timeMax: string) => core.calendarList(googleClient(userId), timeMin, timeMax);
export const calendarAgenda = (userId: string, input: { date?: string; days?: number; timezone: string }) => core.calendarAgenda(googleClient(userId), input);
export const calendarFreeTime = (userId: string, input: { date?: string; days?: number; timezone: string; dayStart?: string; dayEnd?: string; minMinutes?: number }) => core.calendarFreeTime(googleClient(userId), input);
export const calendarGet = (userId: string, eventId: string) => core.calendarGet(googleClient(userId), eventId);
export const calendarCreate = (userId: string, input: { summary: string; start: string; end: string; timezone?: string; location?: string; description?: string; attendees?: string[] }) => core.calendarCreate(googleClient(userId), input);
export const calendarMove = (userId: string, input: { eventId: string; start: string; end?: string; timezone?: string; summary?: string; location?: string }) => core.calendarMove(googleClient(userId), input);
export const calendarDelete = (userId: string, eventId: string) => core.calendarDelete(googleClient(userId), eventId);
export const driveSearch = (userId: string, query: string, max = 10) => core.driveSearch(googleClient(userId), query, max);
export const driveRead = (userId: string, fileId: string) => core.driveRead(googleClient(userId), fileId);
