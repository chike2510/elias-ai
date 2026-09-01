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
    const body = await readJsonRequest<{ prompt?: unknown; type?: unknown; taskId?: unknown; provider?: unknown; width?: unknown; height?: unknown }>(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const type = validType(body.type) ? body.type : "image";
    if (!prompt || prompt.length > 8_000) return jsonError("A prompt between 1 and 8,000 characters is required.", 400);
    const task = typeof body.taskId === "string" && body.taskId ? await getTask(body.taskId) : await createTaskRecord({ objective: `Generate a ${type} asset: ${prompt}`, kind: "media", taskType: "media" });
    if (!task) return jsonError("Generation task not found.", 404);
    await setTaskStatus(task.id, "running");
    await recordTaskEvent(task.id, { kind: "action", label: "Generation job submitted", status: "completed", detail: `Submitting a ${type} generation job through ${body.provider === "pollinations" ? "Pollinations" : "the default free provider"}.` });
    const provider = body.provider === "pollinations" || !body.provider ? "pollinations" : String(body.provider);
    const jobId = await submitGenerationJob(provider, prompt, { type, width: typeof body.width === "number" ? body.width : undefined, height: typeof body.height === "number" ? body.height : undefined });
    let job = await getJobStatus(jobId);
    for (let attempt = 0; attempt < 8 && job && ["queued", "running"].includes(job.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      job = await getJobStatus(jobId);
    }
    if (!job || job.status !== "completed" || !job.assetUrl || !job.mimeType) {
      const message = job?.error || "The generation provider did not complete the job.";
      await recordTaskEvent(task.id, { kind: "error", label: "Generation failed", status: "failed", detail: message });
      await setTaskStatus(task.id, "failed", message);
      return jsonError(message, 502, "GENERATION_FAILED", { taskId: task.id, jobId });
    }
    const assetResponse = await fetch(job.assetUrl, { cache: "no-store" });
    if (!assetResponse.ok) throw new Error(`Generated asset download failed (${assetResponse.status}).`);
    const asset = Buffer.from(await assetResponse.arrayBuffer()).toString("base64");
    const extension = type === "image" ? "jpg" : type === "video" ? "mp4" : "wav";
    const artifactId = `artifact_${crypto.randomUUID()}`;
    const name = `elias-generated-${Date.now()}.${extension}`;
    await updateStoredTask(task.id, (current) => {
      current.artifacts.push({ id: artifactId, taskId: task.id, name, type: artifactMime(name) === "text/plain; charset=utf-8" ? job.mimeType || "application/octet-stream" : job.mimeType || artifactMime(name), encoding: "base64", size: Buffer.byteLength(asset, "base64"), createdAt: Date.now(), preview: `Generated ${type} asset from: ${prompt.slice(0, 500)}`, content: asset });
      current.plan.forEach((step) => { if (["submit", "poll", "deliver"].some((key) => step.id.startsWith(`${key}_`))) step.status = "completed"; });
    });
    await recordTaskEvent(task.id, { kind: "action", label: "Generated asset delivered", status: "completed", detail: `${name} is available in the task artifact pipeline.`, evidence: { type: "artifact", value: { artifactId, name, jobId } } });
    const completed = await setTaskStatus(task.id, "completed");
    return jsonOk({ task: completed, jobId, artifact: { id: artifactId, name, type: job.mimeType } }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Generation failed.");
  }
}
