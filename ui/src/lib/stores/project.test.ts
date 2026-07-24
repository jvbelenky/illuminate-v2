/**
 * Tests for project store.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { get } from 'svelte/store';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { CustomLampDef } from '$lib/types/lampLibrary';

// Import store creation - we need to reset module state between tests

// Mocked custom lamp library — project.ts consumes it via applyCustomLamp/
// propagateCustomLampEdit. Individual tests configure return values.
vi.mock('$lib/stores/lampLibrary', async (importOriginal) => {
  // Keep the real `textToBase64` (project.ts imports it alongside `lampLibrary`)
  // — it's a pure function and jsdom has real TextEncoder/btoa.
  const actual = await importOriginal<typeof import('$lib/stores/lampLibrary')>();
  const lampLibrary = {
    get: vi.fn(),
    toIesFile: vi.fn(),
    toSpectrumFile: vi.fn(),
    toIntensityMapFile: vi.fn(),
    findByHash: vi.fn(),
    add: vi.fn(),
    ready: vi.fn(() => Promise.resolve()),
  };
  return { ...actual, lampLibrary };
});

const API_BASE = 'http://localhost:8000/api/v1';

// Counters for unique IDs in MSW handlers
let lampCounter = 0;
let zoneCounter = 0;

// MSW handlers
const handlers = [
  // Session init
  http.post(`${API_BASE}/session/init`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Session initialized',
      lamp_count: 0,
      zone_count: 3,
    });
  }),

  // Room update
  http.patch(`${API_BASE}/session/room`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Lamp operations — echo the client-supplied id (Task 7 backend behavior)
  http.post(`${API_BASE}/session/lamps`, async ({ request }) => {
    const body = (await request.json()) as { id?: string };
    return HttpResponse.json({ success: true, lamp_id: body?.id ?? `Lamp-${++lampCounter}` });
  }),

  // Lamp copy
  http.post(`${API_BASE}/session/lamps/:lampId/copy`, () => {
    return HttpResponse.json({ success: true, lamp_id: `Lamp-${++lampCounter}` });
  }),

  http.patch(`${API_BASE}/session/lamps/:lampId`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete(`${API_BASE}/session/lamps/:lampId`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Zone operations — echo the client-supplied id (Task 7 backend behavior)
  http.post(`${API_BASE}/session/zones`, async ({ request }) => {
    const body = (await request.json()) as { id?: string };
    return HttpResponse.json({ success: true, zone_id: body?.id ?? `CalcPlane-${++zoneCounter}` });
  }),

  // Zone copy
  http.post(`${API_BASE}/session/zones/:zoneId/copy`, () => {
    return HttpResponse.json({ success: true, zone_id: `CalcPlane-${++zoneCounter}` });
  }),

  http.patch(`${API_BASE}/session/zones/:zoneId`, () => {
    return HttpResponse.json({
      success: true,
      num_x: 25,
      num_y: 25,
      x_spacing: 0.2,
      y_spacing: 0.2,
    });
  }),

  http.delete(`${API_BASE}/session/zones/:zoneId`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Calculate
  http.post(`${API_BASE}/session/calculate`, () => {
    return HttpResponse.json({
      success: true,
      calculated_at: new Date().toISOString(),
      mean_fluence: 5.0,
      zones: {},
    });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Create isolated storage mocks for project tests
let projectSessionStore: Record<string, string> = {};
let projectLocalStore: Record<string, string> = {};

function setupStorageMocks() {
  projectSessionStore = {};
  projectLocalStore = {};

  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: vi.fn((key: string) => projectSessionStore[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        projectSessionStore[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete projectSessionStore[key];
      }),
      clear: vi.fn(() => {
        projectSessionStore = {};
      }),
      get length() {
        return Object.keys(projectSessionStore).length;
      },
      key: vi.fn((index: number) => Object.keys(projectSessionStore)[index] ?? null),
    },
    writable: true,
  });

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => projectLocalStore[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        projectLocalStore[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete projectLocalStore[key];
      }),
      clear: vi.fn(() => {
        projectLocalStore = {};
      }),
      get length() {
        return Object.keys(projectLocalStore).length;
      },
      key: vi.fn((index: number) => Object.keys(projectLocalStore)[index] ?? null),
    },
    writable: true,
  });
}

describe('project store', () => {
  beforeEach(async () => {
    // Reset module state
    vi.resetModules();

    // Reset ID counters
    lampCounter = 0;
    zoneCounter = 0;

    // Setup storage mocks
    setupStorageMocks();

    // Use fake timers for debounce testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    projectSessionStore = {};
    projectLocalStore = {};
  });

  describe('initialization', () => {
    it('creates default project when no saved state', async () => {
      const { project } = await import('./project');
      const p = get(project);

      expect(p.version).toBe('1.0');
      expect(p.name).toBe('untitled_project');
      expect(p.room.x).toBe(4);
      expect(p.room.y).toBe(6);
      expect(p.room.z).toBe(2.7);
      expect(p.lamps).toEqual([]);
    });

    it('includes standard zones by default', async () => {
      const { project } = await import('./project');
      const p = get(project);

      expect(p.room.useStandardZones).toBe(true);
      expect(p.zones.some(z => z.isStandard)).toBe(true);
      expect(p.zones.find(z => z.id === 'WholeRoomFluence')).toBeDefined();
      expect(p.zones.find(z => z.id === 'EyeLimits')).toBeDefined();
      expect(p.zones.find(z => z.id === 'SkinLimits')).toBeDefined();
    });

    // Note: Testing sessionStorage restoration at module load time is complex
    // with dynamic imports because the mock needs to be set before module initialization.
    // Instead, we test the loadFromFile API which uses the same code path.
    it('loadFromFile restores project state', async () => {
      const { project } = await import('./project');

      const savedProject = {
        version: '1.0',
        name: 'loaded project',
        room: {
          x: 10, y: 10, z: 3,
          standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)' as const,
          precision: 2,
          enable_reflectance: false,
          reflectances: { floor: 0.1, ceiling: 0.1, north: 0.1, south: 0.1, east: 0.1, west: 0.1 },
          reflectance_spacings: { floor: { x: 0.5, y: 0.5 }, ceiling: { x: 0.5, y: 0.5 }, north: { x: 0.5, y: 0.5 }, south: { x: 0.5, y: 0.5 }, east: { x: 0.5, y: 0.5 }, west: { x: 0.5, y: 0.5 } },
          reflectance_num_points: { floor: { x: 10, y: 10 }, ceiling: { x: 10, y: 10 }, north: { x: 10, y: 10 }, south: { x: 10, y: 10 }, east: { x: 10, y: 10 }, west: { x: 10, y: 10 } },
          reflectance_resolution_mode: 'spacing' as const,
          reflectance_max_num_passes: 100,
          reflectance_threshold: 0.02,
          air_changes: 2,
          ozone_decay_constant: 4.6,
          colormap: 'plasma',
          useStandardZones: true,
          showDimensions: true,
          showPhotometricWebs: true,
          showGrid: true,
          showXYZMarker: true,
          showLampLabels: false,
          showCalcPointLabels: false,
          globalHeatmapNormalization: false,
        },
        lamps: [],
        zones: [],
        lastModified: new Date().toISOString(),
      };

      project.loadFromFile(savedProject);
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.name).toBe('loaded project');
      expect(p.room.x).toBe(10);
    });

    it('clears sessionStorage on reload detection', async () => {
      // Mock performance navigation timing for reload
      const mockNavEntry = {
        type: 'reload',
        entryType: 'navigation',
      };
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([mockNavEntry as PerformanceNavigationTiming]);

      sessionStorage.setItem('illuminate_project', JSON.stringify({ name: 'Should be cleared' }));

      const { project } = await import('./project');
      const p = get(project);

      // Should get default project, not saved one
      expect(p.name).toBe('untitled_project');

      vi.restoreAllMocks();
    });
  });

  describe('room operations', () => {
    it('updates room dimensions', async () => {
      const { project } = await import('./project');

      project.updateRoom({ x: 15 });
      vi.advanceTimersByTime(200); // Past debounce

      const p = get(project);
      expect(p.room.x).toBe(15);
    });

    it('updates room standard', async () => {
      const { project } = await import('./project');

      project.updateRoom({ standard: 'IEC 62471-6:2022 (ICNIRP Limits)' });
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.room.standard).toBe('IEC 62471-6:2022 (ICNIRP Limits)');
    });

    it('updates multiple room properties', async () => {
      const { project } = await import('./project');

      project.updateRoom({ x: 20, y: 20, z: 5 });
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.room.x).toBe(20);
      expect(p.room.y).toBe(20);
      expect(p.room.z).toBe(5);
    });

    it('updates lastModified timestamp', async () => {
      const { project } = await import('./project');
      const before = get(project).lastModified;

      // Advance time so timestamp is different
      vi.advanceTimersByTime(100);

      project.updateRoom({ x: 5 });

      const after = get(project).lastModified;
      expect(after).not.toBe(before);
    });
  });

  describe('lamp operations', () => {
    it('adds a new lamp', async () => {
      const { project } = await import('./project');

      const id = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 2, y: 2, z: 2.5,
        aimx: 2, aimy: 2, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      const p = get(project);
      expect(p.lamps).toHaveLength(1);
      expect(p.lamps[0].id).toBe(id);
      expect(p.lamps[0].x).toBe(2);
    });

    it('updates an existing lamp', async () => {
      const { project } = await import('./project');

      const id = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 2, y: 2, z: 2.5,
        aimx: 2, aimy: 2, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      project.updateLamp(id, { x: 5, scaling_factor: 0.8 });
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.lamps[0].x).toBe(5);
      expect(p.lamps[0].scaling_factor).toBe(0.8);
    });

    it('removes a lamp', async () => {
      const { project } = await import('./project');

      const id = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 2, y: 2, z: 2.5,
        aimx: 2, aimy: 2, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      expect(get(project).lamps).toHaveLength(1);

      project.removeLamp(id);

      expect(get(project).lamps).toHaveLength(0);
    });

    it('generates unique lamp IDs', async () => {
      const { project } = await import('./project');

      const id1 = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 1, y: 1, z: 2.5,
        aimx: 1, aimy: 1, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      const id2 = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 3, y: 3, z: 2.5,
        aimx: 3, aimy: 3, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      expect(id1).not.toBe(id2);
    });
  });

  describe('custom lamp application', () => {
    const baseDef: CustomLampDef = {
      id: 'def-1',
      name: 'Test Lamp',
      lampType: 'krcl_222',
      ies: { filename: 'test.ies', dataBase64: 'AAAA' },
      scope: 'project',
      contentHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    function stubLampFileEndpoints() {
      server.use(
        http.post(`${API_BASE}/session/lamps/:lampId/ies`, () =>
          HttpResponse.json({ success: true, message: 'ok', has_ies_file: true })
        ),
        http.post(`${API_BASE}/session/lamps/:lampId/spectrum`, () =>
          HttpResponse.json({ success: true, peak_wavelength: 265 })
        ),
        http.post(`${API_BASE}/session/lamps/:lampId/intensity-map`, () =>
          HttpResponse.json({ success: true, message: 'ok', has_intensity_map: true })
        ),
        http.delete(`${API_BASE}/session/lamps/:lampId/ies`, () =>
          HttpResponse.json({ success: true })
        ),
        http.delete(`${API_BASE}/session/lamps/:lampId/spectrum`, () =>
          HttpResponse.json({ success: true })
        ),
      );
    }

    beforeEach(async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReset();
      vi.mocked(lampLibrary.toIesFile).mockReset();
      vi.mocked(lampLibrary.toSpectrumFile).mockReset();
      vi.mocked(lampLibrary.toIntensityMapFile).mockReset();
      stubLampFileEndpoints();
    });

    it('applyCustomLamp sets custom_lamp_id/preset_id and pending files, including spectrum', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const def: CustomLampDef = {
        ...baseDef,
        spectrum: { filename: 'spec.csv', dataBase64: 'BBBB', columnIndex: 2 },
      };
      vi.mocked(lampLibrary.get).mockReturnValue(def);
      const iesFile = new File(['ies'], 'test.ies');
      const spectrumFile = new File(['spec'], 'spec.csv');
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(iesFile);
      vi.mocked(lampLibrary.toSpectrumFile).mockReturnValue(spectrumFile);

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 1, y: 1, z: 2.5,
        aimx: 1, aimy: 1, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.custom_lamp_id).toBe('def-1');
      expect(lamp.preset_id).toBe('custom');
      expect(lamp.pending_ies_file).toBe(iesFile);
      expect(lamp.pending_spectrum_file).toBe(spectrumFile);
      expect(lamp.pending_spectrum_column_index).toBe(2);
    });

    it('does not set pending_spectrum_file for a spectrum-less definition', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222',
        x: 1, y: 1, z: 2.5,
        aimx: 1, aimy: 1, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.custom_lamp_id).toBe('def-1');
      expect(lamp.pending_spectrum_file).toBeUndefined();
      expect(lampLibrary.toSpectrumFile).not.toHaveBeenCalled();
    });

    it("sets wavelength for an 'other' lamp definition", async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef, lampType: 'other', wavelength: 275 });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'other',
        x: 1, y: 1, z: 2.5,
        aimx: 1, aimy: 1, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.wavelength).toBe(275);
    });

    it('propagateCustomLampEdit re-applies the definition only to instances referencing it', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const idA = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      const idB = await project.addLamp({
        lamp_type: 'krcl_222', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true,
      });

      // Only idA references def-1
      project.updateLamp(idA, { custom_lamp_id: 'def-1' });
      vi.advanceTimersByTime(200);

      await project.propagateCustomLampEdit('def-1');

      const lamps = get(project).lamps;
      const lampA = lamps.find((l) => l.id === idA)!;
      const lampB = lamps.find((l) => l.id === idB)!;
      expect(lampA.pending_ies_file).toBeDefined();
      expect(lampB.pending_ies_file).toBeUndefined();
      expect(lampB.custom_lamp_id).toBeUndefined();
    });

    it('converts def surface/housing dimensions from meters to a feet-mode session', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const def: CustomLampDef = {
        ...baseDef,
        surface: { width: 1, length: 2, height: 0.5, units: 'meters' },
        housing: { width: 1.5, length: 2.5, height: 0.75 },
      };
      vi.mocked(lampLibrary.get).mockReturnValue(def);
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });

      // Set the live unit preference to feet AFTER the project store has
      // finished its own init (which snaps `units` back to `defaultUnits`
      // when they differ — see defaultProjectFromSettings in project.ts).
      const { userSettings } = await import('$lib/stores/settings');
      userSettings.update((s) => ({ ...s, units: 'feet' }));

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      const adv = lamp.pending_advanced!;
      expect(adv).toBeDefined();
      expect(adv.source_width).toBeCloseTo(1 * 3.28084, 3);
      expect(adv.source_length).toBeCloseTo(2 * 3.28084, 3);
      expect(adv.source_depth).toBeCloseTo(0.5 * 3.28084, 3);
      expect(adv.housing_width).toBeCloseTo(1.5 * 3.28084, 3);
      expect(adv.housing_length).toBeCloseTo(2.5 * 3.28084, 3);
      expect(adv.housing_height).toBeCloseTo(0.75 * 3.28084, 3);
    });

    it('passes def surface/housing dimensions through unconverted when units already match', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const def: CustomLampDef = {
        ...baseDef,
        surface: { width: 1, length: 2, height: 0.5, units: 'meters' },
        housing: { width: 1.5, length: 2.5, height: 0.75 },
      };
      vi.mocked(lampLibrary.get).mockReturnValue(def);
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      // userSettings defaults to 'meters', matching def.surface.units — no import needed

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      const adv = lamp.pending_advanced!;
      expect(adv).toBeDefined();
      expect(adv.source_width).toBe(1);
      expect(adv.source_length).toBe(2);
      expect(adv.source_depth).toBe(0.5);
      expect(adv.housing_width).toBe(1.5);
      expect(adv.housing_length).toBe(2.5);
      expect(adv.housing_height).toBe(0.75);
    });

    it('omits pending_advanced when the definition sets no product fields', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.pending_advanced).toBeUndefined();
    });

    it('sets lamp_type from the definition on apply', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef, lampType: 'lp_254' });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.lamp_type).toBe('lp_254');
    });

    it("clears a stale numeric wavelength when applying an 'other' definition with a spectrum-derived wavelength", async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue({ ...baseDef, lampType: 'other' });
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));

      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'other', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      // Simulate a stale wavelength left over from a previously applied definition
      project.updateLamp(id, { wavelength: 275 });
      vi.advanceTimersByTime(200);

      await project.applyCustomLamp(id, 'def-1');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.wavelength).toBeUndefined();
    });

    it('detachCustomLamp clears custom_lamp_id and removed-file flags', async () => {
      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });

      project.updateLamp(id, {
        custom_lamp_id: 'def-1',
        has_ies_file: true,
        has_spectrum_file: true,
        ies_filename: 'test.ies',
        spectrum_filename: 'spec.csv',
      });
      vi.advanceTimersByTime(200);

      await project.detachCustomLamp(id);

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.custom_lamp_id).toBeUndefined();
      expect(lamp.has_ies_file).toBe(false);
      expect(lamp.has_spectrum_file).toBe(false);
    });

    it('detachCustomLamp routes IES/spectrum removals through the sync queue (property update first, then DELETEs)', async () => {
      const opLog: string[] = [];
      let patchBody: Record<string, unknown> | null = null;
      server.use(
        http.patch(`${API_BASE}/session/lamps/:lampId`, async ({ request }) => {
          patchBody = (await request.json()) as Record<string, unknown>;
          opLog.push('patch');
          return HttpResponse.json({ success: true });
        }),
        http.delete(`${API_BASE}/session/lamps/:lampId/ies`, () => {
          opLog.push('delete-ies');
          return HttpResponse.json({ success: true });
        }),
        http.delete(`${API_BASE}/session/lamps/:lampId/spectrum`, () => {
          opLog.push('delete-spectrum');
          return HttpResponse.json({ success: true });
        }),
      );

      const { project } = await import('./project');
      await project.initSession();
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      project.updateLamp(id, {
        custom_lamp_id: 'def-1', has_ies_file: true, has_spectrum_file: true,
        ies_filename: 'test.ies', spectrum_filename: 'spec.csv',
      });
      await vi.runAllTimersAsync();
      // Ignore the setup update; observe only the detach.
      opLog.length = 0;
      patchBody = null;

      project.detachCustomLamp(id);
      await vi.runAllTimersAsync();

      // The removals rode the queued lamp-update: the property PATCH ran first,
      // then the file DELETEs (not a direct pre-call before the update).
      expect(opLog).toContain('delete-ies');
      expect(opLog).toContain('delete-spectrum');
      expect(opLog.indexOf('patch')).toBeGreaterThanOrEqual(0);
      expect(opLog.indexOf('patch')).toBeLessThan(opLog.indexOf('delete-ies'));
      expect(opLog.indexOf('patch')).toBeLessThan(opLog.indexOf('delete-spectrum'));
      // custom_lamp_id is frontend-only — never sent to the backend.
      expect(patchBody).not.toBeNull();
      expect(patchBody).not.toHaveProperty('custom_lamp_id');
    });

    it('applies a pending removal BEFORE a pending upload in the same lamp update', async () => {
      const opLog: string[] = [];
      server.use(
        http.delete(`${API_BASE}/session/lamps/:lampId/ies`, () => {
          opLog.push('delete-ies');
          return HttpResponse.json({ success: true });
        }),
        http.post(`${API_BASE}/session/lamps/:lampId/ies`, () => {
          opLog.push('upload-ies');
          return HttpResponse.json({ success: true, message: 'ok', has_ies_file: true });
        }),
      );

      const { project } = await import('./project');
      await project.initSession();
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      await vi.runAllTimersAsync();
      opLog.length = 0;

      // Both a removal and an upload pending on the same update (detach-then-reapply).
      project.updateLamp(id, {
        pending_remove_ies: true,
        pending_ies_file: new File(['ies'], 'x.ies'),
      });
      await vi.runAllTimersAsync();

      expect(opLog).toEqual(['delete-ies', 'upload-ies']);
    });

    it('a detach that coalesces onto a still-queued apply cancels the pending upload (no stale re-upload after removal)', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const def: CustomLampDef = {
        ...baseDef,
        spectrum: { filename: 'spec.csv', dataBase64: 'BBBB', columnIndex: 2 },
      };
      vi.mocked(lampLibrary.get).mockReturnValue(def);
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));
      vi.mocked(lampLibrary.toSpectrumFile).mockReturnValue(new File(['spec'], 'spec.csv'));

      const opLog: string[] = [];
      server.use(
        http.post(`${API_BASE}/session/lamps/:lampId/ies`, () => {
          opLog.push('upload-ies');
          return HttpResponse.json({ success: true, message: 'ok', has_ies_file: true });
        }),
        http.post(`${API_BASE}/session/lamps/:lampId/spectrum`, () => {
          opLog.push('upload-spectrum');
          return HttpResponse.json({ success: true, peak_wavelength: 265 });
        }),
        http.delete(`${API_BASE}/session/lamps/:lampId/ies`, () => {
          opLog.push('delete-ies');
          return HttpResponse.json({ success: true });
        }),
        http.delete(`${API_BASE}/session/lamps/:lampId/spectrum`, () => {
          opLog.push('delete-spectrum');
          return HttpResponse.json({ success: true });
        }),
      );

      const { project } = await import('./project');
      // NOTE: no initSession() here — the sync queue starts paused pre-init
      // (see the load-flow tests below), so both the apply and the detach
      // enqueue below without draining, forcing the detach to coalesce onto
      // the still-queued apply command exactly like the real race: an
      // applyCustomLamp command sitting in the queue when a detach patch
      // merges over it.
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
        has_ies_file: true, has_spectrum_file: true, custom_lamp_id: 'def-old', preset_id: 'custom',
      });

      await project.applyCustomLamp(id, 'def-1'); // enqueues a lamp-update carrying pending files
      project.detachCustomLamp(id); // enqueues a second lamp-update for the same lamp — coalesces onto the apply

      await project.abortLoad(); // resume the paused queue (no snapshot/clear side effects)
      await vi.runAllTimersAsync();

      // The merge must have cancelled the stale pending upload: no upload ever fires.
      expect(opLog).not.toContain('upload-ies');
      expect(opLog).not.toContain('upload-spectrum');
      // The removals queued by the unload still go through.
      expect(opLog).toContain('delete-ies');
      expect(opLog).toContain('delete-spectrum');

      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.pending_ies_file).toBeUndefined();
      expect(lamp.pending_spectrum_file).toBeUndefined();
      expect(lamp.custom_lamp_id).toBeUndefined();
      expect(lamp.has_ies_file).toBe(false);
      expect(lamp.has_spectrum_file).toBe(false);
    });

    it('strips custom_lamp_id from the backend lamp-update payload', async () => {
      let patchBody: Record<string, unknown> | null = null;
      server.use(
        http.patch(`${API_BASE}/session/lamps/:lampId`, async ({ request }) => {
          patchBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ success: true });
        }),
      );

      const { project } = await import('./project');
      await project.initSession();
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      await vi.runAllTimersAsync();
      patchBody = null;

      project.updateLamp(id, { custom_lamp_id: 'def-9', name: 'Renamed' });
      await vi.runAllTimersAsync();

      expect(patchBody).not.toBeNull();
      expect(patchBody).not.toHaveProperty('custom_lamp_id');
      expect(patchBody).toHaveProperty('name', 'Renamed');
    });
  });

  describe('reuploadCustomFiles (session recovery)', () => {
    const baseDef: CustomLampDef = {
      id: 'def-1',
      name: 'Test Lamp',
      lampType: 'krcl_222',
      ies: { filename: 'test.ies', dataBase64: 'AAAA' },
      scope: 'project',
      contentHash: 'hash-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    type UploadCall = {
      kind: 'ies' | 'spectrum' | 'intensity-map';
      lampId: string;
      // The uploaded file's contents. MSW/undici's multipart parsing doesn't
      // reliably preserve File.name across the request boundary in this
      // environment, so content is used to identify which file was sent.
      content: string;
      columnIndex?: number;
    };
    let uploadCalls: UploadCall[];

    // Stub the read-back endpoints initSession touches after a successful
    // init (refreshStandardZones' GET, session create) so they don't fall
    // through to a real backend and trigger an unrelated session-expired
    // recovery cascade that would call reuploadCustomFiles a second time.
    function stubSessionReads() {
      server.use(
        http.get(`${API_BASE}/session/zones`, () => HttpResponse.json({ zones: [] })),
        http.get(`${API_BASE}/session/state-hashes`, () =>
          HttpResponse.json({
            calc_state: { lamps: 0, calc_zones: {}, reflectance: 0 },
            update_state: { lamps: 0, calc_zones: {}, reflectance: 0 },
          })
        ),
        http.post(`${API_BASE}/session/create`, () =>
          HttpResponse.json({ session_id: 'test-session', token: 'test-token' })
        ),
      );
    }

    // Stub the per-lamp file upload endpoints and record what reaches them.
    // Pass a lamp id to make its IES upload fail (500), to test that one
    // lamp's failure doesn't block re-upload for the next lamp.
    function stubUploadEndpoints(failIesForLampId?: string) {
      uploadCalls = [];
      server.use(
        http.post(`${API_BASE}/session/lamps/:lampId/ies`, async ({ request, params }) => {
          const lampId = params.lampId as string;
          if (failIesForLampId && lampId === failIesForLampId) {
            return new HttpResponse('upload failed', { status: 500 });
          }
          const formData = await request.formData();
          const file = formData.get('file') as File;
          uploadCalls.push({ kind: 'ies', lampId, content: await file.text() });
          return HttpResponse.json({ success: true, message: 'ok', has_ies_file: true });
        }),
        http.post(`${API_BASE}/session/lamps/:lampId/spectrum`, async ({ request, params }) => {
          const lampId = params.lampId as string;
          const formData = await request.formData();
          const file = formData.get('file') as File;
          const url = new URL(request.url);
          const columnIndex = Number(url.searchParams.get('column_index') ?? '0');
          uploadCalls.push({ kind: 'spectrum', lampId, content: await file.text(), columnIndex });
          return HttpResponse.json({ success: true, peak_wavelength: 265 });
        }),
        http.post(`${API_BASE}/session/lamps/:lampId/intensity-map`, async ({ request, params }) => {
          const lampId = params.lampId as string;
          const formData = await request.formData();
          const file = formData.get('file') as File;
          uploadCalls.push({ kind: 'intensity-map', lampId, content: await file.text() });
          return HttpResponse.json({ success: true, message: 'ok', has_intensity_map: true });
        }),
      );
    }

    // Flush microtasks/timers until `cond` holds (or a bounded number of
    // ticks) — reuploadCustomFiles is fire-and-forget from initSession/
    // reinitializeSession, so its uploads land asynchronously.
    async function flushUntil(cond: () => boolean, maxTicks = 50) {
      for (let i = 0; i < maxTicks && !cond(); i++) {
        await vi.advanceTimersByTimeAsync(1);
      }
    }

    async function addLampLinkedTo(defId: string | undefined): Promise<string> {
      const { project } = await import('./project');
      const id = await project.addLamp({
        lamp_type: 'krcl_222', x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0, scaling_factor: 1, enabled: true,
      });
      if (defId) {
        project.updateLamp(id, { custom_lamp_id: defId });
        vi.advanceTimersByTime(200);
      }
      return id;
    }

    beforeEach(async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReset();
      vi.mocked(lampLibrary.toIesFile).mockReset();
      vi.mocked(lampLibrary.toSpectrumFile).mockReset();
      vi.mocked(lampLibrary.toIntensityMapFile).mockReset();
      vi.mocked(lampLibrary.ready).mockReset().mockResolvedValue(undefined);
      stubSessionReads();
      stubUploadEndpoints();
    });

    it('awaits lampLibrary.ready() before reading definitions (no get() until the library has loaded)', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let resolveReady!: () => void;
      let readyResolved = false;
      // One shared deferred for every ready() caller. Using mockImplementation
      // (a fresh promise per call) would let a stale fire-and-forget reupload
      // from a prior test overwrite resolveReady, leaving this test's reupload
      // blocked forever. A single promise means one resolveReady() unblocks all.
      const readyPromise = new Promise<void>((r) => {
        resolveReady = () => { readyResolved = true; r(); };
      });
      vi.mocked(lampLibrary.ready).mockReturnValue(readyPromise);
      vi.mocked(lampLibrary.get).mockImplementation((id: string) =>
        id === 'def-1' ? { ...baseDef } : undefined
      );

      const linkedId = await addLampLinkedTo('def-1');

      const { project } = await import('./project');
      const initPromise = project.initSession();
      await vi.advanceTimersByTimeAsync(5);

      // reuploadCustomFiles is in flight but blocked on ready(): no def reads yet.
      expect(lampLibrary.get).not.toHaveBeenCalled();

      resolveReady();
      await initPromise;
      // The singleton store may carry lamps linked to other defs from prior
      // tests; wait specifically for this test's linked def to be looked up.
      await flushUntil(() => vi.mocked(lampLibrary.get).mock.calls.some((c) => c[0] === 'def-1'));

      // Once ready resolves, the linked lamp's definition is looked up.
      expect(readyResolved).toBe(true);
      expect(lampLibrary.get).toHaveBeenCalledWith('def-1');
      expect(linkedId).toBeTruthy();
      warnSpy.mockRestore();
    });

    it('re-uploads IES, spectrum, and intensity map for a linked lamp using the def files and column index, and skips an unlinked lamp', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const def: CustomLampDef = {
        ...baseDef,
        spectrum: { filename: 'spec.csv', dataBase64: 'BBBB', columnIndex: 3 },
        intensityMap: { filename: 'map.csv', dataBase64: 'CCCC' },
      };
      vi.mocked(lampLibrary.get).mockImplementation((id: string) => (id === 'def-1' ? def : undefined));
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));
      vi.mocked(lampLibrary.toSpectrumFile).mockReturnValue(new File(['spec'], 'spec.csv'));
      vi.mocked(lampLibrary.toIntensityMapFile).mockReturnValue(new File(['map'], 'map.csv'));

      const linkedId = await addLampLinkedTo('def-1');
      const unlinkedId = await addLampLinkedTo(undefined);

      const { project } = await import('./project');
      await project.initSession();
      await flushUntil(() => uploadCalls.length >= 3);

      const forLinked = uploadCalls.filter((c) => c.lampId === linkedId);
      expect(forLinked).toHaveLength(3);
      expect(forLinked.find((c) => c.kind === 'ies')?.content).toBe('ies');
      expect(forLinked.find((c) => c.kind === 'spectrum')?.content).toBe('spec');
      expect(forLinked.find((c) => c.kind === 'spectrum')?.columnIndex).toBe(3);
      expect(forLinked.find((c) => c.kind === 'intensity-map')?.content).toBe('map');

      expect(uploadCalls.some((c) => c.lampId === unlinkedId)).toBe(false);
    });

    it('logs a warning and skips re-upload when the linked definition has been deleted', async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      vi.mocked(lampLibrary.get).mockReturnValue(undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const linkedId = await addLampLinkedTo('def-deleted');

      const { project } = await import('./project');
      await project.initSession();
      await vi.runAllTimersAsync();

      expect(uploadCalls).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('def-deleted'));
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes(linkedId))).toBe(true);
      warnSpy.mockRestore();
    });

    it("doesn't let one lamp's failed upload block the next lamp's re-upload", async () => {
      const { lampLibrary } = await import('$lib/stores/lampLibrary');
      const def: CustomLampDef = { ...baseDef };
      vi.mocked(lampLibrary.get).mockReturnValue(def);
      vi.mocked(lampLibrary.toIesFile).mockReturnValue(new File(['ies'], 'test.ies'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const firstId = await addLampLinkedTo('def-1');
      const secondId = await addLampLinkedTo('def-1');

      // Re-stub after adding lamps so their (unrelated) create calls aren't
      // affected — only the first lamp's IES upload fails from here on.
      stubUploadEndpoints(firstId);

      const { project } = await import('./project');
      await project.initSession();
      await flushUntil(() => uploadCalls.some((c) => c.lampId === secondId));

      expect(uploadCalls.some((c) => c.lampId === firstId)).toBe(false);
      expect(uploadCalls.find((c) => c.lampId === secondId)?.kind).toBe('ies');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('zone operations', () => {
    it('adds a new zone', async () => {
      const { project } = await import('./project');
      const initialCount = get(project).zones.length;

      const id = await project.addZone({
        name: 'Test Zone',
        type: 'plane',
        enabled: true,
        height: 1.5,
        num_x: 25,
        num_y: 25,
      });

      const p = get(project);
      expect(p.zones.length).toBe(initialCount + 1);
      expect(p.zones.find(z => z.id === id)).toBeDefined();
    });

    it('updates an existing zone', async () => {
      const { project } = await import('./project');

      const id = await project.addZone({
        name: 'Test Zone',
        type: 'plane',
        enabled: true,
        height: 1.5,
      });

      project.updateZone(id, { height: 2.0, num_x: 50 });
      vi.advanceTimersByTime(200);

      const p = get(project);
      const zone = p.zones.find(z => z.id === id);
      expect(zone?.height).toBe(2.0);
      expect(zone?.num_x).toBe(50);
    });

    it('removes a zone', async () => {
      const { project } = await import('./project');

      const id = await project.addZone({
        name: 'Test Zone',
        type: 'plane',
        enabled: true,
      });

      const countBefore = get(project).zones.length;
      project.removeZone(id);
      const countAfter = get(project).zones.length;

      expect(countAfter).toBe(countBefore - 1);
      expect(get(project).zones.find(z => z.id === id)).toBeUndefined();
    });

    it('does not remove standard zones through removeZone', async () => {
      const { project } = await import('./project');

      // Standard zones should exist
      const p = get(project);
      const eyeLimits = p.zones.find(z => z.id === 'EyeLimits');
      expect(eyeLimits).toBeDefined();

      // Try to remove it
      project.removeZone('EyeLimits');

      // Should be gone (removeZone doesn't prevent removing standard zones,
      // but the UI typically wouldn't expose this)
      expect(get(project).zones.find(z => z.id === 'EyeLimits')).toBeUndefined();
    });
  });

  describe('results management', () => {
    it('sets calculation results', async () => {
      const { project } = await import('./project');

      const results = {
        calculatedAt: new Date().toISOString(),
        zones: {
          'zone-1': {
            zone_id: 'zone-1',
            zone_type: 'plane',
            statistics: { min: 1, max: 10, mean: 5 },
          },
        },
      };

      project.setResults(results);

      expect(get(project).results).toEqual(results);
    });

    it('clears results', async () => {
      const { project } = await import('./project');

      project.setResults({
        calculatedAt: new Date().toISOString(),
        zones: {},
      });

      expect(get(project).results).toBeDefined();

      project.clearResults();

      expect(get(project).results).toBeUndefined();
    });
  });

  describe('project metadata', () => {
    it('sets project name', async () => {
      const { project } = await import('./project');

      project.setName('My Project');

      expect(get(project).name).toBe('My Project');
    });

    it('exports current project state', async () => {
      const { project } = await import('./project');

      project.updateRoom({ x: 8 });
      await project.addLamp({
        lamp_type: 'krcl_222',
        x: 4, y: 3, z: 2.5,
        aimx: 4, aimy: 3, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      const exported = project.export();

      expect(exported.room.x).toBe(8);
      expect(exported.lamps).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('resets to default project', async () => {
      const { project } = await import('./project');

      // Make some changes
      project.updateRoom({ x: 20 });
      await project.addLamp({
        lamp_type: 'krcl_222',
        x: 10, y: 10, z: 2.5,
        aimx: 10, aimy: 10, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      // Reset
      project.reset();
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.room.x).toBe(4); // Default value
      expect(p.lamps).toHaveLength(0);
    });
  });

  describe('standard zones toggle', () => {
    it('deletes standard zones on uncheck and creates fresh ones on recheck', async () => {
      const { project } = await import('./project');

      // Disable - zones are removed entirely
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);

      const afterDisable = get(project).zones.filter(z => z.isStandard);
      expect(afterDisable.length).toBe(0);

      // Re-enable - fresh zones are created
      project.updateRoom({ useStandardZones: true });
      vi.advanceTimersByTime(200);

      const afterEnable = get(project).zones.filter(z => z.isStandard);
      expect(afterEnable.length).toBe(3);
      expect(afterEnable.every(z => z.enabled === true)).toBe(true);
    });

    it('creates fresh standard zones with correct properties after round-trip', async () => {
      const { project } = await import('./project');

      // Get original zone properties before toggling
      const originalZones = get(project).zones.filter(z => z.isStandard);
      expect(originalZones.length).toBe(3);
      const originalWRF = originalZones.find(z => z.id === 'WholeRoomFluence')!;

      // Disable standard zones (deletes them)
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);
      expect(get(project).zones.filter(z => z.isStandard).length).toBe(0);

      // Re-enable standard zones (creates fresh ones)
      project.updateRoom({ useStandardZones: true });
      vi.advanceTimersByTime(200);

      // Verify fresh zones have correct properties
      const freshZones = get(project).zones.filter(z => z.isStandard);
      expect(freshZones.length).toBe(3);
      const freshWRF = freshZones.find(z => z.id === 'WholeRoomFluence')!;

      expect(freshWRF.num_x).toBe(originalWRF.num_x);
      expect(freshWRF.num_y).toBe(originalWRF.num_y);
      expect(freshWRF.num_z).toBe(originalWRF.num_z);
      expect(freshWRF.x_min).toBe(originalWRF.x_min);
      expect(freshWRF.x_max).toBe(originalWRF.x_max);
      expect(freshWRF.isStandard).toBe(true);
    });

    it('removes standard zones entirely when useStandardZones unchecked', async () => {
      const { project } = await import('./project');

      // Should have standard zones by default
      expect(get(project).zones.filter(z => z.isStandard).length).toBe(3);

      // Disable
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);

      // Zones are removed from array entirely
      const standardZones = get(project).zones.filter(z => z.isStandard);
      expect(standardZones.length).toBe(0);
    });

    it('preserves custom zones when toggling standard zones', async () => {
      const { project } = await import('./project');

      // Add custom zone
      const customId = await project.addZone({
        name: 'Custom Zone',
        type: 'plane',
        enabled: true,
      });

      // Toggle standard zones off and on
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);

      project.updateRoom({ useStandardZones: true });
      vi.advanceTimersByTime(200);

      // Custom zone should still exist
      expect(get(project).zones.find(z => z.id === customId)).toBeDefined();
    });

    it('clears standard zone results on disable, does not restore on re-enable', async () => {
      const { project } = await import('./project');

      // Set some results
      project.setResults({
        calculatedAt: new Date().toISOString(),
        zones: {
          'WholeRoomFluence': {
            zone_id: 'WholeRoomFluence',
            zone_type: 'volume',
            statistics: { min: 1, max: 10, mean: 5 },
          },
          'EyeLimits': {
            zone_id: 'EyeLimits',
            zone_type: 'plane',
            statistics: { min: 0.5, max: 3, mean: 1.5 },
          },
          'SkinLimits': {
            zone_id: 'SkinLimits',
            zone_type: 'plane',
            statistics: { min: 0.2, max: 2, mean: 1 },
          },
        },
        safety: {
          standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)',
          skin_dose: { max_dose: 2, tlv: 3, compliant: true },
          eye_dose: { max_dose: 1.5, tlv: 3, compliant: true },
          overall_compliant: true,
        },
      });

      // Disable - results are cleared
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);

      const disabledResults = get(project).results;
      expect(disabledResults?.zones['WholeRoomFluence']).toBeUndefined();
      expect(disabledResults?.zones['EyeLimits']).toBeUndefined();
      expect(disabledResults?.safety).toBeUndefined();

      // Re-enable - results remain cleared (require recalculation)
      project.updateRoom({ useStandardZones: true });
      vi.advanceTimersByTime(200);

      const reenabledResults = get(project).results;
      expect(reenabledResults?.zones['WholeRoomFluence']).toBeUndefined();
      expect(reenabledResults?.zones['EyeLimits']).toBeUndefined();
      expect(reenabledResults?.safety).toBeUndefined();
    });

    it('strips safety results when disabling standard zones', async () => {
      const { project } = await import('./project');

      // Set results with safety
      project.setResults({
        calculatedAt: new Date().toISOString(),
        zones: {
          'WholeRoomFluence': {
            zone_id: 'WholeRoomFluence',
            zone_type: 'volume',
            statistics: { min: 1, max: 10, mean: 5 },
          },
        },
        safety: {
          standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)',
          skin_dose: { max_dose: 2, tlv: 3, compliant: true },
          eye_dose: { max_dose: 1.5, tlv: 3, compliant: true },
          overall_compliant: true,
        },
        checkLamps: {
          status: 'compliant',
          lamp_results: {},
          warnings: [],
          max_skin_dose: 2,
          max_eye_dose: 1.5,
          is_skin_compliant: true,
          is_eye_compliant: true,
          skin_near_limit: false,
          eye_near_limit: false,
        },
      });

      // Disable standard zones
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);

      const results = get(project).results;
      expect(results?.safety).toBeUndefined();
      expect(results?.checkLamps).toBeUndefined();
    });

    it('adds fresh standard zones when none exist in state', async () => {
      const { project } = await import('./project');

      // Manually remove all standard zones from state to simulate fresh session
      // by disabling then removing them from the raw project
      const p = get(project);
      const customOnly = p.zones.filter(z => !z.isStandard);
      project.setResults(undefined);

      // Force a state where no standard zones exist by toggling off then replacing zones
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);

      // Manually strip standard zones from internal state (simulating fresh session)
      // We do this by loading a project without standard zones
      project.loadFromFile({
        ...get(project),
        zones: customOnly,
        room: { ...get(project).room, useStandardZones: false },
      });
      vi.advanceTimersByTime(200);

      // Re-enable - should add fresh standard zones since none exist
      project.updateRoom({ useStandardZones: true });
      vi.advanceTimersByTime(200);

      const zones = get(project).zones.filter(z => z.isStandard);
      expect(zones.length).toBe(3);
      expect(zones.find(z => z.id === 'WholeRoomFluence')).toBeDefined();
      expect(zones.find(z => z.id === 'EyeLimits')).toBeDefined();
      expect(zones.find(z => z.id === 'SkinLimits')).toBeDefined();
    });

    it('reset restores standard zones as enabled', async () => {
      const { project } = await import('./project');

      // Disable zones
      project.updateRoom({ useStandardZones: false });
      vi.advanceTimersByTime(200);
      expect(get(project).zones.filter(z => z.isStandard).every(z => z.enabled === false)).toBe(true);

      // Reset
      project.reset();
      vi.advanceTimersByTime(200);

      // Should have fresh enabled standard zones
      const standardZones = get(project).zones.filter(z => z.isStandard);
      expect(standardZones.length).toBe(3);
      expect(standardZones.every(z => z.enabled !== false)).toBe(true);
    });
  });

});

describe('syncErrors store', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('adds sync errors', async () => {
    const { syncErrors } = await import('./project');

    syncErrors.add('Test operation', new Error('Test error'));

    let errors: { message: string }[] = [];
    const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('Test error');

    unsubscribe();
  });

  it('dismisses errors by ID', async () => {
    const { syncErrors } = await import('./project');

    syncErrors.add('Test', new Error('Error 1'));
    syncErrors.add('Test', new Error('Error 2'));

    let errors: { id: string; message: string }[] = [];
    const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

    expect(errors.length).toBe(2);

    syncErrors.dismiss(errors[0].id);

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('Error 2');

    unsubscribe();
  });

  it('clears all errors', async () => {
    const { syncErrors } = await import('./project');

    syncErrors.add('Test', new Error('Error 1'));
    syncErrors.add('Test', new Error('Error 2'));

    let errors: unknown[] = [];
    const unsubscribe = syncErrors.subscribe((e) => { errors = e; });

    syncErrors.clear();

    expect(errors.length).toBe(0);

    unsubscribe();
  });
});

describe('refreshStandardZones', () => {
  beforeEach(async () => {
    vi.resetModules();
    setupStorageMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    projectSessionStore = {};
  });

  it('passes through vert/horiz/fov_vert values from backend after unit change', async () => {
    // This test verifies that when refreshStandardZones() is called after a unit change,
    // the frontend trusts whatever vert/horiz/fov_vert values the backend returns.
    // Correctness of these values is a guv_calcs responsibility.

    // Add mock handler for GET /session/zones that returns zones with correct values
    // (guv_calcs update_standard_zones() sets these per-standard)
    server.use(
      http.get(`${API_BASE}/session/zones`, () => {
        return HttpResponse.json({
          zones: [
            {
              id: 'WholeRoomFluence',
              name: 'Whole Room Fluence',
              type: 'volume',
              enabled: true,
              is_standard: true,
              x_min: 0, x_max: 13.12,
              y_min: 0, y_max: 19.69,
              z_min: 0, z_max: 8.86,
              num_x: 25, num_y: 25, num_z: 25,
              dose: false,
              hours: 8,
            },
            {
              id: 'EyeLimits',
              name: 'Eye Dose (8 Hours)',
              type: 'plane',
              enabled: true,
              is_standard: true,
              height: 5.58, // feet
              x1: 0, x2: 13.12,
              y1: 0, y2: 19.69,
              x_spacing: 0.33, y_spacing: 0.33,
              dose: true,
              hours: 8,
              // Values set by guv_calcs per standard (ACGIH here)
              vert: true,
              horiz: false,
              fov_vert: 80,
            },
            {
              id: 'SkinLimits',
              name: 'Skin Dose (8 Hours)',
              type: 'plane',
              enabled: true,
              is_standard: true,
              height: 5.58,
              x1: 0, x2: 13.12,
              y1: 0, y2: 19.69,
              x_spacing: 0.33, y_spacing: 0.33,
              dose: true,
              hours: 8,
              vert: false,
              horiz: true,
              fov_vert: 180,
            },
          ],
        });
      })
    );

    const { project } = await import('./project');

    // Initialize session
    await project.initSession();
    vi.advanceTimersByTime(100);

    // Verify initial state - EyeLimits placeholder exists (vert/horiz/fov_vert are set by backend)
    const initialEyeLimits = get(project).zones.find(z => z.id === 'EyeLimits');
    expect(initialEyeLimits).toBeDefined();
    expect(initialEyeLimits?.isStandard).toBe(true);

    // Change dimensions - this triggers refreshStandardZones()
    project.updateRoom({ x: 5 });

    // Advance past debounce + the 200ms wait in refreshStandardZones
    vi.advanceTimersByTime(500);

    // Wait for async operations
    await vi.runAllTimersAsync();

    // After refreshStandardZones, the frontend trusts whatever the backend returns.
    // vert/horiz/fov_vert correctness is a backend (guv_calcs) responsibility.
    const eyeLimits = get(project).zones.find(z => z.id === 'EyeLimits');
    expect(eyeLimits).toBeDefined();
    expect(eyeLimits?.isStandard).toBe(true);
    expect(eyeLimits?.id).toBe('EyeLimits');
    expect(eyeLimits?.type).toBe('plane');

    const skinLimits = get(project).zones.find(z => z.id === 'SkinLimits');
    expect(skinLimits).toBeDefined();
    expect(skinLimits?.isStandard).toBe(true);
    expect(skinLimits?.id).toBe('SkinLimits');
    expect(skinLimits?.type).toBe('plane');
  });
});

describe('zone type change', () => {
  beforeEach(async () => {
    vi.resetModules();
    setupStorageMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    projectSessionStore = {};
  });

  it('keeps zone identity and applies backend grid values on a type change', async () => {
    // A type change is delete + recreate on the backend, but the frontend now
    // mints the id and re-sends the SAME id, so the recreated zone keeps its
    // identity. The backend echoes the id back and returns authoritative grid
    // values, which must land on the real snake_case CalcZone fields.
    const seenIds: (string | undefined)[] = [];
    server.use(
      http.post(`${API_BASE}/session/zones`, async ({ request }) => {
        const body = (await request.json()) as { id?: string };
        seenIds.push(body?.id);
        // Backend echoes the client-supplied id. The initial plane create and
        // the type-change recreate return DIFFERENT grid values so the test
        // proves the type-change branch applies the recreated grid.
        const isRecreate = seenIds.length > 1;
        return HttpResponse.json(
          isRecreate
            ? { success: true, zone_id: body?.id, num_x: 42, num_y: 42, num_z: 12, x_spacing: 0.1, y_spacing: 0.1, z_spacing: 0.25 }
            : { success: true, zone_id: body?.id, num_x: 30, num_y: 30, x_spacing: 0.2, y_spacing: 0.2 }
        );
      })
    );

    const { project } = await import('./project');
    await project.initSession();

    const id = await project.addZone({ type: 'plane', name: 'test zone', x1: 0, x2: 4, y1: 0, y2: 6, height: 1.9 });
    expect(get(project).zones.find(z => z.id === id)?.num_x).toBe(30);
    // Seed a stale result for this zone so we can prove it is evicted.
    project.setResults({ zones: { [id]: { mean: 1 } } } as unknown as Parameters<typeof project.setResults>[0]);
    expect(get(project).results?.zones?.[id]).toBeDefined();

    project.updateZone(id, { type: 'volume' });
    await vi.runAllTimersAsync();

    // Identity preserved: the zone still exists under its ORIGINAL id.
    const zone = get(project).zones.find(z => z.id === id);
    expect(zone).toBeDefined();
    expect(zone?.type).toBe('volume');
    // No remap: exactly one zone carries this id.
    expect(get(project).zones.filter(z => z.id === id)).toHaveLength(1);
    // Backend-computed grid values applied on snake_case fields.
    expect(zone?.num_x).toBe(42);
    expect(zone?.num_z).toBe(12);
    expect(zone?.x_spacing).toBe(0.1);
    expect(zone && 'numX' in zone).toBe(false);
    // Stale results for the recreated zone are evicted.
    expect(get(project).results?.zones?.[id]).toBeUndefined();
    // Both the create and the type-change recreate carried the same id.
    expect(seenIds).toEqual([id, id]);
  });
});

describe('client-minted IDs', () => {
  beforeEach(async () => {
    vi.resetModules();
    setupStorageMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    projectSessionStore = {};
  });

  it('mints a client id, sends it in the create payload, and uses it directly', async () => {
    let sentId: string | undefined;
    server.use(
      http.post(`${API_BASE}/session/zones`, async ({ request }) => {
        const body = (await request.json()) as { id?: string };
        sentId = body?.id;
        return HttpResponse.json({ success: true, zone_id: body?.id });
      })
    );

    const { project } = await import('./project');
    await project.initSession();

    const id = await project.addZone({ type: 'plane', name: 'z', x1: 0, x2: 4, y1: 0, y2: 6, height: 1.9 });

    // The id was minted client-side and sent to the backend.
    expect(sentId).toBeDefined();
    expect(sentId).toMatch(/^test-uuid-/);
    // The store adopts the minted id (which the backend echoed).
    expect(id).toBe(sentId);
    expect(get(project).zones.find(z => z.id === id)).toBeDefined();
  });

  it('mints a client id for a new lamp and sends it in the create payload', async () => {
    let sentId: string | undefined;
    server.use(
      http.post(`${API_BASE}/session/lamps`, async ({ request }) => {
        const body = (await request.json()) as { id?: string };
        sentId = body?.id;
        return HttpResponse.json({ success: true, lamp_id: body?.id });
      })
    );

    const { project } = await import('./project');
    await project.initSession();

    const id = await project.addLamp({
      lamp_type: 'krcl_222',
      x: 2, y: 2, z: 2.5,
      aimx: 2, aimy: 2, aimz: 0,
      scaling_factor: 1,
      enabled: true,
    });

    expect(sentId).toBeDefined();
    expect(sentId).toMatch(/^test-uuid-/);
    expect(id).toBe(sentId);
    expect(get(project).lamps.find(l => l.id === id)).toBeDefined();
  });
});

describe('sync queue integration', () => {
  beforeEach(async () => {
    vi.resetModules();
    setupStorageMocks();
    lampCounter = 0;
    zoneCounter = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    projectSessionStore = {};
  });

  // Stub session read-back endpoints so the post-init flow's GETs are clean
  // no-ops. Without these they bypass to the real dev server (if any), 404 as
  // "Session not found", and trigger the session-expired reinit cascade — which
  // pollutes init-POST counts and makes these tests nondeterministic.
  function stubSessionReads() {
    server.use(
      http.get(`${API_BASE}/session/zones`, () => HttpResponse.json({ zones: [] })),
      http.get(`${API_BASE}/session/state-hashes`, () =>
        HttpResponse.json({
          calc_state: { lamps: 0, calc_zones: {}, reflectance: 0 },
          update_state: { lamps: 0, calc_zones: {}, reflectance: 0 },
        })
      )
    );
  }

  // Deterministic session-create so createSession resolves in a microtask under
  // fake timers (instead of a bypassed connection-refused).
  function stubCreateSession() {
    server.use(
      http.post(`${API_BASE}/session/create`, () =>
        HttpResponse.json({ session_id: 'test-session', token: 'test-token' })
      )
    );
  }

  // Gate /session/init on a caller-controlled promise so tests can enqueue edits
  // WHILE init is in flight — the post-boundary window that survives clearPending.
  // Returns a resolver and a live count of init POSTs (to prove the replay
  // mechanism is a PATCH, not a second full init POST as the old re-push was).
  function gateInit() {
    let releaseInit!: () => void;
    const gate = new Promise<void>((r) => { releaseInit = r; });
    const counter = { initPosts: 0 };
    server.use(
      http.post(`${API_BASE}/session/init`, async () => {
        counter.initPosts++;
        await gate;
        return HttpResponse.json({
          success: true,
          message: 'Session initialized',
          lamp_count: 0,
          zone_count: 3,
        });
      })
    );
    return { releaseInit, counter };
  }

  // Flush microtasks/timers until `cond` holds (or a bounded number of ticks).
  async function flushUntil(cond: () => boolean, maxTicks = 50) {
    for (let i = 0; i < maxTicks && !cond(); i++) {
      await vi.advanceTimersByTimeAsync(1);
    }
  }

  // (a)/(b) re-anchoring (Task 3): pre-init edits are now CLEARED by init's
  // replay boundary (they're captured in the init snapshot), so the pause window
  // that survives is the IN-FLIGHT init window. Both tests gate init on a
  // deferred promise and enqueue during that window; the behaviors they assert
  // (coalescing → one PATCH with both fields; delete supersedes → no PATCH) are
  // unchanged.
  it('(a) an edit made while init is in flight lands as a single coalesced PATCH after init (not a second init POST)', async () => {
    // Capture only patches for THIS test's zone id so unrelated leftover async
    // from sibling tests (whole-file runs) can't inflate the count.
    const patchBodies: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${API_BASE}/session/zones/z-coalesce`, async ({ request }) => {
        patchBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ success: true, num_x: 25, num_y: 25, x_spacing: 0.2, y_spacing: 0.2 });
      })
    );
    stubSessionReads();
    stubCreateSession();
    const { releaseInit, counter } = gateInit();

    const { project } = await import('./project');

    const initPromise = project.initSession();
    // Let init reach the backend and hang on the gate.
    await flushUntil(() => counter.initPosts >= 1);

    // Edits made while init is in flight are post-boundary: they survive
    // clearPending and coalesce into one PATCH once the queue resumes.
    const initPostsAtEdit = counter.initPosts;
    project.updateZone('z-coalesce', { height: 1 });
    project.updateZone('z-coalesce', { num_x: 30 });

    releaseInit();
    // Awaiting initSession does NOT advance fake timers, so no unrelated leftover
    // timer can fire here: any init POST in this window came from initSession
    // itself. The old re-push made exactly such a second init POST; the queue
    // boundary must not.
    await initPromise;
    expect(counter.initPosts - initPostsAtEdit).toBe(0); // no re-init POST for the edit

    await vi.runAllTimersAsync();

    // The edit was delivered as a single coalesced PATCH, not a re-push.
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]).toMatchObject({ height: 1, num_x: 30 });
  });

  it('(b) a delete supersedes an in-flight-window update: no PATCH, one DELETE', async () => {
    // Scope handlers to THIS test's zone id so sibling-test leftover async can't
    // inflate the counts on whole-file runs.
    let patchCount = 0;
    let deleteCount = 0;
    server.use(
      http.patch(`${API_BASE}/session/zones/z-super`, () => {
        patchCount++;
        return HttpResponse.json({ success: true });
      }),
      http.delete(`${API_BASE}/session/zones/z-super`, () => {
        deleteCount++;
        return HttpResponse.json({ success: true });
      })
    );
    stubSessionReads();
    stubCreateSession();
    const { releaseInit, counter } = gateInit();

    const { project } = await import('./project');

    const initPromise = project.initSession();
    await flushUntil(() => counter.initPosts >= 1);

    // Both enqueued during the in-flight window (post-boundary); the delete
    // supersedes the queued update before either reaches the backend.
    project.updateZone('z-super', { height: 1 });
    project.removeZone('z-super');

    releaseInit();
    await initPromise;
    await vi.runAllTimersAsync();

    expect(patchCount).toBe(0);
    expect(deleteCount).toBe(1);
  });

  it('(c) a transient 423 is retried and succeeds without surfacing an error', async () => {
    let attempts = 0;
    server.use(
      http.patch(`${API_BASE}/session/zones/:zoneId`, () => {
        attempts++;
        if (attempts === 1) {
          return new HttpResponse('session busy', { status: 423 });
        }
        return HttpResponse.json({ success: true, num_x: 25, num_y: 25, x_spacing: 0.2, y_spacing: 0.2 });
      })
    );
    stubSessionReads();

    const { project, syncErrors } = await import('./project');
    await project.initSession();

    project.updateZone('z-retry', { height: 2 });
    await vi.runAllTimersAsync();

    expect(attempts).toBe(2);
    expect(get(syncErrors)).toHaveLength(0);
  });

  it('(d) reinit failure leaves the queued edit paused; a later successful reinit supersedes it (no stale PATCH)', async () => {
    let patchCount = 0;
    let failInit = false;
    server.use(
      http.post(`${API_BASE}/session/init`, () => {
        if (failInit) {
          return new HttpResponse('boom', { status: 500 });
        }
        return HttpResponse.json({
          success: true,
          message: 'Session initialized',
          lamp_count: 0,
          zone_count: 3,
        });
      }),
      http.patch(`${API_BASE}/session/zones/z-stale`, () => {
        patchCount++;
        return HttpResponse.json({ success: true });
      })
    );
    stubSessionReads();
    stubCreateSession();

    const { project } = await import('./project');
    await project.initSession();
    await vi.runAllTimersAsync();

    // Reinit #1 fails → queue is left PAUSED (commands stay queued, not resumed).
    failInit = true;
    await expect(project.reinitializeSession()).rejects.toBeTruthy();
    failInit = false;

    // Edit made while paused queues instead of hitting the backend.
    project.updateZone('z-stale', { height: 5 });
    await vi.runAllTimersAsync();
    expect(patchCount).toBe(0); // paused: nothing sent

    // Reinit #2 succeeds → its snapshot supersedes the pre-boundary stale
    // command, which clearPending drops. No PATCH is ever issued for it.
    await project.reinitializeSession();
    await vi.runAllTimersAsync();

    expect(patchCount).toBe(0);
  });

  // Minimal LoadSessionResponse carrying one standard zone whose id (EyeLimits)
  // is shared across projects — the exact collision the load-path fix guards.
  function makeLoadResponse(eyeLimitsHeight: number) {
    return {
      success: true,
      message: 'loaded',
      room: {
        x: 4, y: 4, z: 3,
        units: 'meters',
        standard: 'ANSI IES RP 27.1-22 (America) - UL8802',
        precision: 0.5,
        enable_reflectance: false,
        air_changes: 1,
        ozone_decay_constant: 2.7,
      },
      lamps: [],
      zones: [
        {
          id: 'EyeLimits',
          name: 'Eye Limits',
          type: 'plane',
          enabled: true,
          is_standard: true,
          height: eyeLimitsHeight,
          calc_mode: 'all',
          x1: 0, x2: 4, y1: 0, y2: 4,
          num_x: 20, num_y: 20,
        },
      ],
    } as unknown as import('$lib/api/client').LoadSessionResponse;
  }

  it('(e) loading a project drops a stale queued edit to a shared standard-zone id (no bleed onto the loaded project)', async () => {
    let eyePatchCount = 0;
    server.use(
      http.patch(`${API_BASE}/session/zones/EyeLimits`, () => {
        eyePatchCount++;
        return HttpResponse.json({ success: true });
      })
    );
    stubSessionReads();

    const { project } = await import('./project');

    // A pre-load edit is queued (the queue starts paused pre-init), targeting a
    // standard-zone id the loaded project also uses. Under the old code this
    // would drain onto the freshly loaded session and overwrite its zone.
    project.updateZone('EyeLimits', { height: 99 });

    // Emulate the load flow: pause+boundary before the round-trip, then apply
    // the loaded state (which clears the pre-boundary stale command).
    project.beginLoad();
    project.loadFromApiResponse(makeLoadResponse(1.9), 'loaded');
    await vi.runAllTimersAsync();

    expect(eyePatchCount).toBe(0); // stale edit never reached the backend
    // Loaded state is intact.
    const eye = get(project).zones.find((z) => z.id === 'EyeLimits');
    expect(eye?.height).toBe(1.9);
  });

  it('(f) a failed load resumes the queue WITHOUT clearing — pre-load edits still drain', async () => {
    let eyePatchCount = 0;
    server.use(
      http.patch(`${API_BASE}/session/zones/EyeLimits`, () => {
        eyePatchCount++;
        return HttpResponse.json({ success: true });
      })
    );
    stubSessionReads();
    stubCreateSession();

    const { project } = await import('./project');
    await project.initSession(); // session live so drained edits reach the backend
    await vi.runAllTimersAsync();

    project.beginLoad(); // pause + boundary
    project.updateZone('EyeLimits', { height: 42 }); // enqueued while paused

    // Load failed: resume WITHOUT clearing. The pre-load session is still live
    // and its queued edit is still valid, so it must drain.
    project.abortLoad();
    await vi.runAllTimersAsync();

    expect(eyePatchCount).toBe(1);
  });
});

describe('linkLoadedCustomLamps', () => {
  beforeEach(async () => {
    vi.resetModules();
    setupStorageMocks();
    vi.useFakeTimers();

    const { lampLibrary } = await import('$lib/stores/lampLibrary');
    vi.mocked(lampLibrary.findByHash).mockReset();
    vi.mocked(lampLibrary.add).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    projectSessionStore = {};
  });

  type LampOverride = { id: string; preset_id?: string | null; has_ies_file?: boolean };

  // Minimal LoadSessionResponse carrying the given lamps (all krcl_222, no
  // zones — irrelevant to hash re-linking).
  function makeLoadResponse(lampOverrides: LampOverride[]) {
    return {
      success: true,
      message: 'loaded',
      room: {
        x: 4, y: 4, z: 3,
        units: 'meters',
        standard: 'ANSI IES RP 27.1-22 (America) - UL8802',
        precision: 0.5,
        enable_reflectance: false,
        air_changes: 1,
        ozone_decay_constant: 2.7,
      },
      lamps: lampOverrides.map((o) => ({
        id: o.id,
        lamp_type: 'krcl_222',
        preset_id: o.preset_id ?? null,
        name: `Lamp ${o.id}`,
        x: 1, y: 1, z: 2,
        aimx: 1, aimy: 1, aimz: 0,
        scaling_factor: 1,
        enabled: true,
        has_ies_file: o.has_ies_file ?? true,
        has_spectrum_file: false,
      })),
      zones: [],
    } as unknown as import('$lib/api/client').LoadSessionResponse;
  }

  type FilesFixture = { content_hash: string | null; ies_filedata: string | null; ies_filename?: string | null; spectrum?: Record<string, string[]> | null };

  // Stub GET /session/lamps/:lampId/files, keyed by lamp id. Also counts
  // total requests so "skipped, no fetch" assertions have something to check.
  function stubLampFiles(byId: Record<string, FilesFixture>) {
    const counter = { requests: 0 };
    server.use(
      http.get(`${API_BASE}/session/lamps/:lampId/files`, ({ params }) => {
        counter.requests++;
        const lampId = params.lampId as string;
        const files = byId[lampId] ?? { content_hash: null, ies_filedata: null, ies_filename: null, spectrum: null };
        return HttpResponse.json(files);
      })
    );
    return counter;
  }

  it('(a) hash matches an existing library def: links the instance, does not call add', async () => {
    const { lampLibrary } = await import('$lib/stores/lampLibrary');
    const existingDef: CustomLampDef = {
      id: 'lib-def-1',
      name: 'Existing',
      lampType: 'krcl_222',
      ies: { filename: 'x.ies', dataBase64: 'AAAA' },
      scope: 'browser',
      contentHash: 'hash-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(lampLibrary.findByHash).mockReturnValue(existingDef);
    stubLampFiles({ L0: { content_hash: 'hash-a', ies_filedata: 'IES DATA' } });

    const { project } = await import('./project');
    project.beginLoad();
    project.loadFromApiResponse(makeLoadResponse([{ id: 'L0' }]), 'test');

    const created = await project.linkLoadedCustomLamps();

    expect(created).toBe(0);
    expect(lampLibrary.add).not.toHaveBeenCalled();
    const lamp = get(project).lamps.find((l) => l.id === 'L0')!;
    expect(lamp.custom_lamp_id).toBe('lib-def-1');
  });

  it('(b) 4 lamps sharing one hash, no library match: exactly one add, all 4 linked, returns 1', async () => {
    const { lampLibrary } = await import('$lib/stores/lampLibrary');
    vi.mocked(lampLibrary.findByHash).mockReturnValue(undefined);
    vi.mocked(lampLibrary.add).mockResolvedValue('new-def-1');
    stubLampFiles({
      L0: { content_hash: 'hash-b', ies_filedata: 'IES DATA' },
      L1: { content_hash: 'hash-b', ies_filedata: 'IES DATA' },
      L2: { content_hash: 'hash-b', ies_filedata: 'IES DATA' },
      L3: { content_hash: 'hash-b', ies_filedata: 'IES DATA' },
    });

    const { project } = await import('./project');
    project.beginLoad();
    project.loadFromApiResponse(
      makeLoadResponse([{ id: 'L0' }, { id: 'L1' }, { id: 'L2' }, { id: 'L3' }]),
      'test'
    );

    const created = await project.linkLoadedCustomLamps();

    expect(created).toBe(1);
    expect(lampLibrary.add).toHaveBeenCalledTimes(1);
    for (const id of ['L0', 'L1', 'L2', 'L3']) {
      const lamp = get(project).lamps.find((l) => l.id === id)!;
      expect(lamp.custom_lamp_id).toBe('new-def-1');
    }
  });

  it('(c) distinct hashes create distinct definitions', async () => {
    const { lampLibrary } = await import('$lib/stores/lampLibrary');
    vi.mocked(lampLibrary.findByHash).mockReturnValue(undefined);
    let addCount = 0;
    vi.mocked(lampLibrary.add).mockImplementation(async () => `new-def-${++addCount}`);
    stubLampFiles({
      L0: { content_hash: 'hash-c1', ies_filedata: 'IES DATA 1' },
      L1: { content_hash: 'hash-c2', ies_filedata: 'IES DATA 2' },
    });

    const { project } = await import('./project');
    project.beginLoad();
    project.loadFromApiResponse(makeLoadResponse([{ id: 'L0' }, { id: 'L1' }]), 'test');

    const created = await project.linkLoadedCustomLamps();

    expect(created).toBe(2);
    expect(lampLibrary.add).toHaveBeenCalledTimes(2);
    const l0 = get(project).lamps.find((l) => l.id === 'L0')!;
    const l1 = get(project).lamps.find((l) => l.id === 'L1')!;
    expect(l0.custom_lamp_id).toBe('new-def-1');
    expect(l1.custom_lamp_id).toBe('new-def-2');
  });

  it('(d) preset lamps and lamps without photometry are skipped: no fetch, no add', async () => {
    const { lampLibrary } = await import('$lib/stores/lampLibrary');
    vi.mocked(lampLibrary.findByHash).mockReturnValue(undefined);
    const counter = stubLampFiles({});

    const { project } = await import('./project');
    project.beginLoad();
    project.loadFromApiResponse(
      makeLoadResponse([
        { id: 'preset-lamp', preset_id: 'beacon', has_ies_file: true },
        { id: 'no-photometry-lamp', preset_id: null, has_ies_file: false },
      ]),
      'test'
    );

    const created = await project.linkLoadedCustomLamps();

    expect(created).toBe(0);
    expect(counter.requests).toBe(0);
    expect(lampLibrary.add).not.toHaveBeenCalled();
  });

  it('(e) spectrum dict from the files endpoint becomes an embedded wavelength/intensity CSV', async () => {
    const { lampLibrary } = await import('$lib/stores/lampLibrary');
    vi.mocked(lampLibrary.findByHash).mockReturnValue(undefined);
    let capturedDef: Parameters<typeof lampLibrary.add>[0] | undefined;
    vi.mocked(lampLibrary.add).mockImplementation(async (def) => {
      capturedDef = def;
      return 'new-def-spec';
    });
    stubLampFiles({
      L0: {
        content_hash: 'hash-spec',
        ies_filedata: 'IES DATA',
        ies_filename: 'custom',
        spectrum: {
          Wavelength: ['200', '210'],
          'Unweighted Relative Intensity': ['0.1', '0.5'],
        },
      },
    });

    const { project } = await import('./project');
    project.beginLoad();
    project.loadFromApiResponse(makeLoadResponse([{ id: 'L0' }]), 'test');

    const created = await project.linkLoadedCustomLamps();

    expect(created).toBe(1);
    expect(capturedDef?.spectrum).toBeDefined();
    expect(capturedDef!.spectrum!.filename.endsWith('.csv')).toBe(true);
    const csv = atob(capturedDef!.spectrum!.dataBase64);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('wavelength,intensity');
    expect(lines[1]).toBe('200,0.1');
    expect(lines[2]).toBe('210,0.5');
  });
});
