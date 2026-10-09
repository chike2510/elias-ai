/**
 * Pure helpers for the v3 chat input: model choice parsing, the Auto router heuristic and
 * attachment validation. No imports, so tests can load it with a plain TypeScript transpile.
 */

export type ModelTier = "fast" | "strong" | "vision";
/** Which tier to use and, optionally, a provider/model to try first. */
export type ModelRoute = { tier: ModelTier; provider?: string; model?: string };
export type ModelChoice = { mode: "auto" | "fast" | "strong" | "specific"; provider?: string; model?: string };

export type ImageAttachment = { kind: "image"; name: string; mime: string; size: number; dataUrl: string; thumb?: string; width?: number; height?: number };
export type FileAttachment = { kind: "file"; name: string; mime: string; size: number; text: string; chars: number; truncated?: boolean };
export type ChatAttachment = ImageAttachment | FileAttachment;
/** What is kept on the message row: metadata, a small thumbnail, and a capped text excerpt for documents. */
export type StoredAttachment = { kind: "image" | "file"; name: string; mime: string; size: number; thumb?: string; width?: number; height?: number; chars?: number; truncated?: boolean; text?: string };

export const MAX_IMAGES = 4;
export const MAX_FILES = 4;
/** One downscaled image as a data URL (the client resizes to ~1600px, so this is generous). */
export const MAX_IMAGE_DATA_URL = 3_000_000;
export const MAX_THUMB_DATA_URL = 40_000;
/** Document text sent to the model this turn, per file and in total. Free tiers have small token budgets. */
export const FILE_CHARS_PER_DOC = 24_000;
export const FILE_CHARS_TOTAL = 48_000;
/** Document text kept on the stored message so follow-up turns can still see it. */
export const STORED_FILE_CHARS = 24_000;

export const PROVIDER_IDS = ["custom", "cloudflare", "groq", "gemini", "cerebras", "github", "openrouter", "mistral", "huggingface", "qwen"];

/** "auto" | "fast" | "strong" | "<provider>/<model id>" (model ids may contain slashes). */
export function parseChoice(raw: unknown): ModelChoice {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value === "auto") return { mode: "auto" };
  if (value === "fast" || value === "strong") return { mode: value };
  const slash = value.indexOf("/");
  if (slash > 0) {
    const provider = value.slice(0, slash);
    const model = value.slice(slash + 1).trim();
    if (PROVIDER_IDS.includes(provider) && model && model.length <= 200 && !/\s/.test(model)) return { mode: "specific", provider, model };
  }
  return { mode: "auto" };
}

export function choiceId(choice: ModelChoice) {
  return choice.mode === "specific" ? `${choice.provider}/${choice.model}` : choice.mode;
}

const TOOL_HINTS = /\b(e-?mails?|inbox|gmail|calendar|meetings?|schedule|remind(er|ers)?|every (day|morning|evening|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|search|look ?up|find|google|news|prices?|weather|book|order|buy|browse|website|github|repo|plan my day|brief me|remember|forget|send|draft|invite|latest|scores?|flights?|hotels?|directions)\b|https?:\/\/|www\./i;

export type RouteSignals = { text: string; images?: number; files?: number; step?: number; usedTool?: boolean };

/**
 * Auto router. Images need a vision model. Documents, a tool call earlier in the turn, long
 * messages, code, and requests that will likely need tools go to the strong tier. Short plain
 * chat goes to the fast tier.
 */
export function chooseTier(signals: RouteSignals): ModelTier {
  if ((signals.images || 0) > 0) return "vision";
  if ((signals.files || 0) > 0 || signals.usedTool || (signals.step || 0) > 0) return "strong";
  const text = signals.text || "";
  if (text.length > 400 || text.includes("```") || TOOL_HINTS.test(text)) return "strong";
  return "fast";
}

/** Combines the user's choice with this step's signals. A specific model is tried first, then the tier's usual order. */
export function resolveRoute(choice: ModelChoice, signals: RouteSignals): ModelRoute {
  const tier: ModelTier = (signals.images || 0) > 0 ? "vision"
    : choice.mode === "fast" ? "fast"
    : choice.mode === "strong" ? "strong"
    : chooseTier(signals);
  return choice.mode === "specific" ? { tier, provider: choice.provider, model: choice.model } : { tier };
}

const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function cleanName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").trim() : "";
  return (name || fallback).slice(0, 120);
}

/** Validates attachments from the chat request body. Anything malformed is an error, never silently dropped. */
export function sanitizeAttachments(raw: unknown): { attachments: ChatAttachment[]; error?: string } {
  if (raw == null) return { attachments: [] };
  if (!Array.isArray(raw)) return { attachments: [], error: "attachments must be a list." };
  const attachments: ChatAttachment[] = [];
  let images = 0;
  let files = 0;
  for (const item of raw.slice(0, MAX_IMAGES + MAX_FILES + 1)) {
    if (!item || typeof item !== "object") return { attachments: [], error: "Bad attachment." };
    const entry = item as Record<string, unknown>;
    const size = typeof entry.size === "number" && Number.isFinite(entry.size) ? Math.max(0, Math.round(entry.size)) : 0;
    if (entry.kind === "image") {
      images += 1;
      if (images > MAX_IMAGES) return { attachments: [], error: `Attach up to ${MAX_IMAGES} images per message.` };
      const dataUrl = typeof entry.dataUrl === "string" ? entry.dataUrl : "";
      if (!IMAGE_DATA_URL.test(dataUrl)) return { attachments: [], error: "An image couldn't be read. Try attaching it again." };
      if (dataUrl.length > MAX_IMAGE_DATA_URL) return { attachments: [], error: "That image is too large. Try a smaller one." };
      const thumb = typeof entry.thumb === "string" && IMAGE_DATA_URL.test(entry.thumb) && entry.thumb.length <= MAX_THUMB_DATA_URL ? entry.thumb : undefined;
      const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
      attachments.push({ kind: "image", name: cleanName(entry.name, "image"), mime, size, dataUrl, thumb, width: typeof entry.width === "number" ? entry.width : undefined, height: typeof entry.height === "number" ? entry.height : undefined });
    } else if (entry.kind === "file") {
      files += 1;
      if (files > MAX_FILES) return { attachments: [], error: `Attach up to ${MAX_FILES} files per message.` };
      const text = typeof entry.text === "string" ? entry.text : "";
      const chars = typeof entry.chars === "number" ? entry.chars : text.length;
      attachments.push({ kind: "file", name: cleanName(entry.name, "file"), mime: typeof entry.mime === "string" ? entry.mime.slice(0, 120) : "application/octet-stream", size, text: text.slice(0, FILE_CHARS_PER_DOC * 2), chars, truncated: Boolean(entry.truncated) || chars > text.length });
    } else {
      return { attachments: [], error: "Unknown attachment type." };
    }
  }
  return { attachments };
}

/** The document block appended to the user's message for the model. */
export function fileContext(files: Array<{ name: string; text?: string; chars?: number }>, perDoc = FILE_CHARS_PER_DOC, total = FILE_CHARS_TOTAL) {
  let budget = total;
  const blocks: string[] = [];
  for (const file of files) {
    const text = (file.text || "").trim();
    if (!text) { blocks.push(`[Attached file: ${file.name}. No readable text was found in it.]`); continue; }
    const take = Math.max(0, Math.min(perDoc, budget));
    const excerpt = text.slice(0, take);
    budget -= excerpt.length;
    const cut = excerpt.length < text.length || (file.chars || 0) > text.length;
    blocks.push(`[Attached file: ${file.name}${cut ? ` (first ${excerpt.length.toLocaleString("en-US")} of ${(file.chars || text.length).toLocaleString("en-US")} characters)` : ""}]\n<<<\n${excerpt}\n>>>`);
  }
  return blocks.join("\n\n");
}

/** What goes on the stored message: no full-size images, capped document text. */
export function toStored(attachments: ChatAttachment[]): StoredAttachment[] {
  return attachments.map((item) => item.kind === "image"
    ? { kind: "image", name: item.name, mime: item.mime, size: item.size, thumb: item.thumb, width: item.width, height: item.height }
    : { kind: "file", name: item.name, mime: item.mime, size: item.size, chars: item.chars, truncated: item.truncated, text: item.text.slice(0, STORED_FILE_CHARS) });
}

/** "groq/openai/gpt-oss-120b" -> { provider: "groq", model: "gpt-oss-120b" } for the small label under a reply. */
export function modelLabel(value: unknown): { provider: string; model: string } | null {
  if (typeof value !== "string" || !value.includes("/")) return null;
  const slash = value.indexOf("/");
  const provider = value.slice(0, slash);
  const full = value.slice(slash + 1);
  const model = (full.split("/").pop() || full).replace(/:free$/, "");
  return provider && model ? { provider, model } : null;
}
