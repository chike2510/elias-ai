/**
 * Pure helpers for the long-press message menu (shared by the chat UI, the agent and tests).
 * No DOM or React here so node tests can load it directly.
 */

export const LONG_PRESS_MS = 450;
/** Finger travel (px) that turns a press into a scroll and cancels the menu. */
export const MOVE_SLOP_PX = 8;
/** Longest quoted reply kept with a message (characters). */
export const MAX_REPLY_QUOTE = 2000;

export type MenuRole = "user" | "assistant";
export type MenuActionId = "copy" | "select" | "reply" | "edit" | "download";
export type MenuAction = { id: MenuActionId; label: string };
export type Feedback = "up" | "down";

/** Which actions a pressed bubble offers. Thumbs live in their own row (assistant text only, see showFeedback). */
export function menuActions(input: { role: MenuRole; hasText: boolean; hasImage?: boolean; canEdit?: boolean }): MenuAction[] {
  const items: MenuAction[] = [];
  if (input.hasText) {
    items.push({ id: "copy", label: "Copy" }, { id: "select", label: "Select Text" }, { id: "reply", label: "Reply" });
    if (input.role === "user" && input.canEdit) items.push({ id: "edit", label: "Edit & resend" });
  }
  if (input.hasImage) items.push({ id: "download", label: "Download" });
  return items;
}

export function showFeedback(input: { role: MenuRole; hasText: boolean; messageId?: number }) {
  return input.role === "assistant" && input.hasText && typeof input.messageId === "number" && input.messageId > 0;
}

export function parseFeedback(value: unknown): Feedback | null {
  const rating = value && typeof value === "object" ? (value as { rating?: unknown }).rating : value;
  return rating === "up" || rating === "down" ? rating : null;
}

/** Markdown to readable plain text for the Select Text sheet. Tables and lists keep their shape. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\[\[choices:[^\]]*\]\]/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First non-empty line, as plain text, for the quoted-reply chip. */
export function firstLine(markdown: string, max = 80): string {
  const line = plainText(markdown).split("\n").map((item) => item.replace(/^\s*([-*+]|\d+[.)])\s+/, "").trim()).find(Boolean) || "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Cleans a quoted reply coming from the client. */
export function cleanReplyQuote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\u0000/g, "").trim();
  if (!text) return undefined;
  return text.length > MAX_REPLY_QUOTE ? `${text.slice(0, MAX_REPLY_QUOTE - 1)}…` : text;
}

/** What the model sees for a message that replies to an earlier one. */
export function withReplyContext(text: string, quote?: string, max = MAX_REPLY_QUOTE): string {
  if (!quote) return text;
  const clipped = quote.length > max ? `${quote.slice(0, max - 1)}…` : quote;
  return `[The user is replying to this earlier message]\n${clipped.split("\n").map((line) => `> ${line}`).join("\n")}\n\n${text}`;
}

export type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };

/**
 * Where the menu card goes: under the bubble, else above it, else (a bubble taller than the screen)
 * pinned near the press point. Horizontally it lines up with the bubble's side and stays on screen.
 */
export function placeMenu(input: { rect: Rect; menuWidth: number; menuHeight: number; viewportWidth: number; viewportHeight: number; align: "start" | "end"; pressY?: number; margin?: number; gap?: number }) {
  const margin = input.margin ?? 12;
  const gap = input.gap ?? 8;
  const { rect, menuWidth, menuHeight, viewportWidth, viewportHeight } = input;
  const maxLeft = Math.max(margin, viewportWidth - margin - menuWidth);
  const left = Math.min(maxLeft, Math.max(margin, input.align === "end" ? rect.right - menuWidth : rect.left));
  if (rect.bottom + gap + menuHeight <= viewportHeight - margin) return { top: Math.max(margin, rect.bottom + gap), left, side: "below" as const };
  if (rect.top - gap - menuHeight >= margin) return { top: rect.top - gap - menuHeight, left, side: "above" as const };
  const anchor = input.pressY ?? viewportHeight / 2;
  const top = Math.min(viewportHeight - margin - menuHeight, Math.max(margin, anchor + gap));
  return { top, left, side: "over" as const };
}

/**
 * Long-press state machine: down() starts a timer, move() beyond the slop or up()/cancel() stops it,
 * and onFire runs once the delay passes with the finger still. Timers are injectable for tests.
 */
export function createLongPress(options: { onFire: (point: { x: number; y: number }) => void; delay?: number; slop?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void }) {
  const delay = options.delay ?? LONG_PRESS_MS;
  const slop = options.slop ?? MOVE_SLOP_PX;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const stop = () => { if (timer !== null) clearTimer(timer); timer = null; start = null; };
  return {
    down(x: number, y: number) {
      stop();
      fired = false;
      start = { x, y };
      timer = setTimer(() => { timer = null; if (!start) return; fired = true; const point = start; start = null; options.onFire(point); }, delay);
    },
    move(x: number, y: number) {
      if (start && Math.hypot(x - start.x, y - start.y) > slop) stop();
    },
    up() { stop(); },
    cancel() { stop(); },
    /** True once after a press opened the menu, so the click that ends it can be swallowed. */
    consumeFired() { const was = fired; fired = false; return was; },
    get pending() { return timer !== null; },
  };
}
