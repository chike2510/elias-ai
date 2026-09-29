import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { artifactMime } from "@/lib/artifacts";
import { getJobStatus, submitGenerationJob, type GenerationType } from "@/lib/generationProviders";
import { jsonError, jsonOk, readJsonRequest } from "@/lib/http";
import { createTaskRecord, getTask } from "@/lib/taskOrchestrator";
import { recordTaskEvent, setTaskStatus, updateStoredTask } from "@/lib/taskStore";

export const runtime = "nodejs";
export const maxDuration = 60;

function validType(value: unknown): value is GenerationType { return value === "image" || value === "video" || value === "tts"; }

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return jsonError("Sign in before generating an asset.", 401);
    const body = await readJsonRequest<{ prompt?: unknown; type?: unknown; taskId?: unknown; conversationId?: unknown; provider?: unknown; model?: unknown; width?: unknown; height?: unknown }>(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const type = validType(body.type) ? body.type : "image";
    if (!prompt || prompt.length > 8_000) return jsonError("A prompt between 1 and 8,000 characters is required.", 400);
    const conversationId = typeof body.conversationId === "string" && body.conversationId.trim() && body.conversationId.length <= 200 ? body.conversationId.trim() : undefined;
    const task = typeof body.taskId === "string" && body.taskId ? await getTask(body.taskId) : await createTaskRecord({ objective: `Generate a ${type} asset: ${prompt}`, kind: "media", taskType: "media", ...(conversationId ? { conversationId } : {}) });
    if (!task) return jsonError("Generation task not found.", 404);
    await setTaskStatus(task.id, "running");
    const provider = body.provider === "huggingface" ? "huggingface" : body.provider === "pollinations" ? "pollinations" : process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY ? "huggingface" : "pollinations";
    const providerDetail = provider === "huggingface" ? "Hugging Face Inference Providers (automatically selected image backend)" : "Pollinations";
    const jobId = await submitGenerationJob(provider, prompt, { type, width: typeof body.width === "number" ? body.width : undefined, height: typeof body.height === "number" ? body.height : undefined, model: typeof body.model === "string" ? body.model : undefined });
    let job = await getJobStatus(jobId);
    await recordTaskEvent(task.id, { kind: "action", label: "Generation job submitted", status: "completed", detail: `Submitting a ${type} generation job through provider ${providerDetail}${job?.model ? ` · model ${job.model}` : ""}.` });
    for (let attempt = 0; attempt < 8 && job && ["queued", "running"].includes(job.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      job = await getJobStatus(jobId);
    }
    if (!job || job.status !== "completed" || (!job.assetUrl && !job.assetData) || !job.mimeType) {
      const message = job?.error || "The generation provider did not complete the job.";
      await recordTaskEvent(task.id, { kind: "error", label: "Generation failed", status: "failed", detail: message });
      await setTaskStatus(task.id, "failed", message);
      return jsonError(message, 502, "GENERATION_FAILED", { taskId: task.id, jobId });
    }
    const asset = job.assetData ? job.assetData.split(",", 2)[1] : await (async () => { const assetResponse = await fetch(job.assetUrl!, { cache: "no-store" }); if (!assetResponse.ok) throw new Error(`Generated asset download failed (${assetResponse.status}).`); return Buffer.from(await assetResponse.arrayBuffer()).toString("base64"); })();
    const extension = type === "image" ? job.mimeType === "image/jpeg" ? "jpg" : job.mimeType === "image/webp" ? "webp" : "png" : type === "video" ? "mp4" : "wav";
    const artifactId = `artifact_${crypto.randomUUID()}`;
    const name = `elias-generated-${Date.now()}.${extension}`;
    await updateStoredTask(task.id, (current) => {
      current.artifacts.push({ id: artifactId, taskId: task.id, name, type: artifactMime(name) === "text/plain; charset=utf-8" ? job.mimeType || "application/octet-stream" : job.mimeType || artifactMime(name), encoding: "base64", size: Buffer.byteLength(asset, "base64"), createdAt: Date.now(), preview: `Generated ${type} asset from: ${prompt.slice(0, 500)}`, content: asset });
      current.plan.forEach((step) => { if (["submit", "poll", "deliver"].some((key) => step.id.startsWith(`${key}_`))) step.status = "completed"; });
    });
    await recordTaskEvent(task.id, { kind: "action", label: "Generated asset delivered", status: "completed", detail: `${name} is available in the task artifact pipeline.`, evidence: { type: "artifact", value: { artifactId, name, jobId } } });
    const completed = await setTaskStatus(task.id, "completed");
    return jsonOk({ task: completed, jobId, artifact: { id: artifactId, name, type: job.mimeType, provider: job.provider, model: job.model } }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Generation failed.");
  }
}
