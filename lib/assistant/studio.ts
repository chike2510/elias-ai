import { getJobStatus, submitGenerationJob } from "@/lib/generationProviders";

/** Studio image generation: Hugging Face when HF_TOKEN is set, falling back to Pollinations (free, no key). */
export type GeneratedImage = { data: Buffer; mime: string; provider: string; model: string | null };

export const ASPECTS = { square: [1024, 1024], portrait: [832, 1216], landscape: [1216, 832] } as const;
export type Aspect = keyof typeof ASPECTS;

async function attempt(provider: "huggingface" | "pollinations", prompt: string, width: number, height: number): Promise<GeneratedImage> {
  const id = await submitGenerationJob(provider, prompt, { type: "image", width, height });
  let job = await getJobStatus(id);
  for (let i = 0; i < 8 && job && ["queued", "running"].includes(job.status); i += 1) { await new Promise((resolve) => setTimeout(resolve, 350)); job = await getJobStatus(id); }
  if (!job || job.status !== "completed" || (!job.assetUrl && !job.assetData)) throw new Error(job?.error || "The image service didn't finish.");
  if (job.assetData) {
    const [head, body] = job.assetData.split(",", 2);
    return { data: Buffer.from(body, "base64"), mime: head.match(/^data:([^;]+)/)?.[1] || job.mimeType || "image/png", provider, model: job.model || null };
  }
  const response = await fetch(job.assetUrl!, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`The image service answered ${response.status}.`);
  const mime = (response.headers.get("content-type") || job.mimeType || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error("The image service didn't return an image.");
  return { data: Buffer.from(await response.arrayBuffer()), mime, provider, model: job.model || null };
}

export async function generateImage(prompt: string, aspect: Aspect = "square"): Promise<GeneratedImage> {
  const [width, height] = ASPECTS[aspect] || ASPECTS.square;
  const providers: Array<"huggingface" | "pollinations"> = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY ? ["huggingface", "pollinations"] : ["pollinations"];
  let last: unknown = null;
  for (const provider of providers) {
    try { return await attempt(provider, prompt, width, height); } catch (error) { last = error; console.warn(`[studio] ${provider} failed:`, error instanceof Error ? error.message : error); }
  }
  throw last instanceof Error ? last : new Error("Image generation failed.");
}
