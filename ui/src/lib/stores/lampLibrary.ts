/**
 * Custom lamp library: self-contained lamp definitions (photometry +
 * spectrum + product fields) persisted either to IndexedDB (`browser`
 * scope, survives across sessions) or to sessionStorage alongside the
 * project (`project` scope, survives tab-idle/timeout recovery, cleared
 * on refresh, per-tab).
 */

import { writable, derived, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { browser } from '$app/environment';
import type { CustomLampDef, EmbeddedFile, LampScope } from '$lib/types/lampLibrary';
import { getAllLamps, putLamp, deleteLamp as dbDeleteLamp } from '$lib/utils/lampLibraryDb';

const PROJECT_STORAGE_KEY = 'illuminate-project-lamps';

const _defs = writable<Map<string, CustomLampDef>>(new Map());
let _initialized = false;
// The in-flight (or settled) init promise, so callers can await load completion
// via ready() without racing a fire-and-forget init() at the call site.
let _readyPromise: Promise<void> | null = null;

/** Reactive list of all custom lamp definitions, sorted by name. */
export const customLamps: Readable<CustomLampDef[]> = derived(_defs, ($defs) =>
  Array.from($defs.values()).sort((a, b) => a.name.localeCompare(b.name))
);

function generateId(): string {
  return crypto.randomUUID();
}

/** Read a File's contents as base64 (no data-URL prefix). */
export function fileToBase64(file: File): Promise<string> {
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

/** Wrap a File as an embedded (base64) file record for a lamp definition. */
export async function fileToEmbedded(file: File): Promise<EmbeddedFile> {
  const dataBase64 = await fileToBase64(file);
  return { filename: file.name, dataBase64 };
}

/**
 * Encode a text string as base64. Unlike raw `btoa`, this is safe for
 * non-Latin1 content (e.g. IES/spectrum text with unicode characters):
 * it goes through `TextEncoder` to get UTF-8 bytes first, so `btoa` only
 * ever sees single-byte character codes.
 */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : '';
}

function mimeTypeForExtension(ext: string): string {
  return ext === '.ies' ? 'application/octet-stream' : 'text/csv';
}

function base64ToFile(embedded: EmbeddedFile): File {
  const binaryString = atob(embedded.dataBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new File([bytes], embedded.filename, {
    type: mimeTypeForExtension(getExtension(embedded.filename)),
  });
}

/** Persist the project-scoped subset of the library to sessionStorage. */
function persistProjectScope(defs: Map<string, CustomLampDef>): void {
  if (!browser) return;
  try {
    const projectDefs = Array.from(defs.values()).filter((d) => d.scope === 'project');
    if (projectDefs.length > 0) {
      sessionStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projectDefs));
    } else {
      sessionStorage.removeItem(PROJECT_STORAGE_KEY);
    }
  } catch (e) {
    console.warn('[lampLibrary] Failed to persist project-scoped lamps to sessionStorage:', e);
  }
}

async function persistToBrowserDb(def: CustomLampDef): Promise<void> {
  try {
    await putLamp(def);
  } catch (e) {
    console.warn('[lampLibrary] Failed to persist lamp to IndexedDB:', e);
  }
}

async function removeFromBrowserDb(id: string): Promise<void> {
  try {
    await dbDeleteLamp(id);
  } catch (e) {
    console.warn('[lampLibrary] Failed to remove lamp from IndexedDB:', e);
  }
}

export const lampLibrary = {
  /** Load all definitions (IndexedDB + optionally sessionStorage) into memory. Call once on app startup. */
  init(restoreProjectScope: boolean): Promise<void> {
    if (!browser) return Promise.resolve();
    // Idempotent: concurrent/repeat calls share the first in-flight promise so
    // ready() resolves exactly when the load that populated `_defs` finished.
    if (_readyPromise) return _readyPromise;

    _readyPromise = (async () => {
      const map = new Map<string, CustomLampDef>();

      try {
        const browserDefs = await getAllLamps();
        for (const def of browserDefs) map.set(def.id, def);
      } catch (e) {
        console.warn('[lampLibrary] Failed to load lamp library from IndexedDB:', e);
      }

      if (restoreProjectScope) {
        try {
          const saved = sessionStorage.getItem(PROJECT_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved) as CustomLampDef[];
            for (const def of parsed) map.set(def.id, def);
          }
        } catch (e) {
          console.warn('[lampLibrary] Failed to restore project-scoped lamps from sessionStorage:', e);
          sessionStorage.removeItem(PROJECT_STORAGE_KEY);
        }
      } else {
        try {
          sessionStorage.removeItem(PROJECT_STORAGE_KEY);
        } catch {
          // ignore — nothing to clean up
        }
      }

      _defs.set(map);
      _initialized = true;
    })();

    return _readyPromise;
  },

  /** Resolves once init()'s load has settled (or immediately if init was never started). */
  ready(): Promise<void> {
    return _readyPromise ?? Promise.resolve();
  },

  /** Add a new lamp definition. Auto-persists to whichever scope it's created in. Returns the new id. */
  async add(def: Omit<CustomLampDef, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();
    const full: CustomLampDef = { ...def, id, createdAt: now, updatedAt: now };

    if (full.scope === 'browser') {
      await persistToBrowserDb(full);
    }

    _defs.update((map) => {
      const next = new Map(map);
      next.set(id, full);
      persistProjectScope(next);
      return next;
    });

    return id;
  },

  /** Patch an existing lamp definition. Bumps `updatedAt`, preserves `id`/`createdAt`. */
  async update(id: string, patch: Partial<Omit<CustomLampDef, 'id' | 'createdAt'>>): Promise<void> {
    const existing = get(_defs).get(id);
    if (!existing) return;

    const updated: CustomLampDef = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (existing.scope !== updated.scope) {
      if (existing.scope === 'browser') await removeFromBrowserDb(id);
      if (updated.scope === 'browser') await persistToBrowserDb(updated);
    } else if (updated.scope === 'browser') {
      await persistToBrowserDb(updated);
    }

    _defs.update((map) => {
      const next = new Map(map);
      next.set(id, updated);
      persistProjectScope(next);
      return next;
    });
  },

  /** Delete a lamp definition from memory and its backing store. */
  async remove(id: string): Promise<void> {
    const existing = get(_defs).get(id);
    if (!existing) return;

    if (existing.scope === 'browser') {
      await removeFromBrowserDb(id);
    }

    _defs.update((map) => {
      const next = new Map(map);
      next.delete(id);
      persistProjectScope(next);
      return next;
    });
  },

  /** Get a lamp definition by id. */
  get(id: string): CustomLampDef | undefined {
    return get(_defs).get(id);
  },

  /** Move a definition between `browser` and `project` scope, relocating its persisted copy. */
  async setScope(id: string, scope: LampScope): Promise<void> {
    await lampLibrary.update(id, { scope });
  },

  /** Find a definition by content hash. Prefers a browser-scoped match if both scopes have one. */
  findByHash(hash: string): CustomLampDef | undefined {
    const matches = Array.from(get(_defs).values()).filter((d) => d.contentHash === hash);
    if (matches.length === 0) return undefined;
    return matches.find((d) => d.scope === 'browser') ?? matches[0];
  },

  /** Reconstruct the IES File for a definition (for uploading to the backend). */
  toIesFile(id: string): File | null {
    const def = get(_defs).get(id);
    if (!def) return null;
    return base64ToFile(def.ies);
  },

  /** Reconstruct the spectrum File for a definition, if any. */
  toSpectrumFile(id: string): File | null {
    const def = get(_defs).get(id);
    if (!def?.spectrum) return null;
    return base64ToFile(def.spectrum);
  },

  /** Reconstruct the intensity-map File for a definition, if any. */
  toIntensityMapFile(id: string): File | null {
    const def = get(_defs).get(id);
    if (!def?.intensityMap) return null;
    return base64ToFile(def.intensityMap);
  },

  /** Check if the library has been initialized. */
  isInitialized(): boolean {
    return _initialized;
  },
};
