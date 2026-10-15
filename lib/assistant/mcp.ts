import { createHash, randomBytes } from "node:crypto";
import { decrypt, encrypt, newId, ready } from "@/lib/assistant/db";

/**
 * Remote MCP servers (streamable HTTP) the user connected to Elias. Keys and OAuth tokens are encrypted at rest and
 * never shown to the model; the model calls tools through mcp_call with a server id.
 */

export type McpPreset = {
  id: string; name: string; url: string; adds: string;
  auth: "none" | "key" | "oauth" | "unsupported";
  keyLabel?: string; keyHelp?: string; keyUrl?: string; optionalKey?: boolean;
  /** How the key is sent. */
  keyStyle?: "bearer" | "query";
  queryParam?: string;
  note?: string;
};

export const MCP_PRESETS: McpPreset[] = [
  { id: "football-charts", name: "Football Charts", url: "https://mcp.football-charts.com/mcp", adds: "93 leagues: fixtures, results, tables, model match probabilities", auth: "none", note: "Free for personal use; credit football-charts.com. No bookmaker odds." },
  { id: "tavily", name: "Tavily", url: "https://mcp.tavily.com/mcp/", adds: "Web search and page extraction (news, injuries, research)", auth: "key", keyLabel: "Tavily API key", keyUrl: "https://app.tavily.com", keyHelp: "Free: 1,000 credits a month, no card.", keyStyle: "query", queryParam: "tavilyApiKey" },
  { id: "apifootball", name: "APIfootball", url: "https://mcp.apifootball.com/mcp", adds: "Bookmaker odds (1X2, BTTS, O/U, Asian handicap), H2H, standings, live scores", auth: "key", keyLabel: "APIfootball API key", keyUrl: "https://apifootball.com/pricing/", keyHelp: "Free plan covers England Championship and France Ligue 2 only.", keyStyle: "bearer" },
  { id: "supabase", name: "Supabase", url: "https://mcp.supabase.com/mcp?read_only=true", adds: "Read-only SQL, logs and schema for your Supabase projects", auth: "key", keyLabel: "Supabase personal access token", keyUrl: "https://supabase.com/dashboard/account/tokens", keyHelp: "Connected read-only on purpose.", keyStyle: "bearer" },
  { id: "transcriptor", name: "Transcriptor", url: "https://transcriptor.gateway.mcpal.io/mcp", adds: "Transcripts, subtitles, chapters and frames from YouTube, TikTok, Instagram and 8 more", auth: "oauth" },
  { id: "kinopipe", name: "KinoPipe", url: "https://kinopipe.com/mcp", adds: "Hosted FFmpeg editing: trim, 9:16, subtitles, watermarks", auth: "oauth", note: "Free plan is a one-time 100 credits (about 10 edits)." },
  { id: "youtube", name: "YouTube (mcp-youtube)", url: "", adds: "Upload, captions, thumbnails", auth: "unsupported", note: "Local-only server, can't run on Vercel. Elias needs a direct YouTube upload connector instead (planned)." },
];

export type McpServer = { id: string; name: string; url: string; preset: string | null; status: string; authKind: string; toolCount: number; updatedAt: string };

let schema: Promise<void> | null = null;
async function db() {
  const sql = await ready();
  schema ||= (async () => {
    await sql`create table if not exists public.elias_mcp_servers (
      id text primary key, user_id text not null, name text not null, url text not null, preset text,
      auth_kind text not null default 'none', secret_enc text, oauth_enc text, status text not null default 'ok',
      tools jsonb not null default '[]'::jsonb, last_error text, updated_at timestamptz not null default now())`;
    await sql`create index if not exists elias_mcp_servers_user_idx on public.elias_mcp_servers(user_id)`;
    await sql`create table if not exists public.elias_mcp_oauth_states (
      state text primary key, user_id text not null, server_id text not null, verifier text not null, redirect_uri text not null,
      created_at timestamptz not null default now())`;
    for (const table of ["elias_mcp_servers", "elias_mcp_oauth_states"]) await sql.unsafe(`alter table public.${table} enable row level security`).catch(() => undefined);
  })().catch((error) => { schema = null; throw error; });
  await schema;
  return sql;
}

type Row = Record<string, unknown>;
type OAuthState = { clientId: string; clientSecret?: string; tokenEndpoint: string; accessToken?: string; refreshToken?: string; expiresAt?: number };
type ToolInfo = { name: string; description?: string; inputSchema?: Record<string, unknown> };

const toServer = (row: Row): McpServer => ({ id: String(row.id), name: String(row.name), url: String(row.url), preset: (row.preset as string) || null, status: String(row.status), authKind: String(row.auth_kind), toolCount: Array.isArray(row.tools) ? row.tools.length : 0, updatedAt: new Date(row.updated_at as string).toISOString() });

export async function listServers(userId: string) {
  const sql = await db();
  return (await sql`select * from public.elias_mcp_servers where user_id = ${userId} order by name`).map(toServer);
}

async function getRow(userId: string, idOrName: string) {
  const sql = await db();
  const row = (await sql`select * from public.elias_mcp_servers where user_id = ${userId} and (id = ${idOrName} or lower(name) = lower(${idOrName}) or preset = ${idOrName}) limit 1`)[0];
  if (!row) throw new Error(`No connected MCP server "${idOrName}". Call mcp_servers to see what's connected.`);
  return row;
}

export async function removeServer(userId: string, id: string) {
  const sql = await db();
  return (await sql`delete from public.elias_mcp_servers where user_id = ${userId} and id = ${id} returning id`).length > 0;
}

/** Adds (or replaces) a server. Returns its id; OAuth servers come back with status "needs_auth". */
export async function addServer(userId: string, input: { preset?: string; url?: string; name?: string; key?: string }) {
  const preset = MCP_PRESETS.find((item) => item.id === input.preset);
  if (preset?.auth === "unsupported") throw new Error(`${preset.name}: ${preset.note}`);
  let url = (preset?.url || input.url || "").trim();
  if (!/^https:\/\//.test(url)) throw new Error("An https MCP server URL is required.");
  const auth = preset?.auth || (input.key ? "key" : "none");
  if (auth === "key" && !input.key && !preset?.optionalKey) throw new Error(`${preset?.keyLabel || "An API key"} is required.`);
  let secret: string | null = null;
  if (input.key) {
    if (preset?.keyStyle === "query") { const u = new URL(url); u.searchParams.set(preset.queryParam || "apiKey", input.key.trim()); url = u.toString(); secret = encrypt(url); url = preset.url; }
    else secret = encrypt(JSON.stringify({ Authorization: `Bearer ${input.key.trim()}` }));
  }
  const sql = await db();
  const name = (input.name || preset?.name || new URL(url).hostname).slice(0, 60);
  await sql`delete from public.elias_mcp_servers where user_id = ${userId} and (preset = ${preset?.id || "__none__"} or url = ${url})`;
  const id = newId("mcp");
  await sql`insert into public.elias_mcp_servers (id, user_id, name, url, preset, auth_kind, secret_enc, status)
    values (${id}, ${userId}, ${name}, ${url}, ${preset?.id || null}, ${auth}, ${secret}, ${auth === "oauth" ? "needs_auth" : "ok"})`;
  if (auth !== "oauth") await refreshTools(userId, id).catch(() => undefined);
  return { id, name, status: auth === "oauth" ? "needs_auth" : "ok" };
}

/* ---------- JSON-RPC over streamable HTTP ---------- */

async function parse(response: Response) {
  const text = await response.text();
  if (!text) return {} as { result?: unknown; error?: { message?: string } };
  try { return JSON.parse(text); } catch { /* SSE */ }
  const events = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => { try { return JSON.parse(line.slice(5).trim()); } catch { return null; } }).filter(Boolean);
  const final = events.reverse().find((event) => event && ("result" in event || "error" in event));
  if (final) return final;
  throw new Error(`Unreadable MCP response (${response.status}): ${text.slice(0, 160)}`);
}

async function connection(userId: string, row: Row) {
  let url = String(row.url);
  const headers: Record<string, string> = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
  if (row.secret_enc) {
    const value = decrypt(String(row.secret_enc));
    if (value.startsWith("https://")) url = value; else Object.assign(headers, JSON.parse(value));
  }
  if (row.auth_kind === "oauth") {
    if (!row.oauth_enc) throw new Error(`${row.name} needs the user to sign in first. Call mcp_connect for it to show the sign-in link.`);
    const oauth = JSON.parse(decrypt(String(row.oauth_enc))) as OAuthState;
    if (oauth.expiresAt && oauth.expiresAt < Date.now() + 60_000 && oauth.refreshToken) await refreshOAuth(userId, String(row.id), oauth);
    headers.Authorization = `Bearer ${oauth.accessToken}`;
  }
  return { url, headers };
}

async function rpc(conn: { url: string; headers: Record<string, string> }, method: string, params: Record<string, unknown>, session?: string, notify = false) {
  const response = await fetch(conn.url, { method: "POST", cache: "no-store", headers: { ...conn.headers, ...(session ? { "Mcp-Session-Id": session } : {}) }, body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: randomBytes(6).toString("hex"), method, params }), signal: AbortSignal.timeout(60_000) });
  if (notify) return { result: null, session };
  if (response.status === 401) throw Object.assign(new Error("The MCP server rejected the credentials (401)."), { unauthorized: true });
  const payload = await parse(response);
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `MCP request failed (${response.status}).`);
  return { result: payload.result, session: response.headers.get("mcp-session-id") || session };
}

async function open(userId: string, row: Row) {
  const conn = await connection(userId, row);
  const init = await rpc(conn, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "elias", version: "1.0.0" } });
  await rpc(conn, "notifications/initialized", {}, init.session, true).catch(() => undefined);
  return { conn, session: init.session };
}

async function markError(userId: string, id: string, error: unknown) {
  const sql = await db();
  const unauthorized = (error as { unauthorized?: boolean })?.unauthorized;
  await sql`update public.elias_mcp_servers set status = ${unauthorized ? "needs_auth" : "error"}, last_error = ${error instanceof Error ? error.message.slice(0, 300) : String(error)}, updated_at = now() where user_id = ${userId} and id = ${id}`;
}

export async function refreshTools(userId: string, idOrName: string) {
  const row = await getRow(userId, idOrName);
  try {
    const { conn, session } = await open(userId, row);
    const tools: ToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const { result } = await rpc(conn, "tools/list", cursor ? { cursor } : {}, session);
      const value = result as { tools?: ToolInfo[]; nextCursor?: string };
      tools.push(...(value.tools || []));
      if (!value.nextCursor) break;
      cursor = value.nextCursor;
    }
    const sql = await db();
    await sql`update public.elias_mcp_servers set tools = ${sql.json(tools as never)}, status = 'ok', last_error = null, updated_at = now() where id = ${String(row.id)}`;
    return tools;
  } catch (error) { await markError(userId, String(row.id), error); throw error; }
}

export async function serverTools(userId: string, idOrName: string) {
  const row = await getRow(userId, idOrName);
  const cached = Array.isArray(row.tools) ? row.tools as ToolInfo[] : [];
  const tools = cached.length ? cached : await refreshTools(userId, String(row.id));
  return { server: String(row.name), id: String(row.id), tools };
}

export async function callTool(userId: string, idOrName: string, tool: string, args: Record<string, unknown>) {
  const row = await getRow(userId, idOrName);
  try {
    const { conn, session } = await open(userId, row);
    const { result } = await rpc(conn, "tools/call", { name: tool, arguments: args }, session);
    const value = result as { content?: Array<{ type: string; text?: string; [key: string]: unknown }>; structuredContent?: unknown; isError?: boolean };
    const text = (value.content || []).map((part) => part.type === "text" ? part.text : `[${part.type}]`).join("\n");
    return { isError: Boolean(value.isError), text: text.slice(0, 14_000), ...(value.structuredContent && text.length < 200 ? { structured: value.structuredContent } : {}) };
  } catch (error) { await markError(userId, String(row.id), error); throw error; }
}

/** Calls that change something outside (uploads, writes, deletes, sends) need the user's approval. */
export function mcpCallIsWrite(tool: string) {
  return /(upload|delete|remove|insert|update|create|write|apply|execute_sql|deploy|publish|post|send|edit|render|merge|pay|transfer|cancel)/i.test(tool);
}

/* ---------- OAuth 2.1 for MCP (discovery + dynamic client registration + PKCE) ---------- */

async function getJson(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function discover(serverUrl: string) {
  const u = new URL(serverUrl);
  const resource = await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/$/, "")}`).catch(() => getJson(`${u.origin}/.well-known/oauth-protected-resource`)).catch(() => null);
  const issuer = String((resource?.authorization_servers as string[] | undefined)?.[0] || u.origin);
  const i = new URL(issuer);
  const path = i.pathname.replace(/\/$/, "");
  const candidates = [`${i.origin}/.well-known/oauth-authorization-server${path}`, `${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, `${i.origin}/.well-known/openid-configuration${path}`, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, `${i.origin}/.well-known/oauth-authorization-server`];
  for (const candidate of candidates) {
    const meta = await getJson(candidate).catch(() => null);
    if (meta?.authorization_endpoint && meta?.token_endpoint) return { meta, resource: String(resource?.resource || serverUrl) };
  }
  throw new Error("This MCP server doesn't publish OAuth sign-in details.");
}

export async function startOAuth(userId: string, serverId: string, redirectUri: string) {
  const row = await getRow(userId, serverId);
  const { meta, resource } = await discover(String(row.url));
  let clientId: string; let clientSecret: string | undefined;
  const existing = row.oauth_enc ? JSON.parse(decrypt(String(row.oauth_enc))) as OAuthState & { redirectUri?: string } : null;
  if (existing?.clientId && existing.redirectUri === redirectUri) { clientId = existing.clientId; clientSecret = existing.clientSecret; }
  else {
    if (!meta.registration_endpoint) throw new Error("This MCP server needs a pre-registered app; it can't be connected automatically.");
    const response = await fetch(String(meta.registration_endpoint), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Elias", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
    const client = await response.json() as { client_id?: string; client_secret?: string; error_description?: string };
    if (!response.ok || !client.client_id) throw new Error(`Client registration failed: ${client.error_description || response.status}`);
    clientId = client.client_id; clientSecret = client.client_secret;
  }
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(18).toString("base64url");
  const sql = await db();
  await sql`update public.elias_mcp_servers set oauth_enc = ${encrypt(JSON.stringify({ ...(existing || {}), clientId, clientSecret, tokenEndpoint: String(meta.token_endpoint), redirectUri }))} where id = ${String(row.id)}`;
  await sql`insert into public.elias_mcp_oauth_states (state, user_id, server_id, verifier, redirect_uri) values (${state}, ${userId}, ${String(row.id)}, ${verifier}, ${redirectUri})`;
  const auth = new URL(String(meta.authorization_endpoint));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("resource", resource);
  const scopes = (meta.scopes_supported as string[] | undefined)?.filter((scope) => ["openid", "email", "profile", "offline_access"].includes(scope));
  if (scopes?.length) auth.searchParams.set("scope", scopes.join(" "));
  return auth.toString();
}

async function tokenRequest(oauth: OAuthState, body: Record<string, string>) {
  const response = await fetch(oauth.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: oauth.clientId, ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}), ...body }) });
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !token.access_token) throw new Error(`Token exchange failed: ${token.error_description || token.error || response.status}`);
  return token;
}

export async function finishOAuth(userId: string, state: string, code: string) {
  const sql = await db();
  const pending = (await sql`delete from public.elias_mcp_oauth_states where state = ${state} and user_id = ${userId} and created_at > now() - interval '30 minutes' returning *`)[0];
  if (!pending) throw new Error("That sign-in link expired. Ask Elias to connect it again.");
  const row = await getRow(userId, String(pending.server_id));
  const oauth = JSON.parse(decrypt(String(row.oauth_enc))) as OAuthState & { redirectUri?: string };
  const token = await tokenRequest(oauth, { grant_type: "authorization_code", code, redirect_uri: String(pending.redirect_uri), code_verifier: String(pending.verifier) });
  const next = { ...oauth, accessToken: token.access_token, refreshToken: token.refresh_token || oauth.refreshToken, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined };
  await sql`update public.elias_mcp_servers set oauth_enc = ${encrypt(JSON.stringify(next))}, status = 'ok', last_error = null, updated_at = now() where id = ${String(row.id)}`;
  await refreshTools(userId, String(row.id)).catch(() => undefined);
  return { name: String(row.name) };
}

async function refreshOAuth(userId: string, id: string, oauth: OAuthState) {
  const token = await tokenRequest(oauth, { grant_type: "refresh_token", refresh_token: oauth.refreshToken || "" });
  Object.assign(oauth, { accessToken: token.access_token, refreshToken: token.refresh_token || oauth.refreshToken, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined });
  const sql = await db();
  await sql`update public.elias_mcp_servers set oauth_enc = ${encrypt(JSON.stringify(oauth))} where user_id = ${userId} and id = ${id}`;
}
