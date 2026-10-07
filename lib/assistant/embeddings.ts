import { createHash } from "node:crypto";

/**
 * Free text embeddings for memory recall, first available wins:
 *   1. Supabase Edge Function "elias-embed" (Supabase.ai gte-small, 384 dims): needs the project URL
 *      (POSTGRES_SUPABASE_URL / SUPABASE_URL / ELIAS_EMBED_URL) and ELIAS_EMBED_SECRET or the service role key.
 *   2. Gemini text-embedding-004 (GEMINI_API_KEY), asked for 384 dims.
 *   3. Mistral mistral-embed (MISTRAL_API_KEY, free tier), 1024 dims.
 * ELIAS_EMBED_PROVIDER forces one ("supabase" | "gemini" | "mistral" | "hash" | "off"). "hash" is a deterministic
 * offline embedder used only by tests. Each vector is stored with its model name; rows are compared within one model.
 */
export type Embedder = { model: string; embed: (texts: string[]) => Promise<number[][]> };

function supabaseUrl() {
  if (process.env.ELIAS_EMBED_URL) return process.env.ELIAS_EMBED_URL;
  const base = process.env.SUPABASE_URL || process.env.POSTGRES_SUPABASE_URL || process.env.NEXT_PUBLIC_POSTGRES_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/functions/v1/elias-embed` : null;
}

function supabaseAuth() {
  const headers: Record<string, string> = {};
  if (process.env.ELIAS_EMBED_SECRET) headers["x-elias-embed-secret"] = process.env.ELIAS_EMBED_SECRET;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.POSTGRES_SUPABASE_SERVICE_ROLE_KEY;
  if (service) headers.authorization = `Bearer ${service}`;
  return Object.keys(headers).length ? headers : null;
}

async function post<T>(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 12_000): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`embeddings ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

const supabase = (): Embedder | null => {
  const url = supabaseUrl();
  const auth = supabaseAuth();
  if (!url || !auth) return null;
  return { model: "gte-small", embed: async (texts) => (await post<{ embeddings: number[][] }>(url, { inputs: texts }, auth)).embeddings };
};

const gemini = (): Embedder | null => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return {
    model: "gemini-text-embedding-004-384",
    embed: async (texts) => {
      const data = await post<{ embeddings: Array<{ values: number[] }> }>(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${encodeURIComponent(key)}`, {
        requests: texts.map((text) => ({ model: "models/text-embedding-004", content: { parts: [{ text }] }, outputDimensionality: 384 })),
      }, {});
      return data.embeddings.map((item) => item.values);
    },
  };
};

const mistral = (): Embedder | null => {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;
  return { model: "mistral-embed", embed: async (texts) => (await post<{ data: Array<{ embedding: number[] }> }>("https://api.mistral.ai/v1/embeddings", { model: "mistral-embed", input: texts }, { authorization: `Bearer ${key}` })).data.map((item) => item.embedding) };
};

/** Deterministic hashed bag-of-words, for tests only (no network). */
export function hashEmbedding(text: string, dims = 64) {
  const vector = new Array(dims).fill(0) as number[];
  for (const word of text.toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
    const stem = word.replace(/(ing|es|s)$/, "");
    const digest = createHash("sha256").update(stem).digest();
    vector[digest[0] % dims] += 1;
    vector[digest[1] % dims] += 0.5;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

const hash = (): Embedder => ({ model: "hash-64", embed: async (texts) => texts.map((text) => hashEmbedding(text)) });

export function embedder(): Embedder | null {
  const forced = (process.env.ELIAS_EMBED_PROVIDER || "").toLowerCase();
  if (forced === "off") return null;
  if (forced === "hash") return hash();
  if (forced === "supabase") return supabase();
  if (forced === "gemini") return gemini();
  if (forced === "mistral") return mistral();
  return supabase() || gemini() || mistral();
}

/** Best effort: returns null instead of throwing, so memory always works without vectors. */
export async function embedTexts(texts: string[]): Promise<{ model: string; vectors: number[][] } | null> {
  const active = embedder();
  if (!active || !texts.length) return null;
  try {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) vectors.push(...await active.embed(texts.slice(i, i + 16).map((text) => text.slice(0, 2000))));
    return vectors.length === texts.length && vectors.every((vector) => Array.isArray(vector) && vector.length > 0) ? { model: active.model, vectors } : null;
  } catch {
    return null;
  }
}

export const toVectorLiteral = (vector: number[]) => `[${vector.map((value) => Number(value).toFixed(6)).join(",")}]`;
