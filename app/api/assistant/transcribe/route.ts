import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { reportError, requireUser } from "@/lib/assistant/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 4_400_000; // Vercel caps request bodies at 4.5 MB; the client stops recording at 2 minutes.
const MODELS = [...(process.env.GROQ_WHISPER_MODEL ? [process.env.GROQ_WHISPER_MODEL] : []), "whisper-large-v3-turbo", "whisper-large-v3"];

/** POST multipart { audio: File, language?: string } -> { text }. Groq Whisper (turbo, then large-v3). */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, "chat");
  if ("error" in auth) return auth.error;
  const key = process.env.GROQ_API_KEY;
  if (!key) return jsonError("Voice input isn't set up on this server (GROQ_API_KEY is missing).", 503, "NOT_CONFIGURED");
  let audio: File;
  let language = "";
  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) return jsonError("No audio was sent.", 400, "BAD_REQUEST");
    audio = file;
    const lang = form.get("language");
    if (typeof lang === "string" && /^[a-z]{2}$/.test(lang)) language = lang;
  } catch { return jsonError("Couldn't read the recording.", 400, "BAD_REQUEST"); }
  if (!audio.size) return jsonError("The recording was empty.", 400, "BAD_REQUEST");
  if (audio.size > MAX_AUDIO_BYTES) return jsonError("That recording is too long. Keep voice notes under 2 minutes.", 413, "PAYLOAD_TOO_LARGE");

  const errors: string[] = [];
  for (const model of [...new Set(MODELS)]) {
    const body = new FormData();
    body.append("file", audio, audio.name || "voice.webm");
    body.append("model", model);
    body.append("response_format", "json");
    body.append("temperature", "0");
    if (language) body.append("language", language);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(45_000) });
      const raw = await response.text();
      if (!response.ok) { errors.push(`${model} HTTP ${response.status}: ${raw.slice(0, 200)}`); continue; }
      const data = JSON.parse(raw) as { text?: string };
      return jsonOk({ text: (data.text || "").trim(), model });
    } catch (error) { errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return jsonError(reportError(new Error(`Transcription failed. ${errors.join(" | ")}`), "assistant/transcribe", auth.userId), 502, "TRANSCRIBE_FAILED");
}
