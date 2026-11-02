/**
 * Browser runs: the look → decide → act loop, shared by the Cloudflare Worker and the Node runner.
 * Pure TypeScript with no imports, so the Worker can bundle it and tests can load it directly.
 */

export const MAX_STEPS = 30;
export const VIEWPORT = { width: 1024, height: 640 };

export type RunElement = { id: number; tag: string; type?: string; label: string; x: number; y: number; w: number; h: number };
export type Signals = { captcha?: boolean; codeField?: boolean; codeHint?: string; password?: boolean };
export type Observation = { url: string; title: string; elements: RunElement[]; frame?: string; text?: string; signals?: Signals };

/** What the model may answer. `secret` names a vault login; the server swaps in the real value. */
export type Decision =
  | { action: "click"; target: number; status?: string }
  | { action: "type"; target: number; text?: string; secret?: string; field?: "username" | "password" | "totp"; submit?: boolean; status?: string }
  | { action: "select"; target: number; value: string; status?: string }
  | { action: "scroll"; direction: "up" | "down"; status?: string }
  | { action: "navigate"; url: string; status?: string }
  | { action: "wait"; status?: string }
  | { action: "ask"; question: string; status?: string }
  | { action: "done"; summary: string; status?: string }
  | { action: "fail"; reason: string; status?: string };

/** What the runner executes: coordinates and literal text, already resolved on the server. */
export type RunAction =
  | { type: "click"; x: number; y: number }
  | { type: "type"; x: number; y: number; text: string; submit?: boolean }
  | { type: "select"; x: number; y: number; target: number; value: string }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "navigate"; url: string }
  | { type: "wait"; ms: number };

export type StepReply =
  | { kind: "act"; action: RunAction }
  | { kind: "wait"; ms: number }
  | { kind: "stop"; reason: string };

/** fatal: the runner itself died (browser crashed, time limit); the server ends the run. */
export type StepInput = { observation?: Observation; poll?: boolean; error?: string; fatal?: string };

const ACTIONS = new Set(["click", "type", "select", "scroll", "navigate", "wait", "ask", "done", "fail"]);
const TARGETED = new Set(["click", "type", "select"]);

/** Pulls the first JSON object out of a model reply and checks it against the element list. */
export function parseDecision(raw: string, elements: RunElement[]): Decision {
  const text = raw.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in the model reply.");
  let value: Record<string, unknown>;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error("The model reply was not valid JSON."); }
  const action = String(value.action || "").toLowerCase();
  if (!ACTIONS.has(action)) throw new Error(`Unknown action "${action}".`);
  const status = typeof value.status === "string" ? value.status.slice(0, 80) : undefined;
  const target = Number(value.target);
  if (TARGETED.has(action) && !elements.some((item) => item.id === target)) throw new Error(`Element ${value.target} is not in the list.`);
  const str = (key: string) => typeof value[key] === "string" ? (value[key] as string) : "";
  switch (action) {
    case "click": return { action, target, status };
    case "type": {
      const secret = str("secret");
      const field = (["username", "password", "totp"] as const).find((item) => item === value.field);
      if (!secret && typeof value.text !== "string") throw new Error("type needs text or secret.");
      return { action, target, ...(secret ? { secret, field: field || "password" } : { text: str("text") }), submit: value.submit === true, status };
    }
    case "select": return { action, target, value: str("value"), status };
    case "scroll": return { action, direction: value.direction === "up" ? "up" : "down", status };
    case "navigate": if (!/^https?:\/\//i.test(str("url"))) throw new Error("navigate needs an http(s) url."); return { action, url: str("url"), status };
    case "wait": return { action, status };
    case "ask": return { action, question: str("question") || "I need your help to continue.", status };
    case "done": return { action, summary: str("summary") || "Done.", status };
    default: return { action: "fail", reason: str("reason") || "The model gave up.", status };
  }
}

/** A stable key for loop detection: same action on the same element/page. */
export function decisionKey(decision: Decision, url: string, elements: RunElement[]) {
  const target = "target" in decision ? elements.find((item) => item.id === decision.target) : undefined;
  const what = target ? `${target.tag}:${target.label}` : "";
  const extra = decision.action === "type" ? (decision.secret ? `secret:${decision.secret}` : decision.text) : decision.action === "navigate" ? decision.url : decision.action === "scroll" ? decision.direction : "";
  return `${decision.action}|${what}|${extra}|${url.split("#")[0]}`;
}

/** True when the new key is the same as the previous two: the run has repeated itself twice. */
export function isLooping(previousKeys: string[], key: string) {
  const last = previousKeys.slice(-2);
  return last.length === 2 && last.every((item) => item === key);
}

const APPROVAL_WORDS = /\b(submit|pay|pay now|send|create (an )?account|sign ?up|register|place (your )?order|buy|purchase|checkout|check out|confirm (and pay|order|purchase|booking|payment)|book now|transfer|delete|subscribe|donate)\b/i;

/** Labels that need the user's go-ahead before Elias presses them. */
export function needsApproval(label: string) {
  return APPROVAL_WORDS.test(label);
}

export const DEFAULT_BLOCKLIST = [
  // money movement and identity: Elias never drives these on its own
  "paypal.com", "wise.com", "binance.com", "coinbase.com", "kraken.com", "bybit.com", "okx.com", "metamask.io",
  "gtbank.com", "firstbanknigeria.com", "accessbankplc.com", "zenithbank.com", "ubagroup.com", "opayweb.com", "palmpay.com", "kuda.com", "moniepoint.com",
  "nimc.gov.ng", "immigration.gov.ng", "irs.gov", "login.gov",
  // adult and gambling sites
  "pornhub.com", "xvideos.com", "onlyfans.com", "stake.com",
];

function hostOf(url: string) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/** The blocked domain a URL falls under, or null. `extra` comes from ELIAS_BROWSER_BLOCKLIST. */
export function blockedBy(url: string, extra: string[] = []) {
  if (/^(file|chrome|about|data|javascript):/i.test(url) && !/^about:blank$/i.test(url)) return url.split(":")[0];
  const host = hostOf(url);
  if (!host) return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)) return host;
  const list = [...DEFAULT_BLOCKLIST, ...extra.map((item) => item.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean)];
  return list.find((domain) => host === domain || host.endsWith(`.${domain}`)) || null;
}

/** Center of an element, for a real mouse click. */
export function centerOf(element: RunElement) {
  return { x: Math.round(element.x + element.w / 2), y: Math.round(element.y + element.h / 2) };
}

/** Finds a sign-in code in an email subject/snippet. */
export function codeInText(text: string) {
  const near = text.match(/(?:code|otp|pin|passcode|verification)[^0-9]{0,40}(\d{4,8})\b/i)?.[1];
  return near || text.match(/\b(\d{6})\b/)?.[1] || null;
}

/**
 * Runs in the page (page.evaluate). Numbers visible interactive elements in the viewport, tags them with
 * data-elias-id, and reports captcha / code-field / password signals. Kept as plain JS source (not a function) because
 * bundlers with keepNames (esbuild, wrangler) inject a __name helper that doesn't exist inside the page.
 */
export const COLLECT_ELEMENTS = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const nodes = Array.from(document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [contenteditable=true]")).filter(visible).slice(0, 120);
  const elements = nodes.map((el, id) => {
    el.setAttribute("data-elias-id", String(id));
    const labelFor = el.id ? (document.querySelector('label[for="' + CSS.escape(el.id) + '"]') || {}).textContent : "";
    const label = (el.getAttribute("aria-label") || labelFor || el.placeholder || el.innerText || (el.type === "password" ? "" : el.value) || el.getAttribute("title") || el.getAttribute("name") || "").trim().replace(/\\s+/g, " ").slice(0, 80);
    const r = el.getBoundingClientRect();
    const item = { id, tag: el.tagName.toLowerCase(), label, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    if (typeof el.type === "string" && el.type) item.type = el.type;
    return item;
  });
  const text = ((document.body && document.body.innerText) || "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 3000);
  const captcha = Boolean(document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]'));
  const codeEl = document.querySelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="code" i], input[id*="code" i]');
  const codeField = Boolean(codeEl && visible(codeEl)) && /code|verify|one[- ]time|otp|sent/i.test(text);
  const hint = codeField ? text.match(/(sent|texted|emailed)[^.\\n]{0,80}/i) : null;
  const password = Array.from(document.querySelectorAll("input[type=password]")).some(visible);
  return { title: document.title, elements, text, signals: { captcha, codeField, codeHint: hint ? hint[0] : "", password } };
})()`;

export type PageDriver = {
  observe(): Promise<Observation>;
  act(action: RunAction): Promise<void>;
  keepAlive(): Promise<void>;
};

/**
 * The runner side of the loop: observe, ask the server, act, repeat. The server owns every decision, guard and
 * pause; the runner just follows replies until it is told to stop. Hard cap so a broken server can't spin forever.
 */
export async function driveRun(driver: PageDriver, step: (input: StepInput) => Promise<StepReply>, options: { sleep?: (ms: number) => Promise<void>; maxCalls?: number; deadline?: number } = {}) {
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxCalls = options.maxCalls ?? 2000;
  let input: StepInput = { observation: await driver.observe() };
  for (let calls = 0; calls < maxCalls; calls++) {
    if (options.deadline && Date.now() > options.deadline) return { reason: "Runner time limit reached." };
    const reply = await step(input);
    if (reply.kind === "stop") return { reason: reply.reason };
    if (reply.kind === "wait") {
      await sleep(Math.min(Math.max(reply.ms, 500), 10_000));
      await driver.keepAlive().catch(() => undefined);
      input = { poll: true };
      continue;
    }
    let error: string | undefined;
    try { await driver.act(reply.action); } catch (reason) { error = reason instanceof Error ? reason.message.slice(0, 300) : String(reason); }
    input = { observation: await driver.observe(), ...(error ? { error } : {}) };
  }
  return { reason: "Runner call cap reached." };
}
