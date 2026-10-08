import type { Browser, Page } from "playwright-core";
import { ready } from "@/lib/assistant/db";

/**
 * Real remote browser over CDP. Providers, in order:
 *  1. Cloudflare Browser Run (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_BROWSER_TOKEN): a fresh session per turn,
 *     closed at the end of the turn (keep_alive only guards idle gaps while the model thinks).
 *  2. Browserbase (BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID): used when Cloudflare is not configured,
 *     or when Cloudflare is out of quota / rate limited / unreachable. Sessions are reattached across turns
 *     when BROWSERBASE_KEEP_ALIVE=true (paid plans).
 * Within a turn the CDP connection is reused (one browser per conversation).
 */
export type BrowserProvider = "cloudflare" | "browserbase";
export type BrowserHandle = { browser: Browser; page: Page; sessionId: string; provider: BrowserProvider; notice?: string };

export function cloudflareConfigured() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_BROWSER_TOKEN);
}

export function browserbaseConfigured() {
  return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

export function browserConfigured() {
  return cloudflareConfigured() || browserbaseConfigured();
}

export function browserProviders(): BrowserProvider[] {
  return [...(cloudflareConfigured() ? ["cloudflare" as const] : []), ...(browserbaseConfigured() ? ["browserbase" as const] : [])];
}

const DEFAULT_KEEP_ALIVE_MS = 180_000;

/** keep_alive in ms for Cloudflare sessions: env CLOUDFLARE_BROWSER_KEEP_ALIVE_MS, clamped to Cloudflare's 10s..10min. */
export function cloudflareKeepAliveMs(env: Record<string, string | undefined> = process.env) {
  const raw = Number(env.CLOUDFLARE_BROWSER_KEEP_ALIVE_MS);
  const value = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_KEEP_ALIVE_MS;
  return Math.min(600_000, Math.max(10_000, value));
}

export function cloudflareEndpoint(accountId: string, keepAliveMs: number) {
  return `wss://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-run/devtools/browser?keep_alive=${keepAliveMs}`;
}

/** True for errors that mean "out of browser time / too many sessions right now". */
export function isQuotaError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /\b(429|402)\b|too many|rate.?limit|quota|limit (exceeded|reached)|exceeded|concurrent session|browser time/i.test(text);
}

export const BROWSER_QUOTA_MESSAGE = "The remote browser has used up its free time for now (provider limit reached). Use web_search/web_open instead, and tell the user browser actions will work again later.";

const FINAL_ACTION = /\b(pay|place (your )?order|buy now|purchase|checkout|complete (order|booking|purchase)|confirm (and pay|booking|order|purchase)|book now|reserve now|submit order|send money|transfer|delete account|subscribe)\b/i;

export function looksConsequential(label: string) {
  return FINAL_ACTION.test(label);
}

async function bb(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.browserbase.com/v1${path}`, { ...init, headers: { "X-BB-API-Key": process.env.BROWSERBASE_API_KEY || "", "Content-Type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`Browserbase ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function connect(connectUrl: string, headers?: Record<string, string>) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(connectUrl, { timeout: 20_000, ...(headers ? { headers } : {}) });
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15_000);
    return { browser, page };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function openCloudflare(): Promise<BrowserHandle> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  try {
    const { browser, page } = await connect(cloudflareEndpoint(accountId, cloudflareKeepAliveMs()), { Authorization: `Bearer ${process.env.CLOUDFLARE_BROWSER_TOKEN || ""}` });
    return { browser, page, sessionId: "cloudflare", provider: "cloudflare" };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+/gi, "Bearer ***");
    throw Object.assign(new Error(`Cloudflare Browser Run: ${message.slice(0, 300)}`), { quota: isQuotaError(error) });
  }
}

async function openBrowserbase(userId: string | null, conversationId: string | null): Promise<BrowserHandle> {
  const keepAlive = process.env.BROWSERBASE_KEEP_ALIVE === "true" && Boolean(userId && conversationId);
  const db = userId && conversationId ? await ready() : null;
  if (keepAlive && db) {
    const saved = (await db`select * from public.elias_assistant_browsers where user_id = ${userId} and conversation_id = ${conversationId}`)[0];
    if (saved) {
      try {
        return { ...(await connect(saved.connect_url as string)), sessionId: saved.session_id as string, provider: "browserbase" };
      } catch { /* session expired; start a new one */ }
    }
  }
  let session: { id: string; connectUrl: string };
  try {
    session = await bb("/sessions", { method: "POST", body: JSON.stringify({ projectId: process.env.BROWSERBASE_PROJECT_ID, ...(keepAlive ? { keepAlive: true } : {}) }) }) as { id: string; connectUrl: string };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { quota: isQuotaError(error) });
  }
  if (db) {
    await db`insert into public.elias_assistant_browsers (user_id, conversation_id, session_id, connect_url) values (${userId}, ${conversationId}, ${session.id}, ${session.connectUrl})
      on conflict (user_id, conversation_id) do update set session_id = excluded.session_id, connect_url = excluded.connect_url, updated_at = now()`;
  }
  return { ...(await connect(session.connectUrl)), sessionId: session.id, provider: "browserbase" };
}

/** Opens a session on the first provider that works. Cloudflare quota/rate-limit/connect errors fall back to Browserbase. */
export async function launchBrowser(userId: string | null = null, conversationId: string | null = null): Promise<BrowserHandle> {
  if (!browserConfigured()) throw new Error("The remote browser is not configured (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_BROWSER_TOKEN, or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID). Use web_search/web_open instead, and tell the user browser actions need setup.");
  let cloudflareError: (Error & { quota?: boolean }) | null = null;
  if (cloudflareConfigured()) {
    try {
      return await openCloudflare();
    } catch (error) {
      cloudflareError = error as Error & { quota?: boolean };
      console.warn("[browser] Cloudflare failed, trying fallback:", cloudflareError.message);
    }
  }
  if (browserbaseConfigured()) {
    try {
      const handle = await openBrowserbase(userId, conversationId);
      if (cloudflareError) handle.notice = cloudflareError.quota ? "Cloudflare browser limit reached; using Browserbase." : "Cloudflare browser unavailable; using Browserbase.";
      return handle;
    } catch (error) {
      const failure = error as Error & { quota?: boolean };
      if (failure.quota || cloudflareError?.quota) throw new Error(BROWSER_QUOTA_MESSAGE);
      throw failure;
    }
  }
  if (cloudflareError?.quota) throw new Error(BROWSER_QUOTA_MESSAGE);
  throw cloudflareError || new Error("No browser provider available.");
}

export async function openBrowser(userId: string, conversationId: string, cache: Map<string, BrowserHandle>): Promise<BrowserHandle> {
  const cached = cache.get(conversationId);
  if (cached?.browser.isConnected()) return cached;
  const handle = await launchBrowser(userId, conversationId);
  cache.set(conversationId, handle);
  return handle;
}

/** Owner health check: open example.com on whichever provider serves, return its title, close at once. */
export async function probeBrowser() {
  const started = Date.now();
  const handle = await launchBrowser();
  try {
    await handle.page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    return { provider: handle.provider, title: await handle.page.title(), notice: handle.notice || null, ms: Date.now() - started };
  } finally {
    await handle.browser.close().catch(() => undefined);
  }
}

/** Text snapshot of the page with numbered interactive elements the model can target. */
export async function snapshot(page: Page) {
  const data = await page.evaluate(() => {
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const nodes = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [contenteditable=true]")).filter(visible).slice(0, 150);
    const elements = nodes.map((el, index) => {
      el.setAttribute("data-elias-id", String(index));
      const input = el as HTMLInputElement;
      const label = (el.getAttribute("aria-label") || input.placeholder || (el as HTMLElement).innerText || input.value || el.getAttribute("title") || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 80);
      return `[${index}] ${el.tagName.toLowerCase()}${input.type ? `:${input.type}` : ""} ${label}`;
    });
    const text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 6000);
    return { title: document.title, elements, text };
  });
  return `URL: ${page.url()}\nTitle: ${data.title}\n\nInteractive elements:\n${data.elements.join("\n")}\n\nPage text:\n${data.text}`;
}

export async function elementLabel(page: Page, id: number) {
  return page.locator(`[data-elias-id="${id}"]`).first().evaluate((el) => ((el.getAttribute("aria-label") || (el as HTMLElement).innerText || (el as HTMLInputElement).value || "") as string).trim().slice(0, 120)).catch(() => "");
}

export async function closeAll(cache: Map<string, BrowserHandle>) {
  for (const handle of cache.values()) await handle.browser.close().catch(() => undefined);
  cache.clear();
}

export async function endBrowser(userId: string, conversationId: string, cache: Map<string, BrowserHandle>) {
  const db = await ready();
  const saved = (await db`delete from public.elias_assistant_browsers where user_id = ${userId} and conversation_id = ${conversationId} returning session_id`)[0];
  const handle = cache.get(conversationId);
  if (handle) { await handle.browser.close().catch(() => undefined); cache.delete(conversationId); }
  if (saved) await bb(`/sessions/${saved.session_id}`, { method: "POST", body: JSON.stringify({ projectId: process.env.BROWSERBASE_PROJECT_ID, status: "REQUEST_RELEASE" }) }).catch(() => undefined);
}
