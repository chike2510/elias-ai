export type TaskArtifactForLibrary = {
  id: string;
  name: string;
  type?: string;
  size?: number;
  createdAt?: number;
  preview?: string;
};

export type TaskForLibrary = {
  id: string;
  conversationId?: string;
};

export type TaskArtifactLibraryRecord = {
  id: string;
  taskId: string;
  conversationId?: string;
  name: string;
  type: string;
  createdAt: number;
  size: number;
  blob: Blob;
  text?: string;
  summary?: string;
};

export async function syncTaskArtifactToLibrary(
  task: TaskForLibrary,
  artifact: TaskArtifactForLibrary,
  options: {
    fetcher?: typeof fetch;
    save: (record: TaskArtifactLibraryRecord) => Promise<void>;
    maxRetries?: number;
    retryDelayMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
  },
) {
  const fetcher = options.fetcher || fetch;
  const path = `/api/tasks/${encodeURIComponent(task.id)}/artifact/${encodeURIComponent(artifact.id)}`;
  const maxRetries = Math.max(0, Math.min(4, Math.floor(options.maxRetries ?? 2)));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150);
  const wait = options.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let response: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      response = await fetcher(path, { cache: "no-store" });
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await wait(retryDelayMs * (attempt + 1));
      continue;
    }
    if (response.ok) break;
    if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
      await wait(retryDelayMs * (attempt + 1));
      continue;
    }
    throw new Error(`Artifact download failed with HTTP ${response.status}.`);
  }
  if (!response?.ok) throw new Error("Artifact download failed after retrying.");

  const downloaded = await response.blob();
  const type = artifact.type || downloaded.type || "application/octet-stream";
  const blob = downloaded.type === type ? downloaded : downloaded.slice(0, downloaded.size, type);
  const isText = /^(text\/|application\/(?:json|xml|javascript|x-javascript))/i.test(type);
  const text = isText && blob.size <= 1_000_000 ? await blob.text() : undefined;
  const record: TaskArtifactLibraryRecord = {
    id: `task_${task.id}_${artifact.id}`,
    taskId: task.id,
    ...(task.conversationId ? { conversationId: task.conversationId } : {}),
    name: artifact.name,
    type,
    createdAt: artifact.createdAt || Date.now(),
    size: blob.size,
    blob,
    ...(text !== undefined ? { text } : {}),
    ...(artifact.preview ? { summary: artifact.preview.slice(0, 2_000) } : {}),
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      await options.save(record);
      break;
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      await wait(retryDelayMs * (attempt + 1));
    }
  }
  return record;
}
