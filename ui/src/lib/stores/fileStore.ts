/**
 * Shared file pool store for custom IES and spectrum files.
 * Files are auto-persisted to IndexedDB on upload and available
 * across all lamps and page refreshes.
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { FileEntry, FileCategory } from '$lib/types/fileStore';
import { getAllFiles, putFile, deleteFile as dbDeleteFile } from '$lib/utils/fileDb';

const _files = writable<Map<string, FileEntry>>(new Map());
let _initialized = false;

/** Reactive list of all files */
export const allFiles = derived(_files, ($files) => Array.from($files.values()));

/** Reactive list of IES files only */
export const iesFiles = derived(_files, ($files) =>
  Array.from($files.values()).filter((f) => f.category === 'ies')
);

/** Reactive list of spectrum files only */
export const spectrumFiles = derived(_files, ($files) =>
  Array.from($files.values()).filter((f) => f.category === 'spectrum')
);

function generateId(): string {
  return crypto.randomUUID();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g., "data:application/octet-stream;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function base64ToFile(entry: FileEntry): File {
  const binaryString = atob(entry.dataBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new File([bytes], entry.originalFilename, {
    type: entry.extension === '.ies' ? 'application/octet-stream' : 'text/csv',
  });
}

function stripExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.substring(0, lastDot) : filename;
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : '';
}

export const fileStore = {
  /** Load all files from IndexedDB into memory. Call once on app startup. */
  async init(): Promise<void> {
    if (!browser || _initialized) return;
    try {
      const entries = await getAllFiles();
      const map = new Map<string, FileEntry>();
      for (const entry of entries) {
        map.set(entry.id, entry);
      }
      _files.set(map);
      _initialized = true;
      console.log(`[fileStore] Loaded ${entries.length} files from IndexedDB`);
    } catch (e) {
      console.error('[fileStore] Failed to load from IndexedDB:', e);
    }
  },

  /**
   * Add a file to the pool. Auto-persists to IndexedDB.
   * Returns the new FileEntry id.
   */
  async addFile(file: File, category: FileCategory, columnIndex?: number): Promise<string> {
    const dataBase64 = await fileToBase64(file);
    const id = generateId();
    const entry: FileEntry = {
      id,
      category,
      originalFilename: file.name,
      displayName: stripExtension(file.name),
      extension: getExtension(file.name),
      sizeBytes: file.size,
      dataBase64,
      addedAt: new Date().toISOString(),
      spectrumColumnIndex: columnIndex,
    };
    await putFile(entry);
    _files.update((map) => {
      const next = new Map(map);
      next.set(id, entry);
      return next;
    });
    console.log(`[fileStore] Added file: ${entry.displayName} (${category}, ${entry.sizeBytes} bytes)`);
    return id;
  },

  /**
   * Replace an existing file's content (same ID, all lamp refs preserved).
   * Used when a user uploads a file with the same name and chooses "Replace".
   */
  async replaceFile(existingId: string, file: File, columnIndex?: number): Promise<void> {
    const current = get(_files).get(existingId);
    if (!current) throw new Error(`File ${existingId} not found`);

    const dataBase64 = await fileToBase64(file);
    const updated: FileEntry = {
      ...current,
      originalFilename: file.name,
      extension: getExtension(file.name),
      sizeBytes: file.size,
      dataBase64,
      addedAt: new Date().toISOString(),
      spectrumColumnIndex: columnIndex,
    };
    await putFile(updated);
    _files.update((map) => {
      const next = new Map(map);
      next.set(existingId, updated);
      return next;
    });
    console.log(`[fileStore] Replaced file: ${updated.displayName}`);
  },

  /** Get a FileEntry by ID */
  getFile(id: string): FileEntry | undefined {
    return get(_files).get(id);
  },

  /** Get all files of a given category */
  getByCategory(category: FileCategory): FileEntry[] {
    return Array.from(get(_files).values()).filter((f) => f.category === category);
  },

  /**
   * Find a file by original filename and category.
   * Used for duplicate detection on upload.
   */
  findByFilename(filename: string, category: FileCategory): FileEntry | undefined {
    return Array.from(get(_files).values()).find(
      (f) => f.originalFilename === filename && f.category === category
    );
  },

  /** Rename a file's display name. Updates in-memory and IndexedDB. */
  async rename(id: string, newDisplayName: string): Promise<void> {
    const entry = get(_files).get(id);
    if (!entry) return;
    const updated = { ...entry, displayName: newDisplayName };
    await putFile(updated);
    _files.update((map) => {
      const next = new Map(map);
      next.set(id, updated);
      return next;
    });
  },

  /** Delete a file from the pool and IndexedDB. Caller must clear lamp references. */
  async delete(id: string): Promise<void> {
    await dbDeleteFile(id);
    _files.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    console.log(`[fileStore] Deleted file: ${id}`);
  },

  /** Reconstruct a File object from a stored FileEntry for uploading to backend. */
  toFile(id: string): File | null {
    const entry = get(_files).get(id);
    if (!entry) return null;
    return base64ToFile(entry);
  },

  /** Check if store has been initialized */
  isInitialized(): boolean {
    return _initialized;
  },
};
