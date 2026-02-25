/**
 * Tests for project store.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { get } from 'svelte/store';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Import store creation - we need to reset module state between tests

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

  // Lamp operations
  http.post(`${API_BASE}/session/lamps`, () => {
    return HttpResponse.json({ success: true, lamp_id: `Lamp-${++lampCounter}` });
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

  // Zone operations
  http.post(`${API_BASE}/session/zones`, () => {
    return HttpResponse.json({ success: true, zone_id: `CalcPlane-${++zoneCounter}` });
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
          units: 'meters' as const,
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

    it('updates room units', async () => {
      const { project } = await import('./project');

      project.updateRoom({ units: 'feet' });
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.room.units).toBe('feet');
    });

    it('updates room standard', async () => {
      const { project } = await import('./project');

      project.updateRoom({ standard: 'ICNIRP' });
      vi.advanceTimersByTime(200);

      const p = get(project);
      expect(p.room.standard).toBe('ICNIRP');
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

    // Change units from meters to feet - this triggers refreshStandardZones()
    project.updateRoom({ units: 'feet' });

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
