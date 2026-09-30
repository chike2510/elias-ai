import { createTask } from "@/lib/task";
import type { TaskRecord, VideoGenerationState } from "@/lib/task";
import { claimVideoArtifactFinalization, createStoredTask, getStoredTask, recordTaskEvent, setTaskStatus, storeTaskArtifactBlob, updateStoredTask } from "@/lib/taskStore";

export const VIDEO_GENERATION_LIMITS = Object.freeze({
  maxPromptChars: 2_000,
  maxDurationSeconds: 4,
  maxDimension: 512,
  maxPixels: 512 * 512,
  maxArtifactBytes: 16 * 1024 * 1024,
  maxJobAgeMs: 20 * 60 * 1_000,
  maxRetries: 2,
  requestTimeoutMs: 10_000,
  artifactTimeoutMs: 30_000,
  finalizationLeaseMs: 60_000,
});

export class VideoGenerationError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryable = false) {
    super(message);
    this.name = "VideoGenerationError";
  }
}

type VideoInput = {
  prompt?: unknown;
  confirmFictionalAdults?: unknown;
  durationSeconds?: unknown;
  width?: unknown;
  height?: unknown;
  image?: unknown;
  imageUrl?: unknown;
  initImage?: unknown;
  sourceImage?: unknown;
};

type ValidVideoInput = { prompt: string; confirmFictionalAdults: true; durationSeconds: number; width: number; height: number };
type WorkerJobStatus = { status: "queued" | "running" | "completed" | "failed"; progress: number; error?: string };

const YOUNG_AGE_PROMPT = /\b(?:child(?:ren)?|kid(?:s)?|teen(?:age|ager)?s?|minor(?:s)?|underage|under\s*18|school[- ]?(?:girl|boy|kid|child)|high[- ]school|middle[- ]school|(?:[0-9]|1[0-7])[- ]year[- ]old|(?:age|aged)\s*(?:[0-9]|1[0-7])|girl(?:s)?|boy(?:s)?|loli|shotacon)\b/i;
const REAL_PERSON_PROMPT = /\b(?:real\s+(?:person|people|human|actor|actress|celebrity|politician)|celebrity|public\s+figure|famous\s+(?:person|actor|singer|athlete)|politician|influencer|look[- ]?alike|deepfake|face\s*swap|likeness\s+of|face\s+of\s+(?:my|a\s+real)|my\s+(?:ex|wife|husband|partner|friend|classmate|coworker|teacher))\b/i;
const HUMAN_SUBJECT_PROMPT = /\b(?:person|people|human|man|woman|men|women|character|portrait|face|body|adult|model|male|female|guy|guys|lady|ladies|gentleman|couple|bride|groom|actor|actress|performer|dancer|he|she|him|her|they)\b/i;
const ADULT_PROMPT = /\b(?:adult|adults|18\s*\+|18\s+or\s+older|over\s+18|aged\s+18|21\s+or\s+older|(?:1[89]|[2-9][0-9])[- ]year[- ]old|(?:1[89]|[2-9][0-9])\s+years?\s+old)\b/i;
const FICTIONAL_PROMPT = /\bfictional\b/i;

export function validateVideoGenerationInput(input: VideoInput): ValidVideoInput {
  if (input.image !== undefined || input.imageUrl !== undefined || input.initImage !== undefined || input.sourceImage !== undefined) {
    throw new VideoGenerationError("Only text-to-video prompts are supported; image-to-video is not available.", 400, "IMAGE_TO_VIDEO_NOT_SUPPORTED");
  }
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > VIDEO_GENERATION_LIMITS.maxPromptChars) {
    throw new VideoGenerationError(`A prompt between 1 and ${VIDEO_GENERATION_LIMITS.maxPromptChars} characters is required.`, 400, "INVALID_PROMPT");
  }
  if (input.confirmFictionalAdults !== true) {
    throw new VideoGenerationError("Confirm that any people shown are fictional adults (18+) before generating.", 400, "FICTIONAL_ADULTS_CONFIRMATION_REQUIRED");
  }
  if (YOUNG_AGE_PROMPT.test(prompt)) {
    throw new VideoGenerationError("Video prompts cannot depict minors or youth-coded characters.", 400, "MINOR_CONTENT_NOT_ALLOWED");
  }
  if (REAL_PERSON_PROMPT.test(prompt)) {
    throw new VideoGenerationError("Video generation is limited to fictional adult characters and cannot target real people or their likenesses.", 400, "REAL_PERSON_TARGET_NOT_ALLOWED");
  }
  if (HUMAN_SUBJECT_PROMPT.test(prompt) && (!FICTIONAL_PROMPT.test(prompt) || !ADULT_PROMPT.test(prompt))) {
    throw new VideoGenerationError("Describe human characters as fictional adults (18+) in the prompt.", 400, "FICTIONAL_ADULT_PROMPT_REQUIRED");
  }
  const durationSeconds = input.durationSeconds === undefined ? 4 : input.durationSeconds;
  const width = input.width === undefined ? 512 : input.width;
  const height = input.height === undefined ? 512 : input.height;
  if (!Number.isInteger(durationSeconds) || Number(durationSeconds) < 1 || Number(durationSeconds) > VIDEO_GENERATION_LIMITS.maxDurationSeconds) {
    throw new VideoGenerationError(`Duration must be between 1 and ${VIDEO_GENERATION_LIMITS.maxDurationSeconds} seconds.`, 400, "INVALID_DURATION");
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 256 || Number(height) < 256 || Number(width) > VIDEO_GENERATION_LIMITS.maxDimension || Number(height) > VIDEO_GENERATION_LIMITS.maxDimension || Number(width) * Number(height) > VIDEO_GENERATION_LIMITS.maxPixels) {
    throw new VideoGenerationError(`Resolution must be at most ${VIDEO_GENERATION_LIMITS.maxDimension}×${VIDEO_GENERATION_LIMITS.maxDimension} pixels.`, 400, "INVALID_RESOLUTION");
  }
  return { prompt, confirmFictionalAdults: true, durationSeconds: Number(durationSeconds), width: Number(width), height: Number(height) };
}

function workerBaseUrl() {
  const raw = process.env.ELIAS_VIDEO_API_URL?.trim();
  if (!raw) throw new VideoGenerationError("Video generation is not configured. Set ELIAS_VIDEO_API_URL to a compatible async worker endpoint.", 503, "VIDEO_PROVIDER_UNAVAILABLE");
  let url: URL;
  try { url = new URL(raw); } catch { throw new VideoGenerationError("ELIAS_VIDEO_API_URL must be an absolute HTTPS URL.", 503, "VIDEO_PROVIDER_CONFIG_INVALID"); }
  const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new VideoGenerationError("ELIAS_VIDEO_API_URL must use HTTPS and must not contain credentials, a query, or a fragment.", 503, "VIDEO_PROVIDER_CONFIG_INVALID");
  }
  return url.toString().replace(/\/+$/, "");
}

export function isVideoProviderConfigured() {
  try { workerBaseUrl(); return true; } catch { return false; }
}

function safeProviderMessage(value: unknown) {
  let text = typeof value === "string" ? value : value instanceof Error ? value.message : "Video worker request failed.";
  const token = process.env.ELIAS_VIDEO_API_TOKEN;
  if (token) text = text.replaceAll(token, "[redacted]");
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[provider URL]")
    .replace(/\b(?:bearer|token|api[-_ ]?key)\s*[:=]?\s*[a-z0-9._~+/-]{8,}/gi, "[credential]")
    .replace(/\b(?:at\s+)?\/(?:home|root|tmp|var|etc|workspace|app)\/[^\s:]*/gi, "[internal path]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 240) || "Video worker request failed.";
}

async function boundedBytes(response: Response, maximum: number) {
  const tooLarge = () => maximum === VIDEO_GENERATION_LIMITS.maxArtifactBytes
    ? new VideoGenerationError("Generated MP4 exceeds the 16 MB storage limit.", 413, "VIDEO_ARTIFACT_TOO_LARGE")
    : new VideoGenerationError("Video worker response exceeds its size limit.", 502, "VIDEO_PROVIDER_RESPONSE_TOO_LARGE");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximum) throw tooLarge();
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw tooLarge();
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function workerRequest(url: string, init: RequestInit = {}, timeoutMs: number = VIDEO_GENERATION_LIMITS.requestTimeoutMs) {
  const token = process.env.ELIAS_VIDEO_API_TOKEN?.trim();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new VideoGenerationError("The configured video worker could not be reached before the request timed out.", 502, "VIDEO_PROVIDER_UNREACHABLE", true);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new VideoGenerationError("The configured video worker endpoint redirected. Set ELIAS_VIDEO_API_URL to its final HTTPS URL.", 502, "VIDEO_PROVIDER_REDIRECT", false);
  }
  return response;
}

async function workerJson(url: string, init: RequestInit = {}) {
  const response = await workerRequest(url, init);
  if (!response.ok) {
    throw new VideoGenerationError(`Video worker returned HTTP ${response.status}.`, 502, `VIDEO_PROVIDER_HTTP_${response.status}`, response.status >= 500 || response.status === 429);
  }
  const bytes = await boundedBytes(response, 64 * 1024);
  try { return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>; }
  catch { throw new VideoGenerationError("Video worker returned an invalid JSON response.", 502, "VIDEO_PROVIDER_INVALID_RESPONSE"); }
}

function parseWorkerStatus(value: Record<string, unknown>): WorkerJobStatus {
  const status = value.status;
  if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed") {
    throw new VideoGenerationError("Video worker returned an unsupported job status.", 502, "VIDEO_PROVIDER_INVALID_STATUS");
  }
  const progress = typeof value.progress === "number" && Number.isFinite(value.progress) ? Math.min(100, Math.max(0, Math.floor(value.progress))) : status === "completed" ? 100 : 0;
  const error = typeof value.error === "string" ? safeProviderMessage(value.error) : undefined;
  return { status, progress, error };
}

async function submitWorkerJob(base: string, state: VideoGenerationState) {
  const value = await workerJson(`${base}/jobs`, {
    method: "POST",
    body: JSON.stringify({
      prompt: state.prompt,
      duration_seconds: state.durationSeconds,
      width: state.width,
      height: state.height,
      ...(process.env.ELIAS_VIDEO_MODEL ? { model: process.env.ELIAS_VIDEO_MODEL } : {}),
      safety: { mode: "fictional_adults_only", require_human_characters_adult: true, allow_image_to_video: false },
    }),
  });
  const jobId = typeof value.job_id === "string" ? value.job_id : typeof value.id === "string" ? value.id : "";
  if (!jobId || jobId.length > 256 || /[\r\n]/.test(jobId)) throw new VideoGenerationError("Video worker did not return a valid job_id.", 502, "VIDEO_PROVIDER_INVALID_JOB");
  return { jobId, status: parseWorkerStatus(value) };
}

async function fetchWorkerStatus(base: string, providerJobId: string) {
  const value = await workerJson(`${base}/jobs/${encodeURIComponent(providerJobId)}`);
  return parseWorkerStatus(value);
}

async function markVideoFailed(taskId: string, message: string) {
  const safeMessage = safeProviderMessage(message);
  await updateStoredTask(taskId, (current) => {
    if (current.videoGeneration) {
      current.videoGeneration.status = "failed";
      current.videoGeneration.error = safeMessage;
      current.videoGeneration.updatedAt = Date.now();
    }
    const activeStep = current.plan.find((step) => step.status === "active") || current.plan.find((step) => step.status === "pending");
    if (activeStep) activeStep.status = "failed";
  });
  await recordTaskEvent(taskId, { kind: "error", label: "Video generation failed", status: "failed", detail: safeMessage });
  return setTaskStatus(taskId, "failed", safeMessage);
}

async function submitIntoTask(task: TaskRecord, state: VideoGenerationState) {
  const base = workerBaseUrl();
  try {
    const submitted = await submitWorkerJob(base, state);
    if (submitted.status.status === "failed") return await markVideoFailed(task.id, submitted.status.error || "Video worker rejected the job.");
    await updateStoredTask(task.id, (current) => {
      if (!current.videoGeneration) return;
      current.videoGeneration.providerJobId = submitted.jobId;
      current.videoGeneration.status = submitted.status.status === "completed" ? "running" : submitted.status.status;
      current.videoGeneration.progress = submitted.status.progress;
      current.videoGeneration.updatedAt = Date.now();
      current.videoGeneration.error = undefined;
      current.videoGeneration.lastPollError = undefined;
      current.plan.forEach((step) => {
        if (step.id.startsWith("submit_")) step.status = "completed";
        else if (step.id.startsWith("poll_")) step.status = "active";
      });
    });
    await recordTaskEvent(task.id, { kind: "action", label: "Video job submitted", status: "completed", detail: `Queued ${state.durationSeconds}-second ${state.width}×${state.height} text-to-video job with the configured worker.` });
    await setTaskStatus(task.id, "running");
  } catch (error) {
    await markVideoFailed(task.id, safeProviderMessage(error));
  }
  return await getStoredTask(task.id);
}

export async function startVideoGeneration(ownerId: string, input: VideoInput) {
  if (!ownerId) throw new VideoGenerationError("Sign in before generating a video.", 401, "AUTH_REQUIRED");
  const valid = validateVideoGenerationInput(input);
  const base = workerBaseUrl();
  const createdAt = Date.now();
  const task = createTask({ objective: `Generate a ${valid.durationSeconds}-second video: ${valid.prompt}`, kind: "media", taskType: "media" });
  task.ownerId = ownerId;
  task.videoGeneration = {
    status: "submitting", prompt: valid.prompt, durationSeconds: valid.durationSeconds, width: valid.width, height: valid.height,
    progress: 0, artifactId: `artifact_${crypto.randomUUID()}`, createdAt, updatedAt: createdAt, retryCount: 0,
  };
  task.plan.forEach((step) => {
    if (step.id.startsWith("understand_") || step.id.startsWith("permission_")) step.status = "completed";
    else if (step.id.startsWith("submit_")) step.status = "active";
  });
  await createStoredTask(task);
  await recordTaskEvent(task.id, { kind: "action", label: "Video generation started", status: "completed", detail: "A bounded text-to-video request was submitted for fictional adult characters only." });
  return await submitIntoTask(task, task.videoGeneration);
}

export async function retryVideoGeneration(taskId: string, ownerId: string, confirmFictionalAdults: unknown) {
  const task = await getStoredTask(taskId);
  if (!task || task.ownerId !== ownerId || !task.videoGeneration) return undefined;
  if (confirmFictionalAdults !== true) throw new VideoGenerationError("Confirm fictional adult characters before retrying.", 400, "FICTIONAL_ADULTS_CONFIRMATION_REQUIRED");
  if (task.videoGeneration.status !== "failed") throw new VideoGenerationError("Only a failed video job can be retried.", 409, "VIDEO_JOB_NOT_RETRYABLE");
  if (task.videoGeneration.retryCount >= VIDEO_GENERATION_LIMITS.maxRetries) throw new VideoGenerationError("This video task has reached its retry limit.", 409, "VIDEO_RETRY_LIMIT_REACHED");
  const state = task.videoGeneration;
  validateVideoGenerationInput({ prompt: state.prompt, confirmFictionalAdults: true, durationSeconds: state.durationSeconds, width: state.width, height: state.height });
  workerBaseUrl();
  const now = Date.now();
  await updateStoredTask(taskId, (current) => {
    const video = current.videoGeneration;
    if (!video) return;
    video.status = "submitting";
    video.providerJobId = undefined;
    video.progress = 0;
    video.error = undefined;
    video.lastPollError = undefined;
    video.lastPolledAt = undefined;
    video.artifactId = `artifact_${crypto.randomUUID()}`;
    video.createdAt = now;
    video.updatedAt = now;
    video.retryCount += 1;
    current.error = undefined;
    current.plan.forEach((step) => {
      if (step.id.startsWith("understand_") || step.id.startsWith("permission_")) step.status = "completed";
      else if (step.id.startsWith("submit_")) step.status = "active";
      else if (step.id.startsWith("poll_") || step.id.startsWith("deliver_")) step.status = "pending";
    });
  });
  await recordTaskEvent(taskId, { kind: "action", label: "Video generation retry started", status: "completed", detail: `Retry ${state.retryCount + 1} of ${VIDEO_GENERATION_LIMITS.maxRetries}.` });
  await setTaskStatus(taskId, "running");
  const updated = await getStoredTask(taskId);
  if (!updated?.videoGeneration) return undefined;
  return await submitIntoTask(updated, updated.videoGeneration);
}

async function downloadWorkerArtifact(base: string, providerJobId: string) {
  const response = await workerRequest(`${base}/jobs/${encodeURIComponent(providerJobId)}/artifact`, {}, VIDEO_GENERATION_LIMITS.artifactTimeoutMs);
  if (!response.ok) throw new VideoGenerationError(`Video worker artifact download failed with HTTP ${response.status}.`, 502, "VIDEO_ARTIFACT_DOWNLOAD_FAILED", response.status >= 500 || response.status === 429);
  const type = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "video/mp4") throw new VideoGenerationError("Video worker artifact must be served as video/mp4.", 502, "VIDEO_ARTIFACT_INVALID_TYPE");
  const bytes = await boundedBytes(response, VIDEO_GENERATION_LIMITS.maxArtifactBytes);
  if (bytes.byteLength < 12 || !bytes.subarray(4, Math.min(bytes.byteLength, 64)).includes(Buffer.from("ftyp"))) {
    throw new VideoGenerationError("Video worker artifact did not contain a valid MP4 file signature.", 502, "VIDEO_ARTIFACT_INVALID_MP4");
  }
  return bytes;
}

async function storeCompletedVideo(task: TaskRecord, ownerId: string, providerJobId: string) {
  const state = task.videoGeneration!;
  const base = workerBaseUrl();
  const bytes = await downloadWorkerArtifact(base, providerJobId);
  await storeTaskArtifactBlob(task.id, state.artifactId, ownerId, "video/mp4", bytes);
  const createdAt = Date.now();
  const name = `elias-video-${createdAt}.mp4`;
  await updateStoredTask(task.id, (current) => {
    const video = current.videoGeneration;
    if (!video) return;
    if (!current.artifacts.some((artifact) => artifact.id === video.artifactId)) {
      current.artifacts.push({ id: video.artifactId, taskId: current.id, name, type: "video/mp4", size: bytes.byteLength, createdAt, preview: `Generated ${video.durationSeconds}-second fictional-adult text-to-video output.` });
    }
    video.status = "completed";
    video.progress = 100;
    video.updatedAt = createdAt;
    video.error = undefined;
    video.lastPollError = undefined;
    current.plan.forEach((step) => { step.status = "completed"; });
  });
  await recordTaskEvent(task.id, { kind: "action", label: "MP4 artifact stored", status: "completed", detail: `${name} was stored in the task artifact pipeline.`, evidence: { type: "artifact", value: { artifactId: state.artifactId, name, mimeType: "video/mp4", size: bytes.byteLength } } });
  await setTaskStatus(task.id, "completed");
  return await getStoredTask(task.id);
}

export async function pollVideoGeneration(taskId: string, ownerId: string) {
  let task = await getStoredTask(taskId);
  if (!task || task.ownerId !== ownerId || !task.videoGeneration) return undefined;
  let state = task.videoGeneration;
  if (state.status === "completed" || state.status === "failed") return task;
  if (Date.now() - state.createdAt > VIDEO_GENERATION_LIMITS.maxJobAgeMs) {
    return await markVideoFailed(taskId, "Video generation exceeded the 20-minute job limit.");
  }
  if (state.status === "finalizing") {
    if (Date.now() - state.updatedAt < VIDEO_GENERATION_LIMITS.finalizationLeaseMs) return task;
    await updateStoredTask(taskId, (current) => {
      if (current.videoGeneration?.status === "finalizing") {
        current.videoGeneration.status = "running";
        current.videoGeneration.updatedAt = Date.now();
      }
    });
    task = await getStoredTask(taskId);
    if (!task?.videoGeneration) return undefined;
    state = task.videoGeneration;
  }
  if (!state.providerJobId) return task;
  let base: string;
  try { base = workerBaseUrl(); }
  catch (error) { return await markVideoFailed(taskId, safeProviderMessage(error)); }
  try {
    const currentStatus = await fetchWorkerStatus(base, state.providerJobId);
    if (currentStatus.status === "failed") return await markVideoFailed(taskId, currentStatus.error || "Video worker reported a terminal failure.");
    if (currentStatus.status === "completed") {
      const claimed = await claimVideoArtifactFinalization(taskId, ownerId, state.providerJobId);
      if (!claimed) return await getStoredTask(taskId);
      return await storeCompletedVideo(claimed, ownerId, state.providerJobId);
    }
    await updateStoredTask(taskId, (current) => {
      if (!current.videoGeneration) return;
      current.videoGeneration.status = currentStatus.status;
      current.videoGeneration.progress = currentStatus.progress;
      current.videoGeneration.updatedAt = Date.now();
      current.videoGeneration.lastPolledAt = Date.now();
      current.videoGeneration.lastPollError = undefined;
    });
    await setTaskStatus(taskId, "running");
  } catch (error) {
    const transient = error instanceof VideoGenerationError && error.retryable;
    if (!transient) return await markVideoFailed(taskId, safeProviderMessage(error));
    await updateStoredTask(taskId, (current) => {
      if (!current.videoGeneration) return;
      if (current.videoGeneration.status === "finalizing") current.videoGeneration.status = "running";
      current.videoGeneration.lastPollError = safeProviderMessage(error);
      current.videoGeneration.lastPolledAt = Date.now();
      current.videoGeneration.updatedAt = Date.now();
    });
  }
  return await getStoredTask(taskId);
}

export function publicVideoState(task: TaskRecord) {
  const video = task.videoGeneration;
  if (!video) return undefined;
  return {
    status: video.status,
    progress: video.progress,
    durationSeconds: video.durationSeconds,
    width: video.width,
    height: video.height,
    retryCount: video.retryCount,
    error: video.error,
    lastPollError: video.lastPollError,
    artifact: video.status === "completed" ? task.artifacts.find((artifact) => artifact.id === video.artifactId) : undefined,
  };
}
