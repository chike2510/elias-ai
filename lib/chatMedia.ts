"use client";

/** Browser-side helpers for the v3 composer: image downscaling, chunked document upload, voice, read aloud. */
import { ApiError } from "@/lib/chatClient";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1600;
const THUMB_SIDE = 192;
const UPLOAD_PART_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DATA_URL = 2_400_000;

export function isImageFile(file: File) {
  return /^image\/(png|jpe?g|webp|gif|heic|heif|avif|bmp)$/i.test(file.type) || /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp)$/i.test(file.name);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall back to <img> (e.g. HEIC on Safari) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name} isn't an image this browser can open.`);
  }
}

function draw(source: CanvasImageSource, width: number, height: number, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't prepare the image.");
  context.fillStyle = "#fff"; // transparent PNGs become white, not black, as JPEG
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: canvas.width, height: canvas.height };
}

/** Downscales a photo to ~1600px JPEG for the vision model, plus a small thumbnail for history. */
export async function prepareImage(file: File) {
  const bitmap = await loadBitmap(file);
  try {
    let full = draw(bitmap.source, bitmap.width, bitmap.height, IMAGE_MAX_SIDE, 0.85);
    if (full.dataUrl.length > MAX_IMAGE_DATA_URL) full = draw(bitmap.source, bitmap.width, bitmap.height, 1280, 0.72);
    const thumb = draw(bitmap.source, bitmap.width, bitmap.height, THUMB_SIDE, 0.7).dataUrl;
    return { dataUrl: full.dataUrl, thumb, width: full.width, height: full.height };
  } finally { bitmap.close(); }
}

export type ExtractedFile = { name: string; size: number; chars: number; text: string; truncated: boolean; pageCount?: number };

async function postPart(url: string, body: Blob, signal?: AbortSignal) {
  let response: Response;
  try { response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body, signal }); }
  catch (error) { if ((error as Error).name === "AbortError") throw error; throw new ApiError("You seem to be offline. Check your connection and try again.", 0, "OFFLINE"); }
  const data = await response.json().catch(() => null) as ({ ok?: boolean; error?: { message?: string; code?: string } } & Partial<ExtractedFile>) | null;
  if (!response.ok || !data?.ok) throw new ApiError(data?.error?.message || `Upload failed (HTTP ${response.status}).`, response.status, data?.error?.code);
  return data;
}

/** Sends a document to the server for text extraction, in ~3 MB parts so files up to 10 MB fit Vercel's body limit. */
export async function uploadDocument(file: File, signal?: AbortSignal): Promise<ExtractedFile> {
  const parts = Math.max(1, Math.ceil(file.size / UPLOAD_PART_BYTES));
  const upload = `up_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  let result: Awaited<ReturnType<typeof postPart>> | null = null;
  for (let part = 0; part < parts; part += 1) {
    const query = new URLSearchParams({ name: file.name, size: String(file.size), parts: String(parts), part: String(part), upload });
    result = await postPart(`/api/assistant/attachments?${query}`, file.slice(part * UPLOAD_PART_BYTES, (part + 1) * UPLOAD_PART_BYTES), signal);
  }
  return { name: file.name, size: file.size, chars: result?.chars || 0, text: result?.text || "", truncated: Boolean(result?.truncated), pageCount: result?.pageCount };
}

/** Best recording format this browser supports (Safari records mp4/aac, Chrome and Firefox webm/opus). */
export function recorderFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [["audio/webm;codecs=opus", "webm"], ["audio/webm", "webm"], ["audio/mp4", "m4a"], ["audio/ogg;codecs=opus", "ogg"]] as const) {
    try { if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }; } catch { /* keep looking */ }
  }
  return { mime: "", ext: "webm" };
}

export async function transcribe(blob: Blob, ext: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, `voice.${ext}`);
  const language = (typeof navigator !== "undefined" ? navigator.language : "").slice(0, 2).toLowerCase();
  if (/^[a-z]{2}$/.test(language)) form.append("language", language);
  let response: Response;
  try { response = await fetch("/api/assistant/transcribe", { method: "POST", body: form, signal }); }
  catch (error) { if ((error as Error).name === "AbortError") throw error; throw new ApiError("You seem to be offline. Check your connection and try again.", 0, "OFFLINE"); }
  const data = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: { message?: string; code?: string } } | null;
  if (!response.ok || !data?.ok) throw new ApiError(data?.error?.message || `Couldn't transcribe that (HTTP ${response.status}).`, response.status, data?.error?.code);
  return data.text || "";
}

/** Markdown to something pleasant to hear. */
export function speakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}
