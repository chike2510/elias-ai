import { complete, type ContentPart, type LlmMessage } from "@/lib/assistant/llm";
import { gmailSearch, googleConnection } from "@/lib/assistant/google";
import { listSecrets, resolveSecretRef, totpCode } from "@/lib/assistant/vault";
import { blockedBy, centerOf, codeInText, decisionKey, isLooping, needsApproval, parseDecision, type Decision, type Observation, type RunAction, type RunElement, type StepInput, type StepReply } from "@/lib/browserRun/core";
import { addStep, getRun, markStepAction, TERMINAL, updateRun, type BrowserRun, type Pending } from "@/lib/browserRun/store";

/**
 * The server half of a browser run. The runner posts what it sees; this decides the next action with a vision model and
 * applies every safety rail: step cap, repeat guard, blocked sites, approval before Submit/Pay/Send/Create account,
 * vault secrets filled by reference, email codes read from Gmail, and pauses for captchas, phone codes and questions.
 */

const PAUSE_MS = 15 * 60_000;
const GMAIL_TRIES = 6;
const extraBlocklist = () => (process.env.ELIAS_BROWSER_BLOCKLIST || "").split(",");
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const refresh: StepReply = { kind: "act", action: { type: "wait", ms: 300 } };

async function finish(run: BrowserRun, status: "done" | "failed", text: string): Promise<StepReply> {
  await updateRun(run.id, { status, statusText: status === "done" ? "Done" : "Stopped", pending: null, resolution: null, ...(status === "done" ? { summary: text } : { error: text }) });
  return { kind: "stop", reason: text };
}

async function pause(run: BrowserRun, pending: Pending, statusText: string): Promise<StepReply> {
  await updateRun(run.id, { status: pending.type === "approval" ? "awaiting_approval" : "awaiting_input", statusText, pending, resolution: null });
  return { kind: "wait", ms: 2000 };
}

/** Applies the user's answer to a pause. Returns null while there is still nothing to act on. */
async function resume(run: BrowserRun): Promise<StepReply> {
  const pending = run.pending;
  if (!pending) { await updateRun(run.id, { status: "running" }); return refresh; }
  if (Date.now() - Date.parse(pending.since) > PAUSE_MS) return finish(run, "failed", "Waited 15 minutes with no answer, so I closed the browser.");
  const resolution = run.resolution;
  if (!resolution) return { kind: "wait", ms: 2500 };
  const clear = { status: "running" as const, pending: null, resolution: null };
  if (pending.type === "approval") {
    if (resolution.type === "approve") {
      await updateRun(run.id, { ...clear, statusText: "Approved, continuing…", keys: [...run.keys, pending.key], history: [...run.history, `${pending.history} (approved by the user)`] });
      return { kind: "act", action: pending.action };
    }
    await updateRun(run.id, { ...clear, statusText: "Skipped that step", history: [...run.history, `The user declined: ${pending.summary}. Do not press it again; find another way or finish with done/fail.`] });
    return refresh;
  }
  const answer = resolution.type === "answer" ? resolution.text.trim() : "";
  if (pending.kind === "code" && answer && pending.x != null && pending.y != null) {
    await updateRun(run.id, { ...clear, statusText: "Entering your code…", history: [...run.history, "Typed the code the user gave into the code field."] });
    return { kind: "act", action: { type: "type", x: pending.x, y: pending.y, text: answer, submit: true } };
  }
  const note = pending.kind === "captcha" ? `The user answered the captcha: "${answer}". If it is text, type it into the captcha box; if they said done, continue.` : `The user answered "${pending.question}": ${answer}`;
  await updateRun(run.id, { ...clear, statusText: "Got it, continuing…", history: [...run.history, note] });
  return refresh;
}

function codeTarget(elements: RunElement[]) {
  return elements.find((item) => item.tag === "input" && /code|otp|verif|pin/i.test(item.label))
    || elements.find((item) => item.tag === "input" && ["tel", "number", "text"].includes(item.type || "text"));
}

/** Looks for a fresh sign-in code in Gmail. Only emails newer than the run count. */
async function emailCode(run: BrowserRun, site: string) {
  if (!(await googleConnection(run.userId).catch(() => null))) return null;
  const since = Math.floor(Date.parse(run.createdAt) / 1000) - 60;
  const messages = await gmailSearch(run.userId, `after:${since} (code OR verification OR verify OR OTP OR "one-time")`, 5).catch(() => []);
  const fromSite = messages.filter((item) => `${item.from} ${item.subject}`.toLowerCase().includes(site.split(".")[0]));
  for (const message of [...fromSite, ...messages]) {
    const code = codeInText(`${message.subject} ${message.snippet}`);
    if (code) return code;
  }
  return null;
}

async function handleSignals(run: BrowserRun, obs: Observation): Promise<StepReply | null> {
  const signals = obs.signals || {};
  const page = obs.url.split("#")[0];
  if (signals.captcha && !run.keys.includes(`captcha|${page}`)) {
    await updateRun(run.id, { keys: [...run.keys, `captcha|${page}`] });
    return pause(run, { type: "input", kind: "captcha", question: `${host(obs.url)} is showing a captcha. Type what it shows, or tell me how to get past it.`, since: new Date().toISOString() }, "Waiting for you: captcha");
  }
  if (!signals.codeField || run.keys.includes(`code|${page}`)) return null;
  const target = codeTarget(obs.elements);
  if (!target) return null;
  const { x, y } = centerOf(target);
  const viaEmail = /email|e-mail|inbox|mail/i.test(signals.codeHint || "") || !/text|sms|phone|mobile/i.test(signals.codeHint || "");
  if (viaEmail) {
    const code = await emailCode(run, host(obs.url));
    const tries = run.keys.filter((item) => item === `gmail|${page}`).length;
    if (code) {
      await updateRun(run.id, { statusText: "Entering the code from your email…", keys: [...run.keys, `code|${page}`], history: [...run.history, "Read the sign-in code from Gmail and typed it in."] });
      return { kind: "act", action: { type: "type", x, y, text: code, submit: true } };
    }
    if (tries < GMAIL_TRIES && await googleConnection(run.userId).catch(() => null)) {
      await updateRun(run.id, { statusText: "Checking your email for the code…", keys: [...run.keys, `gmail|${page}`] });
      return { kind: "wait", ms: 5000 };
    }
  }
  await updateRun(run.id, { keys: [...run.keys, `code|${page}`] });
  return pause(run, { type: "input", kind: "code", question: `${host(obs.url)} sent you a code${signals.codeHint ? ` (${signals.codeHint})` : ""}. What is it?`, target: target.id, x, y, since: new Date().toISOString() }, "Waiting for you: sign-in code");
}

function describe(decision: Decision, el?: RunElement) {
  const what = el ? `[${el.id}] ${el.tag} "${el.label}"` : "";
  switch (decision.action) {
    case "click": return `clicked ${what}`;
    case "type": return decision.secret ? `typed the saved ${decision.field} for "${decision.secret}" into ${what}` : `typed "${(decision.text || "").slice(0, 60)}" into ${what}${decision.submit ? " and pressed Enter" : ""}`;
    case "select": return `selected "${decision.value}" in ${what}`;
    case "scroll": return `scrolled ${decision.direction}`;
    case "navigate": return `went to ${decision.url}`;
    default: return decision.action;
  }
}

async function prompt(run: BrowserRun, obs: Observation, note?: string): Promise<LlmMessage[]> {
  const logins = await listSecrets(run.userId).catch(() => []);
  const system = [
    "You drive a real web browser to finish the user's goal. Each turn you get a screenshot and a numbered list of the interactive elements in view.",
    "Reply with ONE JSON object and nothing else. Always include \"status\": a short present-tense phrase for the user, like \"Filling sign-up form…\".",
    "Actions:",
    '{"action":"click","target":12}',
    '{"action":"type","target":4,"text":"hello","submit":false}  (submit:true presses Enter after typing)',
    '{"action":"type","target":5,"secret":"<saved login label or site>","field":"username|password|totp"}  (passwords, card numbers and 2FA: ALWAYS use secret, never write them)',
    '{"action":"select","target":7,"value":"Option label"}',
    '{"action":"scroll","direction":"down"}',
    '{"action":"navigate","url":"https://..."}',
    '{"action":"wait"}  (page still loading)',
    '{"action":"ask","question":"..."}  (you need information only the user has, e.g. which plan to pick)',
    '{"action":"done","summary":"..."}  (goal reached; say what you did and anything the user should know)',
    '{"action":"fail","reason":"..."}  (impossible, or you are stuck)',
    "Never invent personal details: ask. Don't try to solve captchas. Pressing Submit/Pay/Send/Create account asks the user first, so just click it when it is the right next step.",
    logins.length ? `Saved logins you can reference: ${logins.map((item) => `"${item.label || item.site}" (${item.site})`).join(", ")}.` : "The user has no saved logins; if a password is needed, ask them to save one in the vault (use ask).",
  ].join("\n");
  const text = [
    `Goal: ${run.goal}`,
    `Step ${run.step + 1} of ${run.maxSteps}.`,
    run.history.length ? `What happened so far:\n${run.history.slice(-12).join("\n")}` : "",
    note ? `Note: ${note}` : "",
    `URL: ${obs.url}\nTitle: ${obs.title}`,
    `Elements:\n${obs.elements.map((item) => `[${item.id}] ${item.tag}${item.type ? `:${item.type}` : ""} ${item.label}`).join("\n") || "(none in view: scroll or navigate)"}`,
    obs.text ? `Page text (trimmed):\n${obs.text.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n\n");
  const content: ContentPart[] = [{ type: "text", text }];
  if (obs.frame) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${obs.frame}`, detail: "high" } });
  return [{ role: "system", content: system }, { role: "user", content }];
}

async function decide(run: BrowserRun, obs: Observation, note?: string) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await complete(await prompt(run, obs, [note, last && `Your last reply was rejected: ${last}. Reply with one valid JSON object.`].filter(Boolean).join(" ")), [], { temperature: 0.1, route: { tier: "vision" } });
    try { return parseDecision(reply.content, obs.elements); } catch (error) { last = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(`The model couldn't pick a valid action (${last}).`);
}

async function resolveText(run: BrowserRun, decision: Extract<Decision, { action: "type" }>) {
  if (!decision.secret) return decision.text || "";
  const login = await resolveSecretRef(run.userId, decision.secret);
  if (decision.field === "username") return login.username;
  if (decision.field === "totp") {
    if (!login.totp) throw new Error(`The saved login "${decision.secret}" has no authenticator secret.`);
    return totpCode(login.totp);
  }
  return login.password;
}

/** One step: called by the runner with what it sees (or a poll while paused). Returns what to do next. */
export async function handleStep(runId: string, input: StepInput): Promise<StepReply> {
  let run = await getRun(runId);
  if (!run) return { kind: "stop", reason: "Run not found." };
  if (TERMINAL.includes(run.status)) return { kind: "stop", reason: run.error || run.summary || run.status };
  if (input.fatal) return finish(run, "failed", `The browser stopped: ${input.fatal.slice(0, 300)}`);
  if (run.status === "awaiting_approval" || run.status === "awaiting_input") return resume(run);
  const obs = input.observation;
  if (!obs) return refresh;
  if (run.status === "queued") run = (await updateRun(run.id, { status: "running" })) || run;

  const step = run.step + 1;
  await addStep(run.id, { step, url: obs.url, title: obs.title, statusText: run.statusText, action: null, click: null, frame: obs.frame || null });
  await updateRun(run.id, { step });
  run = { ...run, step: step - 1 };
  if (step > run.maxSteps) return finish(run, "failed", `Hit the ${run.maxSteps}-step limit before finishing.`);
  const blocked = blockedBy(obs.url, extraBlocklist());
  if (blocked) return finish(run, "failed", `Stopped: ${blocked} is on the blocked-sites list.`);

  try {
    const signal = await handleSignals(run, obs);
    if (signal) return signal;
    const decision = await decide(run, obs, input.error ? `The last action failed: ${input.error}` : undefined);
    const statusText = decision.status || run.statusText;
    if (decision.action === "done") return finish(run, "done", decision.summary);
    if (decision.action === "fail") return finish(run, "failed", decision.reason);
    if (decision.action === "ask") return pause(run, { type: "input", kind: "question", question: decision.question, since: new Date().toISOString() }, "Waiting for your answer");

    const el = "target" in decision ? obs.elements.find((item) => item.id === decision.target) : undefined;
    const key = decisionKey(decision, obs.url, obs.elements);
    if (isLooping(run.keys, key)) return finish(run, "failed", `Stopped: it tried the same thing three times in a row (${describe(decision, el)}).`);
    let action: RunAction;
    if (decision.action === "wait") action = { type: "wait", ms: 1500 };
    else if (decision.action === "scroll") action = { type: "scroll", direction: decision.direction };
    else if (decision.action === "navigate") {
      const bad = blockedBy(decision.url, extraBlocklist());
      if (bad) return finish(run, "failed", `Stopped: ${bad} is on the blocked-sites list.`);
      action = { type: "navigate", url: decision.url };
    } else {
      const target = el as RunElement;
      const point = centerOf(target);
      if (decision.action === "click") action = { type: "click", ...point };
      else if (decision.action === "select") action = { type: "select", ...point, target: target.id, value: decision.value };
      else action = { type: "type", ...point, text: await resolveText(run, decision), submit: decision.submit };
    }
    const history = `${step}. ${describe(decision, el)}`;
    await markStepAction(run.id, step, action, statusText);
    if (el && (decision.action === "click" || (decision.action === "type" && decision.submit)) && needsApproval(el.label)) {
      return pause(run, { type: "approval", summary: `Press "${el.label}" on ${host(obs.url)}`, action, key, history, since: new Date().toISOString() }, `Waiting for your OK to press "${el.label.slice(0, 40)}"`);
    }
    await updateRun(run.id, { statusText, keys: [...run.keys, key], history: [...run.history, history] });
    return { kind: "act", action };
  } catch (error) {
    return finish(run, "failed", error instanceof Error ? error.message.slice(0, 400) : String(error));
  }
}
