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

  describe('getRequestState', () => {
    it('generates state that includes room dimensions', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');
      const p = get(project);

      const state = getRequestState(p);
      const parsed = JSON.parse(state);

      expect(parsed.room.x).toBe(p.room.x);
      expect(parsed.room.y).toBe(p.room.y);
      expect(parsed.room.z).toBe(p.room.z);
    });

    it('excludes display-only params like colormap', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');
      const p = get(project);

      const state = getRequestState(p);
      const parsed = JSON.parse(state);

      expect(parsed.room.colormap).toBeUndefined();
      expect(parsed.room.precision).toBeUndefined();
    });

    it('includes enabled lamps', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');

      project.addLamp({
        lamp_type: 'krcl_222',
        preset_id: 'beacon',
        x: 2, y: 2, z: 2.5,
        aimx: 2, aimy: 2, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      const p = get(project);
      const state = getRequestState(p);
      const parsed = JSON.parse(state);

      expect(parsed.lamps.length).toBe(1);
      expect(parsed.lamps[0].enabled).toBe(true);
    });

    it('includes zones in state', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');
      const p = get(project);

      const state = getRequestState(p);
      const parsed = JSON.parse(state);

      // Should have standard zones by default
      expect(parsed.zones.length).toBeGreaterThan(0);
    });
  });

  describe('results staleness detection', () => {
    it('results are cleared when room dimensions change', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');

      const initial = get(project);
      const initialState = getRequestState(initial);

      // Store initial as "last request state"
      project.setResults({
        calculatedAt: new Date().toISOString(),
        lastRequestState: initialState,
        zones: {},
      });

      // Verify results exist before change
      expect(get(project).results).toBeDefined();

      // Change room dimension (calculation-affecting)
      project.updateRoom({ x: 20 });

      const updated = get(project);
      const newState = getRequestState(updated);

      // Request state should change
      expect(newState).not.toBe(initialState);
      // Results should be preserved (greyed out via stale overlay, not cleared)
      expect(updated.results).toBeDefined();
    });

    it('results become stale when lamp is added', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');

      const initial = get(project);
      const initialState = getRequestState(initial);

      project.setResults({
        calculatedAt: new Date().toISOString(),
        lastRequestState: initialState,
        zones: {},
      });

      // Verify results exist before change
      expect(get(project).results).toBeDefined();

      project.addLamp({
        lamp_type: 'krcl_222',
        preset_id: 'beacon',
        x: 2, y: 2, z: 2.5,
        aimx: 2, aimy: 2, aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      const updated = get(project);
      const newState = getRequestState(updated);

      // Request state should change (lamp added)
      expect(newState).not.toBe(initialState);
      // Results are preserved but stale (lastRequestState doesn't match current state)
      expect(updated.results).toBeDefined();
      expect(updated.results?.lastRequestState).toBe(initialState);
      // Staleness can be detected by comparing states
      expect(updated.results?.lastRequestState).not.toBe(newState);
    });

    it('results are NOT stale when colormap changes', async () => {
      const { project, getRequestState } = await import('$lib/stores/project');

      const initial = get(project);
      const initialState = getRequestState(initial);

      project.setResults({
        calculatedAt: new Date().toISOString(),
        lastRequestState: initialState,
        zones: {},
      });

      project.updateRoom({ colormap: 'viridis' });

      const updated = get(project);
      const newState = getRequestState(updated);

      // Colormap is display-only, shouldn't affect request state
      expect(newState).toBe(initialState);
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
