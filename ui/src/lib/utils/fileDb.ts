import type { FileEntry } from '$lib/types/fileStore';

const DB_NAME = 'illuminate-files';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let dbInstance: IDBDatabase | null = null;

export function openFileDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('category', 'category', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // Clear cached instance if the connection closes unexpectedly
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
  });
}

export async function getAllFiles(): Promise<FileEntry[]> {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as FileEntry[]);
    request.onerror = () => reject(new Error(`Failed to get all files: ${request.error?.message}`));
  });
}

export async function getFile(id: string): Promise<FileEntry | undefined> {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as FileEntry | undefined);
    request.onerror = () => reject(new Error(`Failed to get file ${id}: ${request.error?.message}`));
  });
}

export async function putFile(entry: FileEntry): Promise<void> {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Failed to put file ${entry.id}: ${request.error?.message}`));
  });
}

export async function deleteFile(id: string): Promise<void> {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Failed to delete file ${id}: ${request.error?.message}`));
  });
}
