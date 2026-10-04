export type ScreenshotRecord = {
  id: string;
  name: string;
  category: string;
  note: string;
  tags: string[];
  image: Blob;
  createdAt: string;
};

const databaseName = "elias-screenshot-organizer";
const storeName = "screenshots";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser does not support local screenshot storage."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the local screenshot library."));
  });
}

export async function getScreenshots(): Promise<ScreenshotRecord[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as ScreenshotRecord[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error || new Error("Could not read the local screenshot library."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Could not read the local screenshot library.")); };
  });
}

export async function putScreenshot(record: ScreenshotRecord): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Could not save the screenshot locally.")); };
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error("The local save was cancelled.")); };
  });
}

export async function removeScreenshot(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Could not remove the screenshot locally.")); };
  });
}
