import type { Browser, Page } from "playwright-core";
import { ready } from "@/lib/assistant/db";

/**
 * Real remote browser (Browserbase over CDP). One browser per conversation.
 * Within a turn the CDP connection is reused; across turns the Browserbase session is
 * reattached when BROWSERBASE_KEEP_ALIVE=true (paid plans), otherwise a fresh session starts.
 */
export type BrowserHandle = { browser: Browser; page: Page; sessionId: string };

export function browserConfigured() {
  return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

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

async function connect(connectUrl: string) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(connectUrl, { timeout: 20_000 });
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15_000);
  return { browser, page };
}

export async function openBrowser(userId: string, conversationId: string, cache: Map<string, BrowserHandle>): Promise<BrowserHandle> {
  const cached = cache.get(conversationId);
  if (cached?.browser.isConnected()) return cached;
  if (!browserConfigured()) throw new Error("The remote browser is not configured (BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID). Use web_search/web_open instead, and tell the user browser actions need setup.");
  const db = await ready();
  const keepAlive = process.env.BROWSERBASE_KEEP_ALIVE === "true";
  if (keepAlive) {
    const saved = (await db`select * from public.elias_browser_sessions where user_id = ${userId} and conversation_id = ${conversationId}`)[0];
    if (saved) {
      try {
        const handle = { ...(await connect(saved.connect_url as string)), sessionId: saved.session_id as string };
        cache.set(conversationId, handle);
        return handle;
      } catch { /* session expired; start a new one */ }
    }
  }
  const session = await bb("/sessions", { method: "POST", body: JSON.stringify({ projectId: process.env.BROWSERBASE_PROJECT_ID, ...(keepAlive ? { keepAlive: true } : {}) }) }) as { id: string; connectUrl: string };
  await db`insert into public.elias_browser_sessions (user_id, conversation_id, session_id, connect_url) values (${userId}, ${conversationId}, ${session.id}, ${session.connectUrl})
    on conflict (user_id, conversation_id) do update set session_id = excluded.session_id, connect_url = excluded.connect_url, updated_at = now()`;
  const handle = { ...(await connect(session.connectUrl)), sessionId: session.id };
  cache.set(conversationId, handle);
  return handle;
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
  const saved = (await db`delete from public.elias_browser_sessions where user_id = ${userId} and conversation_id = ${conversationId} returning session_id`)[0];
  const handle = cache.get(conversationId);
  if (handle) { await handle.browser.close().catch(() => undefined); cache.delete(conversationId); }
  if (saved) await bb(`/sessions/${saved.session_id}`, { method: "POST", body: JSON.stringify({ projectId: process.env.BROWSERBASE_PROJECT_ID, status: "REQUEST_RELEASE" }) }).catch(() => undefined);
}
