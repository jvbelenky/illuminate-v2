/**
 * Tests for API response schema validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateResponse,
  SessionInitResponseSchema,
  SessionZoneUpdateResponseSchema,
  CalculateResponseSchema,
  CheckLampsResponseSchema,
  LoadSessionResponseSchema,
  ZoneResultSchema,
} from './schemas';

// Mock import.meta.env.DEV for testing both modes
const originalEnv = { ...import.meta.env };

describe('validateResponse', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid data unchanged', () => {
    const data = {
      success: true,
      message: 'Session initialized',
      lamp_count: 2,
      zone_count: 3,
    };

    const result = validateResponse(SessionInitResponseSchema, data, 'test');
    expect(result).toEqual(data);
  });

  it('logs error for invalid data', () => {
    const data = {
      success: 'not a boolean', // Wrong type
      message: 'test',
      lamp_count: 0,
      zone_count: 0,
    };

    // In test mode (which uses DEV=true), this should throw
    expect(() => {
      validateResponse(SessionInitResponseSchema, data, 'test');
    }).toThrow();

    expect(console.error).toHaveBeenCalled();
  });
});

describe('SessionInitResponseSchema', () => {
  it('validates correct response', () => {
    const data = {
      success: true,
      message: 'Session initialized',
      lamp_count: 0,
      zone_count: 3,
    };

    const result = SessionInitResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const data = {
      success: true,
      message: 'test',
      // Missing lamp_count and zone_count
    };

    const result = SessionInitResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects wrong types', () => {
    const data = {
      success: true,
      message: 'test',
      lamp_count: '5', // Should be number
      zone_count: 3,
    };

    const result = SessionInitResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('SessionZoneUpdateResponseSchema', () => {
  it('validates minimal response', () => {
    const data = {
      success: true,
    };

    const result = SessionZoneUpdateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates full response with grid values', () => {
    const data = {
      success: true,
      message: 'Zone updated',
      num_x: 25,
      num_y: 25,
      num_z: 10,
      x_spacing: 0.2,
      y_spacing: 0.2,
      z_spacing: 0.3,
    };

    const result = SessionZoneUpdateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('preserves state_hashes in validated response', () => {
    const data = {
      success: true,
      message: 'Zone updated',
      num_x: 25,
      num_y: 25,
      state_hashes: {
        calc_state: { lamps: 123, calc_zones: { zone1: 456 }, reflectance: 789 },
        update_state: { lamps: 111, calc_zones: { zone1: 222 }, reflectance: 333 },
      },
    };

    const result = SessionZoneUpdateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state_hashes).toBeDefined();
      expect(result.data.state_hashes!.calc_state.lamps).toBe(123);
      expect(result.data.state_hashes!.calc_state.calc_zones.zone1).toBe(456);
    }
  });

  it('allows optional fields to be missing', () => {
    const data = {
      success: true,
      num_x: 25,
      // Other fields omitted
    };

    const result = SessionZoneUpdateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('ZoneResultSchema', () => {
  it('validates basic zone result', () => {
    const data = {
      zone_id: 'EyeLimits',
      zone_type: 'plane',
      statistics: {
        min: 0.1,
        max: 5.0,
        mean: 2.5,
        std: 1.0,
      },
    };

    const result = ZoneResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates zone result with values', () => {
    const data = {
      zone_id: 'TestZone',
      zone_name: 'Test Zone',
      zone_type: 'plane',
      statistics: {
        min: 1,
        max: 10,
        mean: 5,
        std: null,
      },
      num_points: [25, 25],
      values: [[1, 2, 3], [4, 5, 6]],
    };

    const result = ZoneResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('allows null statistics values', () => {
    const data = {
      zone_id: 'TestZone',
      zone_type: 'volume',
      statistics: {
        min: null,
        max: null,
        mean: null,
      },
    };

    const result = ZoneResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('CalculateResponseSchema', () => {
  it('validates successful calculation', () => {
    const data = {
      success: true,
      calculated_at: '2024-01-15T12:00:00Z',
      mean_fluence: 5.5,
      zones: {
        'EyeLimits': {
          zone_id: 'EyeLimits',
          zone_type: 'plane',
          statistics: { min: 1, max: 10, mean: 5, std: 2 },
        },
      },
    };

    const result = CalculateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates response with null mean_fluence', () => {
    const data = {
      success: true,
      calculated_at: '2024-01-15T12:00:00Z',
      mean_fluence: null,
      zones: {},
    };

    const result = CalculateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates response with omitted mean_fluence', () => {
    const data = {
      success: true,
      calculated_at: '2024-01-15T12:00:00Z',
      zones: {},
    };

    const result = CalculateResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe('CheckLampsResponseSchema', () => {
  const validLamp = {
    lamp_id: 'lamp-1',
    lamp_name: 'Test Lamp',
    skin_dose_max: 100,
    eye_dose_max: 50,
    skin_tlv: 479,
    eye_tlv: 161,
    skin_dimming_required: 1.0,
    eye_dimming_required: 1.0,
    is_skin_compliant: true,
    is_eye_compliant: true,
    skin_near_limit: false,
    eye_near_limit: false,
    missing_spectrum: false,
  };

  it('validates compliant response', () => {
    const data = {
      status: 'compliant',
      lamp_results: { 'lamp-1': validLamp },
      warnings: [],
      max_skin_dose: 100,
      max_eye_dose: 50,
      is_skin_compliant: true,
      is_eye_compliant: true,
      skin_near_limit: false,
      eye_near_limit: false,
    };

    const result = CheckLampsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates non-compliant response with warnings', () => {
    const data = {
      status: 'non_compliant',
      lamp_results: {
        'lamp-1': { ...validLamp, is_skin_compliant: false, skin_dimming_required: 0.8 },
      },
      warnings: [
        { level: 'warning', message: 'Lamp exceeds skin TLV', lamp_id: 'lamp-1' },
      ],
      max_skin_dose: 600,
      max_eye_dose: 50,
      is_skin_compliant: false,
      is_eye_compliant: true,
      skin_near_limit: false,
      eye_near_limit: false,
      skin_dimming_for_compliance: 0.8,
    };

    const result = CheckLampsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects missing lamp_results', () => {
    const data = {
      status: 'compliant',
    };

    const result = CheckLampsResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('LoadSessionResponseSchema', () => {
  it('validates minimal response', () => {
    const data = {
      success: true,
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates response with message and state_hashes', () => {
    const data = {
      success: true,
      message: 'Session loaded',
      state_hashes: {
        calc_state: { lamps: 1, calc_zones: { z1: 2 }, reflectance: 3 },
        update_state: { lamps: 4, calc_zones: { z1: 5 }, reflectance: 6 },
      },
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects missing success field', () => {
    const data = {
      message: 'Loaded',
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
