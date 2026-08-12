"use client";

export type ChatRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  provider?: string;
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

export type ArtifactRecord = {
  id: string;
  projectId?: string;
  conversationId?: string;
  name: string;
  type: string;
  createdAt: number;
  blob?: Blob;
  text?: string;
};

const DB_NAME = "elias";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("conversations")) {
        db.createObjectStore("conversations", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("files")) {
        const store = db.createObjectStore("files", { keyPath: "key" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains("artifacts")) {
        const store = db.createObjectStore("artifacts", { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
        store.createIndex("conversationId", "conversationId", { unique: false });
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

export async function getConversations(): Promise<ConversationRecord[]> {
  const db = await openDb();
  const tx = db.transaction("conversations", "readonly");
  const result = await requestResult<ConversationRecord[]>(tx.objectStore("conversations").getAll());
  db.close();
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<ConversationRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction("conversations", "readonly");
  const result = await requestResult<ConversationRecord | undefined>(tx.objectStore("conversations").get(id));
  db.close();
  return result;
}

export async function saveConversation(record: ConversationRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("conversations", "readwrite");
  tx.objectStore("conversations").put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save conversation."));
  });
  db.close();
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("conversations", "readwrite");
  tx.objectStore("conversations").delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not delete conversation."));
  });
  db.close();
}

export async function getProjects(): Promise<ProjectRecord[]> {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const result = await requestResult<ProjectRecord[]>(tx.objectStore("projects").getAll());
  db.close();
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const result = await requestResult<ProjectRecord | undefined>(tx.objectStore("projects").get(id));
  db.close();
  return result;
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("projects", "readwrite");
  tx.objectStore("projects").put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save project."));
  });
  db.close();
}

export async function getProjectFiles(projectId: string): Promise<ProjectFileRecord[]> {
  const db = await openDb();
  const tx = db.transaction("files", "readonly");
  const index = tx.objectStore("files").index("projectId");
  const result = await requestResult<ProjectFileRecord[]>(index.getAll(projectId));
  db.close();
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export async function saveProjectFiles(files: ProjectFileRecord[]): Promise<void> {
  if (!files.length) return;
  const db = await openDb();
  const tx = db.transaction("files", "readwrite");
  const store = tx.objectStore("files");
  for (const file of files) store.put(file);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save project files."));
  });
  db.close();
}


export async function syncProjectFiles(projectId: string, files: ProjectFileRecord[]): Promise<void> {
  await clearProjectFiles(projectId);
  await saveProjectFiles(files);
}

export async function clearProjectFiles(projectId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("files", "readwrite");
  const index = tx.objectStore("files").index("projectId");
  const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(projectId));
  for (const key of keys) tx.objectStore("files").delete(key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear project files."));
  });
  db.close();
}

export async function getArtifacts(projectId?: string, conversationId?: string): Promise<ArtifactRecord[]> {
  const db = await openDb();
  const tx = db.transaction("artifacts", "readonly");
  const store = tx.objectStore("artifacts");

  let result: ArtifactRecord[];
  if (projectId) {
    result = await requestResult<ArtifactRecord[]>(store.index("projectId").getAll(projectId));
  } else if (conversationId) {
    result = await requestResult<ArtifactRecord[]>(store.index("conversationId").getAll(conversationId));
  } else {
    result = await requestResult<ArtifactRecord[]>(store.getAll());
  }

  db.close();
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveArtifact(record: ArtifactRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("artifacts", "readwrite");
  tx.objectStore("artifacts").put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save artifact."));
  });
  db.close();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
