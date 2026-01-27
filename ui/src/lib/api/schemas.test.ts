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
  it('validates compliant response', () => {
    const data = {
      status: 'compliant',
      lamp_results: {
        'lamp-1': {
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
          missing_spectrum: false,
        },
      },
      warnings: [],
      max_skin_dose: 100,
      max_eye_dose: 50,
    };

    const result = CheckLampsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates non-compliant response with dimming', () => {
    const data = {
      status: 'compliant_with_dimming',
      lamp_results: {},
      warnings: [
        { level: 'warning', message: 'Dimming required', lamp_id: 'lamp-1' },
      ],
      max_skin_dose: 500,
      max_eye_dose: 200,
      skin_dimming_for_compliance: 0.95,
      eye_dimming_for_compliance: 0.8,
    };

    const result = CheckLampsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const data = {
      status: 'invalid_status',
      lamp_results: {},
      warnings: [],
      max_skin_dose: 0,
      max_eye_dose: 0,
    };

    const result = CheckLampsResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('LoadSessionResponseSchema', () => {
  it('validates complete load response', () => {
    const data = {
      success: true,
      message: 'Session loaded',
      room: {
        x: 5,
        y: 5,
        z: 3,
        units: 'meters',
        standard: 'ACGIH',
        precision: 2,
        enable_reflectance: false,
        air_changes: 2,
        ozone_decay_constant: 4.6,
      },
      lamps: [
        {
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
        },
      ],
      zones: [
        {
          id: 'zone-1',
          name: 'Test Zone',
          type: 'plane',
          enabled: true,
          height: 1.7,
          num_x: 25,
          num_y: 25,
        },
      ],
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates response with optional fields', () => {
    const data = {
      success: true,
      message: 'Loaded',
      room: {
        x: 5,
        y: 5,
        z: 3,
        units: 'feet',
        standard: 'ICNIRP',
        precision: 2,
        enable_reflectance: true,
        reflectances: { floor: 0.1, ceiling: 0.1, north: 0.1, south: 0.1, east: 0.1, west: 0.1 },
        air_changes: 3,
        ozone_decay_constant: 4.6,
        colormap: 'viridis',
      },
      lamps: [],
      zones: [],
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('validates zone with volume type', () => {
    const data = {
      success: true,
      message: 'Loaded',
      room: {
        x: 5,
        y: 5,
        z: 3,
        units: 'meters',
        standard: 'ACGIH',
        precision: 2,
        enable_reflectance: false,
        air_changes: 2,
        ozone_decay_constant: 4.6,
      },
      lamps: [],
      zones: [
        {
          id: 'volume-1',
          type: 'volume',
          enabled: true,
          x_min: 0,
          x_max: 5,
          y_min: 0,
          y_max: 5,
          z_min: 0,
          z_max: 3,
          num_x: 25,
          num_y: 25,
          num_z: 25,
        },
      ],
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects invalid zone type', () => {
    const data = {
      success: true,
      message: 'Loaded',
      room: {
        x: 5,
        y: 5,
        z: 3,
        units: 'meters',
        standard: 'ACGIH',
        precision: 2,
        enable_reflectance: false,
        air_changes: 2,
        ozone_decay_constant: 4.6,
      },
      lamps: [],
      zones: [
        {
          id: 'zone-1',
          type: 'invalid_type',
          enabled: true,
        },
      ],
    };

    const result = LoadSessionResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
