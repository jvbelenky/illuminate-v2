/**
 * Tests for the custom lamp library store (ui/src/lib/stores/lampLibrary.ts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { CustomLampDef } from '$lib/types/lampLibrary';

const PROJECT_STORAGE_KEY = 'illuminate-project-lamps';

const mockGetAllLamps = vi.fn();
const mockPutLamp = vi.fn();
const mockDeleteLamp = vi.fn();
const mockGetLamp = vi.fn();

vi.mock('$lib/utils/lampLibraryDb', () => ({
  getAllLamps: (...args: unknown[]) => mockGetAllLamps(...args),
  putLamp: (...args: unknown[]) => mockPutLamp(...args),
  deleteLamp: (...args: unknown[]) => mockDeleteLamp(...args),
  getLamp: (...args: unknown[]) => mockGetLamp(...args),
}));

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function makeDef(overrides: Partial<Omit<CustomLampDef, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  return {
    name: 'Test Lamp',
    lampType: 'krcl_222' as const,
    ies: { filename: 'test.ies', dataBase64: btoa('IES CONTENT') },
    scope: 'browser' as const,
    contentHash: 'hash-1',
    ...overrides,
  };
}

describe('lampLibrary store', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetAllLamps.mockReset().mockResolvedValue([]);
    mockPutLamp.mockReset().mockResolvedValue(undefined);
    mockDeleteLamp.mockReset().mockResolvedValue(undefined);
    mockGetLamp.mockReset().mockResolvedValue(undefined);
  });

  describe('add', () => {
    it('adds a definition retrievable via get() and the customLamps derived store', async () => {
      const { lampLibrary, customLamps } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({ name: 'Zebra Lamp' }));

      expect(id).toBeTruthy();
      const def = lampLibrary.get(id);
      expect(def).toBeDefined();
      expect(def?.name).toBe('Zebra Lamp');
      expect(def?.createdAt).toBeTruthy();
      expect(def?.updatedAt).toBe(def?.createdAt);

      const all = get(customLamps);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(id);
    });

    it('sorts customLamps by name', async () => {
      const { lampLibrary, customLamps } = await import('./lampLibrary');
      await lampLibrary.add(makeDef({ name: 'Zebra' }));
      await lampLibrary.add(makeDef({ name: 'Apple' }));

      const names = get(customLamps).map((d) => d.name);
      expect(names).toEqual(['Apple', 'Zebra']);
    });

    it('persists a browser-scoped add to IndexedDB', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      await lampLibrary.add(makeDef({ scope: 'browser' }));

      expect(mockPutLamp).toHaveBeenCalledTimes(1);
    });

    it('persists a project-scoped add to sessionStorage, not IndexedDB', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({ scope: 'project' }));

      expect(mockPutLamp).not.toHaveBeenCalled();
      const saved = JSON.parse(sessionStorage.getItem(PROJECT_STORAGE_KEY) ?? '[]');
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe(id);
    });
  });

  describe('update', () => {
    it('bumps updatedAt and preserves id/createdAt', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef());
      const original = lampLibrary.get(id)!;

      vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
      await lampLibrary.update(id, { name: 'Renamed' });

      const updated = lampLibrary.get(id)!;
      expect(updated.id).toBe(id);
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.updatedAt).not.toBe(original.updatedAt);
      expect(updated.name).toBe('Renamed');
      vi.useRealTimers();
    });

    it('is a no-op for an unknown id', async () => {
      const { lampLibrary, customLamps } = await import('./lampLibrary');
      await lampLibrary.update('does-not-exist', { name: 'X' });
      expect(get(customLamps)).toHaveLength(0);
    });

    it('patching a field to undefined clears it (spread semantics drop the value)', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({
        spectrum: { filename: 'spec.csv', dataBase64: btoa('a,b') },
        intensityMap: { filename: 'map.csv', dataBase64: btoa('x,y') },
      }));
      expect(lampLibrary.get(id)?.spectrum).toBeDefined();
      expect(lampLibrary.get(id)?.intensityMap).toBeDefined();

      await lampLibrary.update(id, { spectrum: undefined, intensityMap: undefined });

      const updated = lampLibrary.get(id)!;
      expect(updated.spectrum).toBeUndefined();
      expect(updated.intensityMap).toBeUndefined();
      expect(lampLibrary.toSpectrumFile(id)).toBeNull();
      expect(lampLibrary.toIntensityMapFile(id)).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes a browser-scoped definition from memory and IndexedDB', async () => {
      const { lampLibrary, customLamps } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({ scope: 'browser' }));
      mockDeleteLamp.mockClear();

      await lampLibrary.remove(id);

      expect(lampLibrary.get(id)).toBeUndefined();
      expect(get(customLamps)).toHaveLength(0);
      expect(mockDeleteLamp).toHaveBeenCalledWith(id);
    });

    it('removes a project-scoped definition from sessionStorage', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({ scope: 'project' }));

      await lampLibrary.remove(id);

      expect(sessionStorage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
    });
  });

  describe('setScope', () => {
    it('moving to browser scope writes to IndexedDB and drops from the sessionStorage subset', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({ scope: 'project' }));
      expect(JSON.parse(sessionStorage.getItem(PROJECT_STORAGE_KEY)!)).toHaveLength(1);
      mockPutLamp.mockClear();

      await lampLibrary.setScope(id, 'browser');

      expect(lampLibrary.get(id)?.scope).toBe('browser');
      expect(mockPutLamp).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
    });

    it('moving to project scope removes from IndexedDB and writes to sessionStorage', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef({ scope: 'browser' }));
      mockDeleteLamp.mockClear();

      await lampLibrary.setScope(id, 'project');

      expect(lampLibrary.get(id)?.scope).toBe('project');
      expect(mockDeleteLamp).toHaveBeenCalledWith(id);
      const saved = JSON.parse(sessionStorage.getItem(PROJECT_STORAGE_KEY)!);
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe(id);
    });
  });

  describe('findByHash', () => {
    it('prefers the browser-scoped match when both scopes have the same hash', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const projectId = await lampLibrary.add(makeDef({ scope: 'project', contentHash: 'shared-hash', name: 'Project Copy' }));
      const browserId = await lampLibrary.add(makeDef({ scope: 'browser', contentHash: 'shared-hash', name: 'Browser Copy' }));

      const found = lampLibrary.findByHash('shared-hash');
      expect(found?.id).toBe(browserId);
      expect(found?.id).not.toBe(projectId);
    });

    it('returns undefined when no definition matches', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      expect(lampLibrary.findByHash('nope')).toBeUndefined();
    });
  });

  describe('init', () => {
    it('loads browser-scoped definitions from IndexedDB', async () => {
      const stored: CustomLampDef = {
        id: 'from-db',
        name: 'From DB',
        lampType: 'krcl_222',
        ies: { filename: 'db.ies', dataBase64: 'AA==' },
        scope: 'browser',
        contentHash: 'db-hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      mockGetAllLamps.mockResolvedValue([stored]);

      const { lampLibrary, customLamps } = await import('./lampLibrary');
      await lampLibrary.init(false);

      expect(get(customLamps)).toHaveLength(1);
      expect(lampLibrary.get('from-db')?.name).toBe('From DB');
      expect(lampLibrary.isInitialized()).toBe(true);
    });

    it('init(false) clears the project-scoped sessionStorage key without restoring it', async () => {
      sessionStorage.setItem(
        PROJECT_STORAGE_KEY,
        JSON.stringify([{ id: 'stale', name: 'Stale', lampType: 'other', ies: { filename: 'a.ies', dataBase64: 'AA==' }, scope: 'project', contentHash: 'x', createdAt: 'a', updatedAt: 'a' }])
      );

      const { lampLibrary, customLamps } = await import('./lampLibrary');
      await lampLibrary.init(false);

      expect(sessionStorage.getItem(PROJECT_STORAGE_KEY)).toBeNull();
      expect(get(customLamps)).toHaveLength(0);
    });

    it('init(true) restores project-scoped definitions from sessionStorage', async () => {
      sessionStorage.setItem(
        PROJECT_STORAGE_KEY,
        JSON.stringify([{ id: 'restored', name: 'Restored', lampType: 'other', ies: { filename: 'a.ies', dataBase64: 'AA==' }, scope: 'project', contentHash: 'x', createdAt: 'a', updatedAt: 'a' }])
      );

      const { lampLibrary } = await import('./lampLibrary');
      await lampLibrary.init(true);

      expect(lampLibrary.get('restored')?.name).toBe('Restored');
      expect(sessionStorage.getItem(PROJECT_STORAGE_KEY)).not.toBeNull();
    });

    it('is a no-op the second time it is called', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      await lampLibrary.init(false);
      expect(mockGetAllLamps).toHaveBeenCalledTimes(1);
      await lampLibrary.init(false);
      expect(mockGetAllLamps).toHaveBeenCalledTimes(1);
    });
  });

  describe('toIesFile / toSpectrumFile / toIntensityMapFile', () => {
    it('round-trips filename and content for the IES file', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const content = 'IES FILE BODY';
      const id = await lampLibrary.add(makeDef({ ies: { filename: 'my-lamp.ies', dataBase64: btoa(content) } }));

      const file = lampLibrary.toIesFile(id);
      expect(file).not.toBeNull();
      expect(file!.name).toBe('my-lamp.ies');
      const text = await readFileAsText(file!);
      expect(text).toBe(content);
    });

    it('returns null for an unknown id', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      expect(lampLibrary.toIesFile('nope')).toBeNull();
    });

    it('returns null for spectrum/intensity map when absent, and round-trips when present', async () => {
      const { lampLibrary } = await import('./lampLibrary');
      const id = await lampLibrary.add(makeDef());
      expect(lampLibrary.toSpectrumFile(id)).toBeNull();
      expect(lampLibrary.toIntensityMapFile(id)).toBeNull();

      await lampLibrary.update(id, {
        spectrum: { filename: 'spec.csv', dataBase64: btoa('wavelength,intensity') },
        intensityMap: { filename: 'map.csv', dataBase64: btoa('x,y,z') },
      });

      const spectrumFile = lampLibrary.toSpectrumFile(id);
      expect(spectrumFile?.name).toBe('spec.csv');
      expect(await readFileAsText(spectrumFile!)).toBe('wavelength,intensity');

      const mapFile = lampLibrary.toIntensityMapFile(id);
      expect(mapFile?.name).toBe('map.csv');
      expect(await readFileAsText(mapFile!)).toBe('x,y,z');
    });
  });
});
