/**
 * Rich chat reply helpers shared by the agent (server) and the chat renderer (client).
 * Pure functions only: no imports, so tests can load this file directly.
 *
 * Agent output format:
 *  - A choice question ends with one line `[[choices: Option A | Option B | Option C]]`.
 *    The server strips it from the stored reply and the chat shows quick-reply chips.
 *  - Long answers use `## ` headings; the chat folds each section (see splitSections).
 */

export const MAX_CHOICES = 4;
export const MAX_FOLLOW_UPS = 3;
const CHOICE_MAX_CHARS = 40;
const FOLLOW_UP_MAX_CHARS = 60;

const MARKER = /\n?[ \t]*\[\[\s*(?:choices|options|quick[ _-]?replies)\s*:([^\]\n]*)\]\][ \t]*/gi;
const MARKER_NAMES = ["choices", "options", "quick replies", "quick_replies", "quick-replies", "quickreplies"];

function cleanOption(value: string, max: number) {
  return value.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function uniqueOptions(values: string[], max: number, limit: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanOption(raw, max);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/** A trailing, still-arriving `[[choi…` is hidden while the reply streams. */
function stripPartialMarker(text: string) {
  if (text.endsWith("[") && !text.endsWith("[[")) return text.slice(0, -1).replace(/[ \t]+$/, "");
  const start = text.lastIndexOf("[[");
  if (start < 0) return text;
  const tail = text.slice(start + 2);
  if (tail.includes("]]") || tail.includes("\n")) return text;
  const inner = tail.trimStart().toLowerCase();
  const plausible = MARKER_NAMES.some((name) => `${name}:`.startsWith(inner) || inner.startsWith(`${name}:`) || inner.replace(/\s+:/, ":").startsWith(`${name}:`));
  return plausible ? text.slice(0, start).replace(/[ \t]+$/, "") : text;
}

/** The reply text a user should see: choice markers (complete or still streaming) removed. */
export function visibleReply(text: string) {
  return stripPartialMarker(text.replace(MARKER, "")).replace(/\s+$/, "");
}

/**
 * Splits a model reply into the text to show and its quick-reply choices.
 * Prefers the explicit marker; falls back to a short list right after a final question
 * ("Which one?\n1. Lekki\n2. Ikeja"), which stays visible in the text.
 */
export function extractChoices(reply: string): { text: string; choices: string[] } {
  const markers = [...reply.matchAll(MARKER)];
  if (markers.length) {
    const options = markers.flatMap((match) => match[1].split(/\s*\|\s*/));
    return { text: visibleReply(reply), choices: uniqueOptions(options, CHOICE_MAX_CHARS, MAX_CHOICES) };
  }
  const text = reply.replace(/\s+$/, "");
  const lines = text.split("\n");
  let index = lines.length - 1;
  const items: string[] = [];
  while (index >= 0 && /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(lines[index])) { items.unshift(lines[index]); index -= 1; }
  while (index >= 0 && !lines[index].trim()) index -= 1;
  const question = index >= 0 ? lines[index].trim() : "";
  const short = items.every((item) => cleanOption(item, 200).length <= CHOICE_MAX_CHARS && !/[.:]\s*\S/.test(cleanOption(item, 200).replace(/\.$/, "")));
  if (items.length >= 2 && items.length <= MAX_CHOICES + 1 && short && /\?\s*\**$/.test(question)) {
    return { text, choices: uniqueOptions(items, CHOICE_MAX_CHARS, MAX_CHOICES) };
  }
  return { text, choices: [] };
}

/** Parses the follow-up model's answer (a JSON array, or one suggestion per line) into at most 3 chips. */
export function parseFollowUps(raw: string, exclude: string[] = []): string[] {
  const text = (raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  let values: unknown = null;
  const json = text.match(/\[[\s\S]*\]/)?.[0] ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json);
      values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).suggestions ?? (parsed as Record<string, unknown>).followUps ?? (parsed as Record<string, unknown>).follow_ups : null;
    } catch { values = null; }
  }
  const list = Array.isArray(values) ? values.filter((item): item is string => typeof item === "string")
    : text.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
  const skip = new Set(exclude.map((item) => item.trim().toLowerCase()));
  return uniqueOptions(list, FOLLOW_UP_MAX_CHARS, MAX_FOLLOW_UPS + skip.size).filter((item) => !skip.has(item.toLowerCase()) && item.length >= 3).slice(0, MAX_FOLLOW_UPS);
}

export type ReplySection = { title: string; level: number; body: string };

/**
 * Long answers with two or more top-level headings become a lead plus foldable sections.
 * Headings inside code fences are ignored. Returns null when the reply should render flat.
 */
export function splitSections(text: string, minChars = 900): { lead: string; sections: ReplySection[] } | null {
  if (!text || text.length < minChars) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const headings: Array<{ line: number; level: number; title: string }> = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/) || line.match(/^()\*\*([^*]{2,80})\*\*:?\s*$/);
    if (match) headings.push({ line: index, level: match[1] ? match[1].length : 5, title: match[2].replace(/\*\*/g, "").trim() });
  });
  if (!headings.length) return null;
  const top = Math.min(...headings.map((item) => item.level));
  const tops = headings.filter((item) => item.level === top);
  if (tops.length < 2) return null;
  const lead = lines.slice(0, tops[0].line).join("\n").trim();
  const sections = tops.map((item, index) => ({
    title: item.title,
    level: top === 5 ? 3 : top,
    body: lines.slice(item.line + 1, index + 1 < tops.length ? tops[index + 1].line : lines.length).join("\n").trim(),
  }));
  return { lead, sections };
}

/** Column alignment from a markdown table separator row (`:---`, `:---:`, `---:`). */
export function tableAlignments(separator: string[]): Array<"left" | "center" | "right" | undefined> {
  return separator.map((cell) => {
    const value = cell.trim();
    const left = value.startsWith(":");
    const right = value.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : undefined;
  });
}

/** Numbers, money, percentages, scores and ratios read best right-aligned and unbroken. */
export function isNumericCell(value: string) {
  const text = value.replace(/\*\*|`/g, "").trim();
  return text.length > 0 && text.length <= 18 && /^[+\-−]?(?:[₦$€£]|NGN|USD)?\s?\d[\d,.]*(?:\s?(?:%|k|m|bn|x))?(?:\s?[-–/:]\s?\d[\d,.]*%?)?$/i.test(text);
}

/** Whether a reply has a fenced code block, a table or other wide content that wants the full bubble width. */
export function hasWideContent(text: string) {
  return /```/.test(text) || /\|[^\n]*\n\s*\|?\s*:?-{3,}:?\s*\|/.test(text);
}
