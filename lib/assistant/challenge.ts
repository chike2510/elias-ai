import type { Page } from "playwright-core";
import type { ToolContext } from "@/lib/assistant/tools";
import { decrypt, encrypt, newId, ready } from "@/lib/assistant/db";
import { siteOf } from "@/lib/assistant/vault";

/**
 * Sign-in challenge cards: when a site asks for a second step (Google / Microsoft number match, "tap Yes on your phone",
 * an SMS / email / authenticator code), Elias keeps the browser open, shows a card in the chat, and acts on the page
 * when the user answers it. The code goes card -> /api/browser/challenge -> encrypted row -> page field, and is deleted
 * right after it is typed. It never enters the conversation, the model, or the logs. Captchas are never automated:
 * those still go to the live-view handoff.
 */
export type ChallengeMode = "number" | "prompt" | "code";
export type Detected = { mode: ChallengeMode; number?: string; hint?: string } | { mode: "captcha" } | null;
export type ChallengeCard = { kind: "challenge"; id: string; site: string; mode: ChallengeMode; number?: string; hint?: string; expiresAt: string };
export type ChallengeAction = "approved" | "resend" | "code" | "cancel";

let schema: Promise<void> | null = null;
async function db() {
  const sql = await ready();
  schema ||= (async () => {
    await sql`create table if not exists public.elias_browser_challenges (
      id text primary key, user_id text not null, conversation_id text, site text not null, mode text not null,
      status text not null default 'pending', action text, code_enc text, attempts int not null default 0,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null)`;
    await sql`create index if not exists elias_browser_challenges_user_idx on public.elias_browser_challenges(user_id, status)`;
    await sql.unsafe("alter table public.elias_browser_challenges enable row level security").catch(() => undefined);
  })().catch((error) => { schema = null; throw error; });
  await schema;
  return sql;
}

const CODE_FIELD = 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[id*="otp" i], input[id*="code" i], input[name="totpPin"], input[name="Pin"], input[type="tel"]';
const RESEND = /resend|send (it )?again|send (a )?new code|didn.?t (get|receive)|try another way|request a new/i;

/** What second step, if any, the current page is asking for. */
export async function detectChallenge(page: Page): Promise<Detected> {
  const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]').first().isVisible().catch(() => false);
  if (captcha) return { mode: "captcha" };
  const info = await page.evaluate(() => {
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const text = (document.body?.innerText || "").slice(0, 5000);
    // The number to match is a short run of digits set much larger than the text around it.
    let number = "";
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.children.length || !visible(el)) continue;
      const value = (el.textContent || "").trim();
      if (/^\d{1,3}$/.test(value) && parseFloat(getComputedStyle(el).fontSize) >= 28) { number = value; break; }
    }
    return { text, number };
  }).catch(() => ({ text: "", number: "" }));
  const url = page.url();
  const text = info.text;
  const numberPage = /(tap|choose|select|enter|pick) the number|number (shown|you see|displayed)|matching number|number on your (screen|phone)/i.test(text);
  if (numberPage && info.number) return { mode: "number", number: info.number, hint: "On your phone, tap the number shown here." };
  const codeField = await page.locator(CODE_FIELD).first().isVisible().catch(() => false);
  const codeText = /verification code|enter (the )?code|one[- ]time (code|password|pin)|we (sent|texted|emailed)|6-digit|authenticator app|security code/i.test(text);
  if (codeField && (codeText || /challenge|verify|2fa|mfa|otp/i.test(url))) {
    const where = text.match(/(sent|texted|emailed)[^.\n]{0,60}(\+?[\d*•\s-]{4,}|\S+@\S+)/i)?.[0];
    return { mode: "code", hint: where ? where.slice(0, 90) : "Enter the code you were sent." };
  }
  const promptPage = /check your phone|tap yes|approve (this )?sign[- ]in|open the .{0,30}app.{0,20}(approve|confirm)|we sent a notification|confirm it.?s you on/i.test(text)
    || /accounts\.google\.com\/.*challenge\/(dp|ipp|ootp|az)/i.test(url);
  if (promptPage) return { mode: "prompt", hint: "Tap Yes on the prompt on your phone." };
  return null;
}

async function createChallenge(userId: string, conversationId: string | null, site: string, mode: ChallengeMode, seconds: number) {
  const sql = await db();
  const id = newId("chl");
  const expires = new Date(Date.now() + seconds * 1000);
  await sql`insert into public.elias_browser_challenges (id, user_id, conversation_id, site, mode, expires_at) values (${id}, ${userId}, ${conversationId}, ${site}, ${mode}, ${expires})`;
  return { id, expiresAt: expires.toISOString() };
}

/** Called by the card's buttons (via the API route). The code is encrypted at once and only held until it is typed. */
export async function answerChallenge(userId: string, id: string, action: ChallengeAction, code?: string) {
  const sql = await db();
  const clean = action === "code" ? String(code || "").replace(/[\s-]/g, "") : "";
  if (action === "code" && !/^[0-9A-Za-z]{4,10}$/.test(clean)) throw new Error("That doesn't look like a code.");
  const rows = await sql`update public.elias_browser_challenges set action = ${action}, code_enc = ${clean ? encrypt(clean) : null}, updated_at = now()
    where id = ${id} and user_id = ${userId} and status = 'pending' and expires_at > now() returning id`;
  if (!rows.length) throw new Error("This sign-in step has finished or expired.");
  return { ok: true };
}

export async function challengeStatus(userId: string, id: string) {
  const sql = await db();
  const row = (await sql`select status, action, expires_at from public.elias_browser_challenges where id = ${id} and user_id = ${userId}`)[0];
  if (!row) return { status: "missing" };
  const expired = row.status === "pending" && new Date(row.expires_at as string).getTime() < Date.now();
  return { status: expired ? "expired" : String(row.status), waitingOn: row.action ? "page" : "you" };
}

async function takeAction(id: string) {
  const sql = await db();
  const row = (await sql`select action, code_enc from public.elias_browser_challenges where id = ${id} and action is not null`)[0];
  if (!row) return null;
  await sql`update public.elias_browser_challenges set action = null, code_enc = null, attempts = attempts + 1, updated_at = now() where id = ${id}`;
  return { action: String(row.action) as ChallengeAction, code: row.code_enc ? decrypt(String(row.code_enc)) : "" };
}

async function finish(id: string, status: "done" | "expired" | "cancelled" | "failed") {
  const sql = await db();
  await sql`update public.elias_browser_challenges set status = ${status}, action = null, code_enc = null, updated_at = now() where id = ${id}`;
}

async function clickResend(page: Page) {
  const candidates = page.locator("a, button, [role=button], [role=link]");
  const count = Math.min(await candidates.count().catch(() => 0), 80);
  for (let i = 0; i < count; i += 1) {
    const item = candidates.nth(i);
    const label = (await item.innerText().catch(() => "")).trim();
    if (RESEND.test(label) && await item.isVisible().catch(() => false)) { await item.click().catch(() => undefined); await page.waitForTimeout(2000); return true; }
  }
  return false;
}

async function typeCode(page: Page, code: string) {
  const fields = page.locator(CODE_FIELD);
  const count = Math.min(await fields.count().catch(() => 0), 8);
  const visible = [];
  for (let i = 0; i < count; i += 1) if (await fields.nth(i).isVisible().catch(() => false)) visible.push(fields.nth(i));
  if (!visible.length) return false;
  if (visible.length >= code.length && visible.length > 1) { for (let i = 0; i < code.length; i += 1) await visible[i].fill(code[i]); }
  else await visible[0].fill(code);
  await visible[Math.min(visible.length, code.length) - 1].press("Enter").catch(() => undefined);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(2500);
  return true;
}

/**
 * Shows the challenge card and drives the page until the step clears, the user cancels, or time runs out.
 * Runs inside the tool call (the chat route allows 300s), so the browser session never has to be reattached.
 */
export async function runChallenge(ctx: ToolContext, page: Page, found: Exclude<Detected, null | { mode: "captcha" }>, seconds = 170) {
  const site = siteOf(page.url());
  const startUrl = page.url();
  const { id, expiresAt } = await createChallenge(ctx.userId, ctx.conversationId, site, found.mode, seconds);
  ctx.addCard?.({ kind: "challenge", id, site, mode: found.mode, number: found.number, hint: found.hint, expiresAt });
  const deadline = Date.now() + seconds * 1000;
  let mode = found.mode;
  let lastNumber = found.number;
  let wrongCodes = 0;
  try {
    while (Date.now() < deadline) {
      await page.waitForTimeout(2500);
      const now = await detectChallenge(page).catch(() => null);
      if (!now && page.url() !== startUrl) { await finish(id, "done"); return { status: "cleared" as const, site, url: page.url() }; }
      if (now?.mode === "captcha") { await finish(id, "failed"); return { status: "captcha" as const, site }; }
      if (now && now.mode !== mode) mode = now.mode;
      if (now?.mode === "number" && now.number && now.number !== lastNumber) {
        lastNumber = now.number; // Google shows a new number after a resend: refresh the card.
        ctx.addCard?.({ kind: "challenge", id, site, mode: "number", number: now.number, hint: now.hint, expiresAt });
      }
      const taken = await takeAction(id);
      if (!taken) continue;
      if (taken.action === "cancel") { await finish(id, "cancelled"); return { status: "cancelled" as const, site }; }
      if (taken.action === "resend") { const clicked = await clickResend(page); if (!clicked) await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined); continue; }
      if (taken.action === "code" && taken.code) {
        const typed = await typeCode(page, taken.code);
        if (typed && (await detectChallenge(page).catch(() => null))?.mode === "code") wrongCodes += 1;
        if (wrongCodes >= 2) { await finish(id, "failed"); return { status: "wrong_code" as const, site }; }
      }
      // "approved": the page moves on by itself once the phone confirms; keep watching.
    }
    await finish(id, "expired");
    return { status: "timed_out" as const, site };
  } catch (error) {
    await finish(id, "failed").catch(() => undefined);
    throw error;
  }
}
