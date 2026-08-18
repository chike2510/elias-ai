export type ChatRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  provider?: string;
  model?: string;
  status?: "complete" | "error";
};

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  messages: ConversationMessage[];
};

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectFileRecord = {
  key: string;
  projectId: string;
  path: string;
  content: string;
  updatedAt: number;
};

export type ArtifactChunkRecord = {
  id: string;
  index: number;
  pageStart: number;
  pageEnd: number;
  text: string;
  summary?: string;
};

export type ArtifactRecord = {
  id: string;
  projectId?: string;
  conversationId?: string;
  name: string;
  type: string;
  createdAt: number;
  blob?: Blob;
  text?: string;
  summary?: string;
  pageCount?: number;
  charCount?: number;
  truncated?: boolean;
  chunks?: ArtifactChunkRecord[];
};

export type ImprovementRecord = {
  id: string;
  kind: "feedback" | "evaluation" | "proposal";
  title: string;
  detail: string;
  status: "open" | "accepted" | "dismissed" | "implemented";
  score?: number;
  source?: string;
  evidence?: string[];
  targetFiles?: string[];
  branch?: string;
  createdAt: number;
  updatedAt: number;
};

const DB_VERSION = 3;

function dbName() {
  if (typeof window === "undefined") return "elias_anonymous";
  try {
    const user = JSON.parse(window.localStorage.getItem("elias.user") || "null") as { userId?: string } | null;
    return user?.userId ? `elias_${user.userId}` : "elias_anonymous";
  } catch {
    return "elias_anonymous";
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = window.indexedDB.open(dbName(), DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("conversations")) db.createObjectStore("conversations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) {
        const store = db.createObjectStore("files", { keyPath: "key" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains("artifacts")) {
        const store = db.createObjectStore("artifacts", { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
      if (!db.objectStoreNames.contains("improvements")) {
        const store = db.createObjectStore("improvements", { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open ELIAS storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function complete<T>(storeName: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void) {
  const db = await openDb();
  const transaction = db.transaction(storeName, mode);
  const result = work(transaction.objectStore(storeName));
  if (result) await requestResult(result);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
  db.close();
}

export async function getConversations() {
  const db = await openDb();
  const transaction = db.transaction("conversations", "readonly");
  const result = await requestResult<ConversationRecord[]>(transaction.objectStore("conversations").getAll());
  db.close();
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string) {
  const db = await openDb();
  const transaction = db.transaction("conversations", "readonly");
  const result = await requestResult<ConversationRecord | undefined>(transaction.objectStore("conversations").get(id));
  db.close();
  return result;
}

export async function saveConversation(record: ConversationRecord) {
  await complete("conversations", "readwrite", (store) => store.put(record));
}

export async function deleteConversation(id: string) {
  await complete("conversations", "readwrite", (store) => store.delete(id));
}

export async function getProjects() {
  const db = await openDb();
  const transaction = db.transaction("projects", "readonly");
  const result = await requestResult<ProjectRecord[]>(transaction.objectStore("projects").getAll());
  db.close();
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string) {
  const db = await openDb();
  const transaction = db.transaction("projects", "readonly");
  const result = await requestResult<ProjectRecord | undefined>(transaction.objectStore("projects").get(id));
  db.close();
  return result;
}

export async function saveProject(record: ProjectRecord) {
  await complete("projects", "readwrite", (store) => store.put(record));
}

export async function deleteProject(id: string) {
  await clearProjectFiles(id);
  await complete("projects", "readwrite", (store) => store.delete(id));
}

export async function getProjectFiles(projectId: string) {
  const db = await openDb();
  const transaction = db.transaction("files", "readonly");
  const result = await requestResult<ProjectFileRecord[]>(transaction.objectStore("files").index("projectId").getAll(projectId));
  db.close();
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export async function saveProjectFiles(files: ProjectFileRecord[]) {
  if (!files.length) return;
  await complete("files", "readwrite", (store) => {
    files.forEach((file) => store.put(file));
  });
}

export async function syncProjectFiles(projectId: string, files: ProjectFileRecord[]) {
  await clearProjectFiles(projectId);
  await saveProjectFiles(files);
}

export async function clearProjectFiles(projectId: string) {
  const db = await openDb();
  const transaction = db.transaction("files", "readwrite");
  const store = transaction.objectStore("files");
  const keys = await requestResult<IDBValidKey[]>(store.index("projectId").getAllKeys(projectId));
  keys.forEach((key) => store.delete(key));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear project files."));
  });
  db.close();
}

export async function getArtifacts(projectId?: string, conversationId?: string) {
  const db = await openDb();
  const transaction = db.transaction("artifacts", "readonly");
  const store = transaction.objectStore("artifacts");
  const result = projectId
    ? await requestResult<ArtifactRecord[]>(store.index("projectId").getAll(projectId))
    : conversationId
      ? await requestResult<ArtifactRecord[]>(store.index("conversationId").getAll(conversationId))
      : await requestResult<ArtifactRecord[]>(store.getAll());
  db.close();
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveArtifact(record: ArtifactRecord) {
  await complete("artifacts", "readwrite", (store) => store.put(record));
}

export async function deleteArtifact(id: string) {
  await complete("artifacts", "readwrite", (store) => store.delete(id));
}

export async function getImprovements() {
  const db = await openDb();
  const transaction = db.transaction("improvements", "readonly");
  const result = await requestResult<ImprovementRecord[]>(transaction.objectStore("improvements").getAll());
  db.close();
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveImprovement(record: ImprovementRecord) {
  await complete("improvements", "readwrite", (store) => store.put(record));
}

export async function deleteImprovement(id: string) {
  await complete("improvements", "readwrite", (store) => store.delete(id));
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
