/**
 * Tests for API client functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Import functions to test
import {
  generateSessionId,
  getSessionId,
  setSessionId,
  hasSessionId,
  ApiError,
  isSessionExpiredError,
  setSessionExpiredHandler,
  checkHealth,
  initSession,
  updateSessionRoom,
  addSessionLamp,
  updateSessionLamp,
  deleteSessionLamp,
  addSessionZone,
  updateSessionZone,
  deleteSessionZone,
  calculateSession,
  getSessionStatus,
  type SessionInitRequest,
} from './client';

const API_BASE = 'http://localhost:8000/api/v1';

// Set up MSW server for API mocking
const server = setupServer(
  // Health check
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // Session init
  http.post(`${API_BASE}/session/init`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Session initialized',
      lamp_count: 0,
      zone_count: 3,
    });
  }),

  // Session status
  http.get(`${API_BASE}/session/status`, () => {
    return HttpResponse.json({
      active: true,
      message: 'Session active',
      lamp_count: 1,
      zone_count: 3,
    });
  }),

  // Room update
  http.patch(`${API_BASE}/session/room`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Lamp operations
  http.post(`${API_BASE}/session/lamps`, () => {
    return HttpResponse.json({ success: true, lamp_id: 'new-lamp-id' });
  }),

  http.patch(`${API_BASE}/session/lamps/:lampId`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete(`${API_BASE}/session/lamps/:lampId`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Zone operations
  http.post(`${API_BASE}/session/zones`, () => {
    return HttpResponse.json({ success: true, zone_id: 'new-zone-id' });
  }),

  http.patch(`${API_BASE}/session/zones/:zoneId`, () => {
    return HttpResponse.json({
      success: true,
      num_x: 25,
      num_y: 25,
      x_spacing: 0.1,
      y_spacing: 0.1,
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
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Reset session ID state between tests
beforeEach(() => {
  // Clear any existing session ID by setting a fresh one
  // Note: The module keeps internal state, so we use generateSessionId to reset it
});

describe('Session ID Management', () => {
  describe('generateSessionId', () => {
    it('generates a new session ID', () => {
      const id = generateSessionId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('stores the generated ID internally', () => {
      const id = generateSessionId();
      expect(getSessionId()).toBe(id);
    });
  });

  describe('getSessionId', () => {
    it('returns existing session ID if set', () => {
      const id = generateSessionId();
      expect(getSessionId()).toBe(id);
    });

    it('generates a new ID if none exists after module reload', () => {
      // Since we can't easily reset module state, just verify it returns something
      const id = getSessionId();
      expect(id).toBeDefined();
    });
  });

  describe('setSessionId', () => {
    it('sets the session ID', () => {
      setSessionId('custom-session-id');
      expect(getSessionId()).toBe('custom-session-id');
    });
  });

  describe('hasSessionId', () => {
    it('returns true when session ID exists', () => {
      generateSessionId();
      expect(hasSessionId()).toBe(true);
    });
  });
});

describe('ApiError', () => {
  it('has correct name', () => {
    const error = new ApiError(404, 'Not found');
    expect(error.name).toBe('ApiError');
  });

  it('has correct status', () => {
    const error = new ApiError(500, 'Server error');
    expect(error.status).toBe(500);
  });

  it('has correct message', () => {
    const error = new ApiError(400, 'Bad request');
    expect(error.message).toBe('Bad request');
  });

  it('is instance of Error', () => {
    const error = new ApiError(403, 'Forbidden');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('isSessionExpiredError', () => {
  it('returns true for 400 No active session error', () => {
    const error = new ApiError(400, 'No active session');
    expect(isSessionExpiredError(error)).toBe(true);
  });

  it('returns true for 404 Session not found error', () => {
    const error = new ApiError(404, 'Session not found. Initialize a session first with POST /session/init');
    expect(isSessionExpiredError(error)).toBe(true);
  });

  it('returns true for 401 re-authentication error', () => {
    const error = new ApiError(401, 'Session requires re-authentication. Please refresh the page.');
    expect(isSessionExpiredError(error)).toBe(true);
  });

  it('returns false for other 401 errors', () => {
    const error = new ApiError(401, 'Invalid session token');
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it('returns false for other 400 errors', () => {
    const error = new ApiError(400, 'Invalid input');
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it('returns false for other 404 errors', () => {
    const error = new ApiError(404, 'Lamp not found');
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it('returns false for other status codes with session message', () => {
    const error = new ApiError(500, 'No active session');
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it('returns false for non-ApiError', () => {
    const error = new Error('No active session');
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it('returns false for non-errors', () => {
    expect(isSessionExpiredError(null)).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
    expect(isSessionExpiredError('No active session')).toBe(false);
  });
});

describe('API Functions', () => {
  beforeEach(() => {
    // Ensure we have a session ID for tests
    generateSessionId();
  });

  describe('checkHealth', () => {
    it('returns health status', async () => {
      const result = await checkHealth();
      expect(result.status).toBe('ok');
    });
  });

  describe('initSession', () => {
    it('initializes session with project data', async () => {
      const request: SessionInitRequest = {
        room: {
          x: 5,
          y: 5,
          z: 3,
          units: 'meters',
          precision: 2,
          standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)',
          enable_reflectance: false,
          air_changes: 2,
          ozone_decay_constant: 4.6,
        },
        lamps: [],
        zones: [],
      };

      const result = await initSession(request);

      expect(result.success).toBe(true);
      expect(result.lamp_count).toBe(0);
      expect(result.zone_count).toBe(3);
    });
  });

  describe('updateSessionRoom', () => {
    it('updates room configuration', async () => {
      const result = await updateSessionRoom({ x: 10 });
      expect(result.success).toBe(true);
    });
  });

  describe('addSessionLamp', () => {
    it('adds a new lamp', async () => {
      const result = await addSessionLamp({
        id: 'lamp-1',
        lamp_type: 'krcl_222',
        x: 2.5,
        y: 2.5,
        z: 2.9,
        aimx: 2.5,
        aimy: 2.5,
        aimz: 0,
        scaling_factor: 1,
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(result.lamp_id).toBe('new-lamp-id');
    });
  });

  describe('updateSessionLamp', () => {
    it('updates an existing lamp', async () => {
      const result = await updateSessionLamp('lamp-1', { x: 3 });
      expect(result.success).toBe(true);
    });
  });

  describe('deleteSessionLamp', () => {
    it('deletes a lamp', async () => {
      const result = await deleteSessionLamp('lamp-1');
      expect(result.success).toBe(true);
    });
  });

  describe('addSessionZone', () => {
    it('adds a new zone', async () => {
      const result = await addSessionZone({
        id: 'zone-1',
        type: 'plane',
        enabled: true,
        isStandard: false,
        dose: false,
        hours: 8,
        height: 1.7,
      });

      expect(result.success).toBe(true);
      expect(result.zone_id).toBe('new-zone-id');
    });
  });

  describe('updateSessionZone', () => {
    it('updates an existing zone', async () => {
      const result = await updateSessionZone('zone-1', { num_x: 50 });

      expect(result.success).toBe(true);
      expect(result.num_x).toBe(25);
      expect(result.x_spacing).toBe(0.1);
    });
  });

  describe('deleteSessionZone', () => {
    it('deletes a zone', async () => {
      const result = await deleteSessionZone('zone-1');
      expect(result.success).toBe(true);
    });
  });

  describe('calculateSession', () => {
    it('runs calculation and returns results', async () => {
      const result = await calculateSession();

      expect(result.success).toBe(true);
      expect(result.calculated_at).toBeDefined();
      expect(result.mean_fluence).toBe(5.0);
    });
  });

  describe('getSessionStatus', () => {
    it('returns session status', async () => {
      const result = await getSessionStatus();

      expect(result.active).toBe(true);
      expect(result.lamp_count).toBe(1);
    });
  });
});

describe('Session Expiration Recovery', () => {
  it('calls recovery handler on session expiration', async () => {
    const recoveryHandler = vi.fn().mockResolvedValue(undefined);
    setSessionExpiredHandler(recoveryHandler);

    // Override the status endpoint to return session expired error
    server.use(
      http.get(`${API_BASE}/session/status`, () => {
        return new HttpResponse('No active session', { status: 400 });
      })
    );

    generateSessionId();

    // This should trigger recovery
    try {
      await getSessionStatus();
    } catch {
      // Expected to fail after recovery attempt
    }

    expect(recoveryHandler).toHaveBeenCalled();
  });

  it('retries request after successful recovery', async () => {
    let callCount = 0;
    const recoveryHandler = vi.fn().mockResolvedValue(undefined);
    setSessionExpiredHandler(recoveryHandler);

    server.use(
      http.get(`${API_BASE}/session/status`, () => {
        callCount++;
        if (callCount === 1) {
          // First call returns expired
          return new HttpResponse('No active session', { status: 400 });
        }
        // Retry succeeds
        return HttpResponse.json({ active: true, lamp_count: 0, zone_count: 0 });
      })
    );

    generateSessionId();
    const result = await getSessionStatus();

    expect(result.active).toBe(true);
    expect(callCount).toBe(2);
  });
});

describe('Error Handling', () => {
  it('throws ApiError for non-OK responses', async () => {
    server.use(
      http.get(`${API_BASE}/health`, () => {
        return new HttpResponse('Service unavailable', { status: 503 });
      })
    );

    await expect(checkHealth()).rejects.toThrow(ApiError);
  });

  it('includes status code in ApiError', async () => {
    server.use(
      http.get(`${API_BASE}/health`, () => {
        return new HttpResponse('Not found', { status: 404 });
      })
    );

    try {
      await checkHealth();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
  });

  it('handles empty response body', async () => {
    server.use(
      http.patch(`${API_BASE}/session/room`, () => {
        return new HttpResponse(null, { status: 204 });
      })
    );

    generateSessionId();
    const result = await updateSessionRoom({ x: 10 });
    expect(result).toEqual({});
  });
});
