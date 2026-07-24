import type { CustomLampDef } from '$lib/types/lampLibrary';

const DB_NAME = 'illuminate-lamp-library';
const DB_VERSION = 1;
const STORE_NAME = 'lamps';

let dbInstance: IDBDatabase | null = null;

export function openLampLibraryDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

export async function getAllLamps(): Promise<CustomLampDef[]> {
  const db = await openLampLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as CustomLampDef[]);
    request.onerror = () => reject(new Error(`Failed to get all lamps: ${request.error?.message}`));
  });
}

export async function putLamp(def: CustomLampDef): Promise<void> {
  const db = await openLampLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(def);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Failed to put lamp ${def.id}: ${request.error?.message}`));
  });
}

export async function deleteLamp(id: string): Promise<void> {
  const db = await openLampLibraryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Failed to delete lamp ${id}: ${request.error?.message}`));
  });
}
