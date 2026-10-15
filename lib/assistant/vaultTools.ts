import type { ToolSchema } from "@/lib/assistant/llm";
import type { ToolContext } from "@/lib/assistant/tools";
import { liveViewUrl, openBrowser, openLiveBrowser, snapshot } from "@/lib/assistant/browser";
import { detectChallenge, runChallenge } from "@/lib/assistant/challenge";
import { applySavedSession, createGrant, detectBlocker, fillLogin, listSecrets, listSessions, looksLoggedOut, restoreLocalStorage, saveSession, siteOf } from "@/lib/assistant/vault";

type Args = Record<string, unknown>;
type Tool = {
  schema: ToolSchema["function"];
  needsApproval?: (args: Args, ctx: ToolContext) => Promise<string | null> | string | null;
  run: (args: Args, ctx: ToolContext) => Promise<unknown>;
};

const str = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });

/** Waits for the user to finish a step in the live view: the captcha / code / password form goes away. */
async function waitForUser(page: import("playwright-core").Page, seconds: number) {
  const startUrl = page.url();
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    const blocker = await detectBlocker(page).catch(() => "unknown");
    const loggedOut = await looksLoggedOut(page).catch(() => true);
    if (!blocker && !loggedOut) return { done: true, url: page.url() };
    if (!blocker && page.url() !== startUrl && !loggedOut) return { done: true, url: page.url() };
  }
  return { done: false, url: page.url() };
}

async function handoff(ctx: ToolContext, reason: string, waitSeconds: number) {
  const handle = await openLiveBrowser(ctx.userId, ctx.conversationId, ctx.browsers);
  const url = await liveViewUrl(handle.sessionId);
  if (!url) throw new Error("Browserbase did not return a live view link.");
  ctx.addCard?.({ kind: "links", title: "Your turn in the browser", items: [{ title: `Open live view: ${reason}`.slice(0, 90), url, snippet: "Finish this one step on the page; Elias carries on and saves the session." }] });
  const result = await waitForUser(handle.page, waitSeconds);
  if (result.done) {
    const saved = await saveSession(ctx.userId, handle.page);
    return { status: "done", liveViewUrl: url, sessionSaved: saved.saved, page: await snapshot(handle.page) };
  }
  return { status: "waiting", liveViewUrl: url, tell_user: `Open the live view link and ${reason}. When you've done it, say "done" and I'll carry on.` };
}

/** A second sign-in step: answer it through the in-chat challenge card; captchas still go to the live view. */
async function secondStep(ctx: ToolContext, page: import("playwright-core").Page, waitSeconds: number) {
  const found = await detectChallenge(page).catch(() => null);
  if (!found) return null;
  if (found.mode === "captcha") return handoff(ctx, "solve the captcha", waitSeconds);
  const result = await runChallenge(ctx, page, found, Math.min(Math.max(waitSeconds, 60), 200));
  if (result.status === "cleared") {
    const saved = await saveSession(ctx.userId, page);
    return { status: "signed_in", via: "challenge_card", site: result.site, sessionSaved: saved.saved, page: await snapshot(page) };
  }
  if (result.status === "captcha") return handoff(ctx, "solve the captcha", waitSeconds);
  const tell: Record<string, string> = {
    cancelled: "The user cancelled the sign-in check. Stop and say so in one line.",
    wrong_code: "The site rejected the code twice. Tell the user and offer to try again (call browser_challenge).",
    timed_out: "Nobody answered the sign-in check in time. Tell the user in one line; when they're ready, call browser_challenge to show it again.",
  };
  return { status: result.status, site: result.site, tell_user: tell[result.status] };
}

function loginForm(ctx: ToolContext, site: string, loginUrl?: string, reason?: string) {
  const clean = siteOf(site || loginUrl || "");
  ctx.addCard?.({ kind: "vault_form", title: `Save your ${clean} login`, site: clean, ...(loginUrl ? { loginUrl } : {}), ...(reason ? { reason } : {}) });
  return clean;
}

export const VAULT_TOOLS: Record<string, Tool> = {
  vault_request_login: {
    schema: { name: "vault_request_login", description: "Show the user a secure login form in the chat for a site (username, password, optional authenticator key). It saves straight to the encrypted Vault; you never see the password. Use whenever the user wants to give you a login, or a site needs one that isn't saved. After they save it, the chat tells you and you call browser_login.", parameters: obj({ site: s("Site, e.g. sportybet.com"), login_url: s("Login page URL if known"), reason: s("Short reason shown on the form, e.g. 'to check your balance and open bets'") }, ["site"]) },
    run: async (args, ctx) => {
      const site = loginForm(ctx, str(args.site), str(args.login_url) || undefined, str(args.reason) || undefined);
      return { shown: true, site, tell_user: "A secure form is showing in the chat. Tell them in one line to fill it in there (never type the password in chat). When they save it you'll get a message and should carry on with browser_login." };
    },
  },

  vault_list: {
    schema: { name: "vault_list", description: "List the logins the user saved in the Vault (id, site, masked username) and the sites with a saved browser session. Passwords are never shown to you; pass a secret_id to browser_login.", parameters: obj({}) },
    run: async (_args, ctx) => {
      const [secrets, sessions] = await Promise.all([listSecrets(ctx.userId), listSessions(ctx.userId)]);
      return { logins: secrets.map(({ id, site, label, username, hasTotp }) => ({ secret_id: id, site, label, username, authenticator: hasTotp })), saved_sessions: sessions, note: secrets.length ? undefined : "No saved logins yet. Call vault_request_login to show the user a secure form in the chat; never ask for a password in chat." };
    },
  },

  browser_login: {
    schema: {
      name: "browser_login",
      description: "Sign in to a site in the remote browser. First restores the site's saved session (most runs end there). Otherwise fills the saved login (secret_id from vault_list) server-side and submits; you never see the password. If a captcha or code appears, it hands the page to the user with a live-view link and waits, then saves the session.",
      parameters: obj({ url: s("Login page or home page of the site"), secret_id: s("Saved login id from vault_list (optional when a session is saved)"), wait_seconds: { type: "number", description: "How long to wait for the user in the live view (default 150, max 200)" } }, ["url"]),
    },
    run: async (args, ctx) => {
      const url = str(args.url);
      const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers);
      const restored = await applySavedSession(ctx.userId, page, url);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      if (restored.restored && await restoreLocalStorage(page, restored.origins)) await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1500);
      if (restored.restored && !(await looksLoggedOut(page))) return { status: "signed_in", via: "saved_session", site: restored.site, page: await snapshot(page) };
      const secretId = str(args.secret_id);
      if (!secretId) {
        const match = (await listSecrets(ctx.userId)).find((item) => item.site === siteOf(url));
        if (!match) { loginForm(ctx, url, url); return { status: "no_login", tell_user: "No saved login for this site yet, so a secure login form is now showing in the chat. Tell them in one line to fill it in there; when they save it you'll get a message and should call browser_login again." }; }
        args.secret_id = match.id;
      }
      // Some sites hide the form behind a "Login" button.
      if (!(await looksLoggedOut(page))) {
        const opener = page.locator('a:has-text("Log in"), a:has-text("Login"), button:has-text("Log in"), button:has-text("Login"), a:has-text("Sign in"), button:has-text("Sign in")').first();
        if (await opener.isVisible().catch(() => false)) { await opener.click().catch(() => undefined); await page.waitForTimeout(1500); }
      }
      const filled = await fillLogin(ctx.userId, str(args.secret_id), page);
      const wait = Math.min(num(args.wait_seconds, 150), 200);
      if (filled.status === "ok" || filled.status === "needs_user" || filled.status === "no_form") { const step = await secondStep(ctx, page, wait); if (step) return step; }
      if (filled.status === "ok") { const saved = await saveSession(ctx.userId, page); return { status: "signed_in", via: "vault", site: filled.site, sessionSaved: saved.saved, page: await snapshot(page) }; }
      if (filled.status === "needs_user") return handoff(ctx, filled.blocker === "captcha" ? "solve the captcha" : "enter the verification code", Math.min(num(args.wait_seconds, 150), 200));
      return { status: filled.status, site: filled.site, note: "note" in filled ? filled.note : "Couldn't find a login form on this page. Open the site's login page and call browser_login with that URL.", page: await snapshot(page) };
    },
  },

  browser_handoff: {
    schema: { name: "browser_handoff", description: "Hand the current browser page to the user through a live-view link (for a captcha, a code sent to their phone, or a step only they can do). Waits for them, then saves the site's session so next time skips it.", parameters: obj({ reason: s("What the user needs to do, e.g. 'enter the code SportyBet texted you'"), wait_seconds: { type: "number", description: "Default 150, max 200" } }, ["reason"]) },
    run: async (args, ctx) => handoff(ctx, str(args.reason, "finish this step"), Math.min(num(args.wait_seconds, 150), 200)),
  },

  browser_challenge: {
    schema: { name: "browser_challenge", description: "When the current page asks for a second sign-in step (Google or Microsoft 'tap the number', 'check your phone / tap Yes', or an SMS, email or authenticator code), show the user a card in the chat with the number or a code box, act on the page when they answer, then save the session. You never see the code. Captchas go to the live view instead.", parameters: obj({ wait_seconds: { type: "number", description: "Default 170, max 200" } }) },
    run: async (args, ctx) => {
      const { page } = await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers);
      const step = await secondStep(ctx, page, Math.min(num(args.wait_seconds, 170), 200));
      return step || { status: "no_challenge", note: "This page isn't asking for a sign-in check.", page: await snapshot(page) };
    },
  },

  browser_save_session: {
    schema: { name: "browser_save_session", description: "Save the current site's signed-in session (cookies) to the Vault so future runs skip the login. Call after any successful sign-in that browser_login didn't already save.", parameters: obj({}) },
    run: async (_args, ctx) => saveSession(ctx.userId, (await openBrowser(ctx.userId, ctx.conversationId, ctx.browsers)).page),
  },

  request_go_ahead: {
    schema: {
      name: "request_go_ahead",
      description: "Ask the user's approval before a final step that spends money, places a bet, posts publicly or sends something, when that step happens in the browser. Shows an approval card with exactly what will happen. After they approve, you continue in a new turn: redo the steps if the page reset, then click the final button with browser_click final=true; the approval is used up by that one click (valid 20 minutes).",
      parameters: obj({ kind: { type: "string", enum: ["bet", "purchase", "post", "send", "other"] }, site: s("Site, e.g. sportybet.com"), what: s("Exactly what will happen: every selection/item, odds, stake or price"), amount: s("Total money involved with currency, e.g. ₦500 stake, ₦2,140 potential return") }, ["kind", "site", "what"]),
    },
    needsApproval: (args, ctx) => ctx.approved ? null : `${str(args.kind).toUpperCase()} on ${str(args.site)}\n${str(args.what)}${args.amount ? `\nAmount: ${str(args.amount)}` : ""}`,
    run: async (args, ctx) => {
      const grant = await createGrant(ctx.userId, ctx.conversationId, { kind: str(args.kind, "other"), summary: str(args.what), amount: str(args.amount) || undefined, approvalId: ctx.approvalId });
      return { approved: true, grant: grant.id, validMinutes: grant.expiresInMinutes, next: "Continue now: reopen the site (browser_login restores the session), rebuild the slip/cart if it reset, check the total still matches, then browser_click the final button with final=true." };
    },
  },

  bet_ev: {
    schema: {
      name: "bet_ev",
      description: "Betting maths for a slip: implied probability (1/odds), edge, expected value per unit, combined odds and probability for an accumulator, and a quarter-Kelly stake. Probabilities are your own estimates; say so.",
      parameters: obj({ legs: { type: "array", items: obj({ name: s("Selection"), odds: { type: "number" }, probability: { type: "number", description: "Your estimated win probability 0-1" } }, ["odds", "probability"]) }, bankroll: { type: "number", description: "Optional bankroll for a stake suggestion" } }, ["legs"]),
    },
    run: async (args) => {
      const legs = (Array.isArray(args.legs) ? args.legs : []) as Array<{ name?: string; odds: number; probability: number }>;
      const rows = legs.map((leg) => { const odds = Number(leg.odds); const p = Math.min(Math.max(Number(leg.probability), 0), 1); const implied = odds > 0 ? 1 / odds : 0; return { name: leg.name || "", odds, probability: p, implied: +implied.toFixed(4), edge: +(p - implied).toFixed(4), ev_per_unit: +(p * odds - 1).toFixed(4) }; });
      const odds = rows.reduce((acc, row) => acc * row.odds, 1);
      const p = rows.reduce((acc, row) => acc * row.probability, 1);
      const ev = p * odds - 1;
      const kelly = odds > 1 ? Math.max(0, (p * odds - 1) / (odds - 1)) : 0;
      const bankroll = num(args.bankroll, 0);
      return { legs: rows, accumulator: { odds: +odds.toFixed(2), probability: +p.toFixed(4), implied: +(1 / odds).toFixed(4), ev_per_unit: +ev.toFixed(4), quarter_kelly_fraction: +(kelly / 4).toFixed(4), ...(bankroll ? { suggested_stake: Math.floor((bankroll * kelly) / 4) } : {}) }, caveat: "Probabilities are estimates; legs on the same match are correlated, so the combined probability is approximate." };
    },
  },

  clip_create: {
    schema: {
      name: "clip_create",
      description: "Cut a vertical short from a stream/VOD on the free GitHub Actions clipper: finds the loudest reaction moments (or uses the given times), cuts 10-40s, normalises audio, blurred background for landscape, and burns the hook in a white box. Does not post anything. Check progress with clip_status.",
      parameters: obj({ url: s("VOD or video URL"), start: s("Optional start, seconds or HH:MM:SS"), end: s("Optional end"), hook: s("Hook: [Name] + CAPS verb + stakes + specific detail + 2-3 emoji"), count: { type: "number", description: "Clips to auto-pick, 1-3" } }, ["url"]),
    },
    run: async (args, ctx) => {
      if (!ctx.githubToken) throw new Error("GitHub isn't connected in Elias. Ask the user to connect GitHub in Connectors; the clipper runs on their repo's GitHub Actions.");
      const repo = process.env.CLIPPER_REPO || "chike2510/elias-ai";
      const requestId = `c${Date.now().toString(36)}`;
      const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/clip.yml/dispatches`, {
        method: "POST", headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" },
        body: JSON.stringify({ ref: process.env.CLIPPER_REF || "main", inputs: { url: str(args.url), start: str(args.start), end: str(args.end), hook: str(args.hook), count: String(Math.min(Math.max(num(args.count, 1), 1), 3)), request_id: requestId } }),
      });
      if (!response.ok) throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return { started: true, request_id: requestId, repo, note: "Usually 3-10 minutes. Call clip_status with this request_id." };
    },
  },

  clip_status: {
    schema: { name: "clip_status", description: "Status of clipper runs. With request_id: that run, its moments and the download link once done.", parameters: obj({ request_id: s("From clip_create") }) },
    run: async (args, ctx) => {
      if (!ctx.githubToken) throw new Error("GitHub isn't connected in Elias.");
      const repo = process.env.CLIPPER_REPO || "chike2510/elias-ai";
      const gh = async (path: string) => { const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json", "User-Agent": "Elias" }, cache: "no-store" }); if (!r.ok) throw new Error(`GitHub ${r.status}`); return r.json(); };
      const runs = (await gh("/actions/workflows/clip.yml/runs?per_page=15")).workflow_runs as Array<{ id: number; name: string; display_title: string; status: string; conclusion: string | null; html_url: string; created_at: string }>;
      const id = str(args.request_id);
      const picked = id ? runs.filter((run) => run.display_title.includes(id)) : runs.slice(0, 5);
      return Promise.all(picked.map(async (run) => {
        const artifacts = run.status === "completed" ? ((await gh(`/actions/runs/${run.id}/artifacts`)).artifacts as Array<{ name: string; size_in_bytes: number }>) : [];
        return { title: run.display_title, status: run.status, conclusion: run.conclusion, started: run.created_at, run_url: run.html_url, download: artifacts.length ? `${run.html_url}#artifacts` : null, files: artifacts.map((a) => `${a.name} (${Math.round(a.size_in_bytes / 1e6)} MB)`) };
      }));
    },
  },
};

export const VAULT_SIDE_EFFECT_TOOLS = ["vault_request_login", "browser_login", "browser_handoff", "browser_save_session", "browser_challenge", "request_go_ahead", "clip_create"];
