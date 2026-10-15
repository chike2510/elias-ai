import type { BrowserContext, Page } from "playwright-core";
import { decrypt, encrypt, newId, ready } from "@/lib/assistant/db";

/**
 * The vault: logins the user saved for Elias, and browser sessions (cookies + localStorage) Elias saved after a login.
 * Everything is AES-256-GCM encrypted at rest (ELIAS_ENCRYPTION_KEY via lib/assistant/crypto.ts).
 * Plaintext secrets never leave this module except into a page's form field, server-side. The model only ever sees
 * a secret's id, site and a masked username.
 */

export type VaultSecret = { id: string; site: string; label: string; username: string; hasTotp: boolean; createdAt: string; lastUsedAt: string | null };
export type SavedSession = { site: string; updatedAt: string; cookies: number };

let schema: Promise<void> | null = null;
async function db() {
  const sql = await ready();
  schema ||= (async () => {
    await sql`create table if not exists public.elias_vault_secrets (
      id text primary key, user_id text not null, site text not null, label text not null default '',
      username_enc text not null, password_enc text not null, totp_enc text, login_url text,
      created_at timestamptz not null default now(), last_used_at timestamptz)`;
    await sql`create index if not exists elias_vault_secrets_user_idx on public.elias_vault_secrets(user_id, site)`;
    await sql`create table if not exists public.elias_browser_states (
      user_id text not null, site text not null, state_enc text not null, cookies int not null default 0,
      updated_at timestamptz not null default now(), primary key (user_id, site))`;
    await sql`create table if not exists public.elias_action_grants (
      id text primary key, user_id text not null, conversation_id text not null, kind text not null, summary text not null,
      amount text, approval_id text, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now())`;
    await sql`create index if not exists elias_action_grants_conv_idx on public.elias_action_grants(user_id, conversation_id, used_at)`;
    for (const table of ["elias_vault_secrets", "elias_browser_states", "elias_action_grants"]) await sql.unsafe(`alter table public.${table} enable row level security`).catch(() => undefined);
  })().catch((error) => { schema = null; throw error; });
  await schema;
  return sql;
}

/** "https://www.sportybet.com/ng/login" -> "sportybet.com" */
export function siteOf(input: string) {
  const raw = input.trim().toLowerCase();
  try {
    const host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
    const parts = host.replace(/^www\./, "").split(".");
    // keep 3 labels for country second-level domains like bet9ja.com.ng / co.uk
    return parts.length > 2 && /^(com|co|org|net|gov|ac)$/.test(parts[parts.length - 2]) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
  } catch { return raw.replace(/^www\./, ""); }
}

function mask(value: string) {
  if (value.includes("@")) { const [name, domain] = value.split("@"); return `${name.slice(0, 2)}***@${domain}`; }
  return value.length <= 4 ? "***" : `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export async function listSecrets(userId: string): Promise<VaultSecret[]> {
  const sql = await db();
  const rows = await sql`select * from public.elias_vault_secrets where user_id = ${userId} order by site, created_at`;
  return rows.map((row) => ({ id: String(row.id), site: String(row.site), label: String(row.label || ""), username: mask(decrypt(String(row.username_enc))), hasTotp: Boolean(row.totp_enc), createdAt: new Date(row.created_at as string).toISOString(), lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null }));
}

export async function saveSecret(userId: string, input: { site: string; username: string; password: string; label?: string; loginUrl?: string; totp?: string }) {
  const site = siteOf(input.site || input.loginUrl || "");
  if (!site || !input.username?.trim() || !input.password) throw new Error("Site, username and password are required.");
  const sql = await db();
  const id = newId("sec");
  await sql`insert into public.elias_vault_secrets (id, user_id, site, label, username_enc, password_enc, totp_enc, login_url)
    values (${id}, ${userId}, ${site}, ${(input.label || "").slice(0, 60)}, ${encrypt(input.username.trim())}, ${encrypt(input.password)}, ${input.totp ? encrypt(input.totp.replace(/\s+/g, "")) : null}, ${input.loginUrl?.trim() || null})`;
  return { id, site };
}

export async function deleteSecret(userId: string, id: string) {
  const sql = await db();
  const rows = await sql`delete from public.elias_vault_secrets where user_id = ${userId} and id = ${id} returning id`;
  return rows.length > 0;
}

/** Server-only. Never return this to the model or the client. */
async function readSecret(userId: string, id: string) {
  const sql = await db();
  const row = (await sql`update public.elias_vault_secrets set last_used_at = now() where user_id = ${userId} and id = ${id} returning *`)[0];
  if (!row) throw new Error("No saved login with that id. Call vault_list to see the user's saved logins.");
  return { site: String(row.site), username: decrypt(String(row.username_enc)), password: decrypt(String(row.password_enc)), totp: row.totp_enc ? decrypt(String(row.totp_enc)) : null, loginUrl: (row.login_url as string) || null };
}

/* ---------- saved browser sessions (Playwright storageState) ---------- */

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export async function saveSession(userId: string, page: Page) {
  const site = siteOf(page.url());
  const state = await page.context().storageState();
  const own = (domain: string) => siteOf(domain.replace(/^\./, "")) === site;
  const filtered: StorageState = { cookies: state.cookies.filter((cookie) => own(cookie.domain)), origins: state.origins.filter((origin) => own(origin.origin)) };
  if (!filtered.cookies.length && !filtered.origins.length) return { site, saved: false, cookies: 0 };
  const sql = await db();
  await sql`insert into public.elias_browser_states (user_id, site, state_enc, cookies) values (${userId}, ${site}, ${encrypt(JSON.stringify(filtered))}, ${filtered.cookies.length})
    on conflict (user_id, site) do update set state_enc = excluded.state_enc, cookies = excluded.cookies, updated_at = now()`;
  return { site, saved: true, cookies: filtered.cookies.length };
}

export async function listSessions(userId: string): Promise<SavedSession[]> {
  const sql = await db();
  const rows = await sql`select site, cookies, updated_at from public.elias_browser_states where user_id = ${userId} order by updated_at desc`;
  return rows.map((row) => ({ site: String(row.site), cookies: Number(row.cookies), updatedAt: new Date(row.updated_at as string).toISOString() }));
}

export async function deleteSession(userId: string, site: string) {
  const sql = await db();
  await sql`delete from public.elias_browser_states where user_id = ${userId} and site = ${siteOf(site)}`;
}

/** Before opening a URL: put the saved cookies for its site into the browser. localStorage is restored after load. */
export async function applySavedSession(userId: string, page: Page, url: string) {
  const site = siteOf(url);
  const sql = await db().catch(() => null);
  if (!sql) return { site, restored: false };
  const row = (await sql`select state_enc from public.elias_browser_states where user_id = ${userId} and site = ${site}`)[0];
  if (!row) return { site, restored: false };
  try {
    const state = JSON.parse(decrypt(String(row.state_enc))) as StorageState;
    if (state.cookies.length) await page.context().addCookies(state.cookies);
    return { site, restored: true, origins: state.origins };
  } catch { return { site, restored: false }; }
}

export async function restoreLocalStorage(page: Page, origins: StorageState["origins"] | undefined) {
  const current = (() => { try { return new URL(page.url()).origin; } catch { return ""; } })();
  const match = origins?.find((origin) => origin.origin === current);
  if (!match?.localStorage.length) return false;
  await page.evaluate((items) => { for (const item of items) localStorage.setItem(item.name, item.value); }, match.localStorage).catch(() => undefined);
  return true;
}

/* ---------- logging in with a saved secret ---------- */

/** RFC 6238 TOTP from a base32 secret, for sites where the user saved their authenticator key. */
export async function totpCode(secret: string, now = Date.now()) {
  const { createHmac } = await import("node:crypto");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) { const value = alphabet.indexOf(char); if (value >= 0) bits += value.toString(2).padStart(5, "0"); }
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const USER_FIELD = 'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="phone" i], input[name*="mobile" i], input[id*="user" i], input[id*="email" i], input[id*="phone" i], input[placeholder*="phone" i], input[placeholder*="email" i], input[placeholder*="user" i], input[type="tel"]';
const PASS_FIELD = 'input[type="password"]';
const OTP_FIELD = 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[id*="otp" i]';
const SUBMIT = 'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button:has-text("Continue"), button:has-text("Next")';

async function firstVisible(page: Page, selector: string) {
  const all = page.locator(selector);
  const count = Math.min(await all.count().catch(() => 0), 10);
  for (let i = 0; i < count; i += 1) { const item = all.nth(i); if (await item.isVisible().catch(() => false)) return item; }
  return null;
}

export async function detectBlocker(page: Page) {
  const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], [class*="captcha" i]').first().isVisible().catch(() => false);
  if (captcha) return "captcha";
  if (await firstVisible(page, OTP_FIELD)) return "code";
  const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  if (/verification code|enter the code|one[- ]time|2-step|two[- ]factor|we sent a code|approve (this )?sign[- ]in/i.test(text)) return "code";
  return null;
}

export async function looksLoggedOut(page: Page) {
  return Boolean(await firstVisible(page, PASS_FIELD));
}

/**
 * Fills username/password from the vault into the current page, server-side, and submits.
 * Handles one-page and two-step (username, then password) forms, and TOTP when the user saved the key.
 * Returns "ok" | "needs_user" (captcha / code the vault can't answer) | "no_form".
 */
export async function fillLogin(userId: string, secretId: string, page: Page) {
  const secret = await readSecret(userId, secretId);
  if (secret.loginUrl && !(await firstVisible(page, PASS_FIELD)) && !(await firstVisible(page, USER_FIELD))) {
    await page.goto(secret.loginUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  }
  let user = await firstVisible(page, USER_FIELD);
  let pass = await firstVisible(page, PASS_FIELD);
  if (!user && !pass) return { status: "no_form" as const, site: secret.site };
  if (user) await user.fill(secret.username);
  if (user && !pass) {
    // two-step: submit the username first
    const next = await firstVisible(page, SUBMIT);
    if (next) await next.click(); else await user.press("Enter");
    await page.waitForTimeout(2000);
    pass = await firstVisible(page, PASS_FIELD);
    if (!pass) return { status: (await detectBlocker(page)) ? "needs_user" as const : "no_form" as const, site: secret.site };
  }
  await pass!.fill(secret.password);
  const submit = await firstVisible(page, SUBMIT);
  if (submit) await submit.click(); else await pass!.press("Enter");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(2500);
  let blocker = await detectBlocker(page);
  if (blocker === "code" && secret.totp) {
    const otp = await firstVisible(page, OTP_FIELD);
    if (otp) { await otp.fill(await totpCode(secret.totp)); await otp.press("Enter"); await page.waitForTimeout(2500); blocker = await detectBlocker(page); }
  }
  if (blocker) return { status: "needs_user" as const, site: secret.site, blocker };
  if (await looksLoggedOut(page)) return { status: "failed" as const, site: secret.site, note: "The password field is still showing: the site may have rejected the login. Ask the user to check the saved login on the Vault page." };
  return { status: "ok" as const, site: secret.site };
}

/* ---------- go-ahead grants: an approval that unlocks one final click in a later turn ---------- */

export async function createGrant(userId: string, conversationId: string, input: { kind: string; summary: string; amount?: string; approvalId?: string; minutes?: number }) {
  const sql = await db();
  const id = newId("grt");
  const minutes = Math.min(Math.max(input.minutes || 20, 1), 120);
  await sql`insert into public.elias_action_grants (id, user_id, conversation_id, kind, summary, amount, approval_id, expires_at)
    values (${id}, ${userId}, ${conversationId}, ${input.kind}, ${input.summary.slice(0, 2000)}, ${input.amount || null}, ${input.approvalId || null}, now() + make_interval(mins => ${minutes}))`;
  return { id, expiresInMinutes: minutes };
}

/** Uses up one live grant for this conversation. Returns its summary, or null when there is none. */
export async function consumeGrant(userId: string, conversationId: string) {
  const sql = await db().catch(() => null);
  if (!sql) return null;
  const row = (await sql`update public.elias_action_grants set used_at = now() where id = (
      select id from public.elias_action_grants where user_id = ${userId} and conversation_id = ${conversationId} and used_at is null and expires_at > now() order by created_at limit 1)
    returning summary, kind`)[0];
  return row ? { summary: String(row.summary), kind: String(row.kind) } : null;
}
