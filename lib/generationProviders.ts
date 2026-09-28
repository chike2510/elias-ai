import { huggingFaceModel } from "@/lib/huggingfaceModels";

export type GenerationType = "image" | "video" | "tts";
export type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

export type GenerationJob = {
  id: string;
  provider: string;
  type: GenerationType;
  status: GenerationJobStatus;
  prompt: string;
  assetUrl?: string;
  assetData?: string;
  mimeType?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, GenerationJob>();

export async function submitGenerationJob(provider: string, prompt: string, params: { type: GenerationType; width?: number; height?: number; model?: string } ) {
  const id = `generation_${crypto.randomUUID()}`;
  const job: GenerationJob = { id, provider, type: params.type, status: "queued", prompt, createdAt: Date.now(), updatedAt: Date.now() };
  jobs.set(id, job);
  if (params.type !== "image") {
    job.status = "failed";
    job.error = `${params.type.toUpperCase()} generation requires a configured hosted or self-hosted provider.`;
    job.updatedAt = Date.now();
    return id;
  }
  const width = Math.min(1536, Math.max(256, Math.round(params.width || 1024)));
  const height = Math.min(1536, Math.max(256, Math.round(params.height || 1024)));
  job.status = "running";
  if (provider === "huggingface") {
    const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    const model = params.model || huggingFaceModel("image-generation", process.env.HF_IMAGE_MODEL) || "Qwen/Qwen-Image";
    if (!token) {
      job.status = "failed";
      job.error = "Hugging Face image generation is not configured. Add HF_TOKEN in Vercel, or disable it to use Pollinations.";
      job.updatedAt = Date.now();
      return id;
    }
    try {
      const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: prompt, parameters: { width, height } }),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
      const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
      job.assetData = `data:${mimeType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
      job.mimeType = mimeType;
      job.status = "completed";
      job.updatedAt = Date.now();
      return id;
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Hugging Face image generation failed.";
      job.updatedAt = Date.now();
      return id;
    }
  }
  if (provider !== "pollinations") {
    job.status = "failed";
    job.error = `Generation provider ${provider} is not configured for images.`;
    job.updatedAt = Date.now();
    return id;
  }
  job.assetUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&enhance=true`;
  job.mimeType = "image/jpeg";
  job.updatedAt = Date.now();
  return id;
}

export async function getJobStatus(id: string) {
  const job = jobs.get(id);
  if (job?.status === "running" && Date.now() - job.updatedAt >= 250) { job.status = "completed"; job.updatedAt = Date.now(); }
  return job;
}
