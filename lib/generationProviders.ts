export type GenerationType = "image" | "video" | "tts";
export type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

export type GenerationJob = {
  id: string;
  provider: string;
  type: GenerationType;
  status: GenerationJobStatus;
  prompt: string;
  assetUrl?: string;
  mimeType?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, GenerationJob>();

export async function submitGenerationJob(provider: string, prompt: string, params: { type: GenerationType; width?: number; height?: number } ) {
  const id = `generation_${crypto.randomUUID()}`;
  const job: GenerationJob = { id, provider, type: params.type, status: "queued", prompt, createdAt: Date.now(), updatedAt: Date.now() };
  jobs.set(id, job);
  if (provider !== "pollinations" || params.type !== "image") {
    job.status = "failed";
    job.error = params.type === "image" ? `Generation provider ${provider} is not configured.` : `${params.type.toUpperCase()} generation requires a configured hosted or self-hosted provider.`;
    job.updatedAt = Date.now();
    return id;
  }
  const width = Math.min(1536, Math.max(256, Math.round(params.width || 1024)));
  const height = Math.min(1536, Math.max(256, Math.round(params.height || 1024)));
  job.status = "running";
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
