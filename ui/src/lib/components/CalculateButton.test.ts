/**
 * Tests for CalculateButton component.
 *
 * Note: Full component testing with Svelte 5 runes requires careful setup.
 * These tests focus on the component's integration with stores and API.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { get } from 'svelte/store';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:8000/api/v1';

// MSW handlers for calculate endpoint
const handlers = [
  http.post(`${API_BASE}/session/init`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Session initialized',
      lamp_count: 0,
      zone_count: 3,
    });
  }),

  http.post(`${API_BASE}/session/calculate`, () => {
    return HttpResponse.json({
      success: true,
      calculated_at: new Date().toISOString(),
      mean_fluence: 5.0,
      zones: {
        'WholeRoomFluence': {
          zone_id: 'WholeRoomFluence',
          zone_type: 'volume',
          statistics: { min: 1, max: 10, mean: 5 },
        },
      },
      state_hashes: {
        calc_state: { lamps: 123, calc_zones: { WholeRoomFluence: 456 }, reflectance: 789 },
        update_state: { lamps: 111, calc_zones: { WholeRoomFluence: 222 }, reflectance: 333 },
      },
    });
  }),

  http.post(`${API_BASE}/session/check-lamps`, () => {
    return HttpResponse.json({
      status: 'compliant',
      lamp_results: {},
      warnings: [],
      max_skin_dose: 0,
      max_eye_dose: 0,
    });
  }),

  http.post(`${API_BASE}/standard-zones`, () => {
    return HttpResponse.json({ zones: [] });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('CalculateButton integration', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  describe('stateHashes store', () => {
    it('starts with null current and lastCalculated', async () => {
      const { stateHashes } = await import('$lib/stores/project');
      const sh = get(stateHashes);

      expect(sh.current).toBeNull();
      expect(sh.lastCalculated).toBeNull();
    });

    it('needsCalculation is false when both are null', async () => {
      const { needsCalculation } = await import('$lib/stores/project');
      expect(get(needsCalculation)).toBe(false);
    });

    it('needsCalculation is true when current exists but lastCalculated is null', async () => {
      const { stateHashes, needsCalculation } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
        lastCalculated: null,
      });
      expect(get(needsCalculation)).toBe(true);
    });

    it('needsCalculation is false when current matches lastCalculated', async () => {
      const { stateHashes, needsCalculation } = await import('$lib/stores/project');
      const hashes = {
        calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
        update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
      };
      stateHashes.set({ current: hashes, lastCalculated: hashes });
      expect(get(needsCalculation)).toBe(false);
    });

    it('needsCalculation is true when lamp hash changes', async () => {
      const { stateHashes, needsCalculation } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 999, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
      });
      expect(get(needsCalculation)).toBe(true);
    });

    it('needsCalculation is true when zone hash changes', async () => {
      const { stateHashes, needsCalculation } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 1, calc_zones: { z1: 999 }, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
        },
      });
      expect(get(needsCalculation)).toBe(true);
    });

    it('needsCalculation is true when zone count changes', async () => {
      const { stateHashes, needsCalculation } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 1, calc_zones: { z1: 10, z2: 20 }, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: { z1: 20, z2: 30 }, reflectance: 4 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
        },
      });
      expect(get(needsCalculation)).toBe(true);
    });

    it('needsCalculation is true when reflectance hash changes', async () => {
      const { stateHashes, needsCalculation } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 999 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
      });
      expect(get(needsCalculation)).toBe(true);
    });
  });

  describe('isZoneStale', () => {
    it('returns false when hashes match', async () => {
      const { isZoneStale } = await import('$lib/stores/project');
      const current = {
        calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
        update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
      };
      expect(isZoneStale('z1', current, current)).toBe(false);
    });

    it('returns true when calc zone hash differs', async () => {
      const { isZoneStale } = await import('$lib/stores/project');
      const current = {
        calc_state: { lamps: 1, calc_zones: { z1: 999 }, reflectance: 2 },
        update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
      };
      const last = {
        calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
        update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
      };
      expect(isZoneStale('z1', current, last)).toBe(true);
    });

    it('returns true when update zone hash differs', async () => {
      const { isZoneStale } = await import('$lib/stores/project');
      const current = {
        calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
        update_state: { lamps: 3, calc_zones: { z1: 999 }, reflectance: 4 },
      };
      const last = {
        calc_state: { lamps: 1, calc_zones: { z1: 10 }, reflectance: 2 },
        update_state: { lamps: 3, calc_zones: { z1: 20 }, reflectance: 4 },
      };
      expect(isZoneStale('z1', current, last)).toBe(true);
    });

    it('returns false when hashes are null', async () => {
      const { isZoneStale } = await import('$lib/stores/project');
      expect(isZoneStale('z1', null, null)).toBe(false);
    });
  });

  describe('lampsStale and roomStale derived stores', () => {
    it('lampsStale is true when lamp calc hash changes', async () => {
      const { stateHashes, lampsStale } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 999, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
      });
      expect(get(lampsStale)).toBe(true);
    });

    it('roomStale is true when reflectance calc hash changes', async () => {
      const { stateHashes, roomStale } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 999 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
      });
      expect(get(roomStale)).toBe(true);
    });

    it('roomStale is true when reflectance update hash changes', async () => {
      const { stateHashes, roomStale } = await import('$lib/stores/project');
      stateHashes.set({
        current: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 999 },
        },
        lastCalculated: {
          calc_state: { lamps: 1, calc_zones: {}, reflectance: 2 },
          update_state: { lamps: 3, calc_zones: {}, reflectance: 4 },
        },
      });
      expect(get(roomStale)).toBe(true);
    });
  });

  describe('calculateSession API', () => {
    it('returns zone results on success', async () => {
      const { generateSessionId } = await import('$lib/api/client');
      const { calculateSession } = await import('$lib/api/client');

      generateSessionId();
      const result = await calculateSession();

      expect(result.success).toBe(true);
      expect(result.zones).toBeDefined();
      expect(result.zones['WholeRoomFluence']).toBeDefined();
    });

    it('returns state_hashes in calculate response', async () => {
      const { generateSessionId, calculateSession } = await import('$lib/api/client');

      generateSessionId();
      const result = await calculateSession();

      expect(result.state_hashes).toBeDefined();
      expect(result.state_hashes?.calc_state.lamps).toBe(123);
      expect(result.state_hashes?.calc_state.calc_zones.WholeRoomFluence).toBe(456);
    });

    it('handles API error gracefully', async () => {
      const { generateSessionId, calculateSession, ApiError } = await import('$lib/api/client');

      server.use(
        http.post(`${API_BASE}/session/calculate`, () => {
          return new HttpResponse('Calculation failed', { status: 500 });
        })
      );

      generateSessionId();

      await expect(calculateSession()).rejects.toThrow(ApiError);
    });
  });
});
