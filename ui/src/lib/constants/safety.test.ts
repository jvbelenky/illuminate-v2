import { describe, it, expect } from 'vitest';
import { TLV_LIMITS, OZONE_GENERATION_CONSTANT, OZONE_WARNING_THRESHOLD_PPB } from './safety';

describe('TLV_LIMITS', () => {
  it('has exactly 3 standards', () => {
    expect(Object.keys(TLV_LIMITS)).toHaveLength(3);
  });

  it('has ACGIH with correct values', () => {
    expect(TLV_LIMITS['ACGIH']).toEqual({ skin: 478.5, eye: 160.7 });
  });

  it('has ACGIH-UL8802 with correct values', () => {
    expect(TLV_LIMITS['ACGIH-UL8802']).toEqual({ skin: 478.5, eye: 160.7 });
  });

  it('has ICNIRP with correct values', () => {
    expect(TLV_LIMITS['ICNIRP']).toEqual({ skin: 23.0, eye: 23.0 });
  });

  it('all standards have positive skin and eye values', () => {
    for (const [, limits] of Object.entries(TLV_LIMITS)) {
      expect(limits).toHaveProperty('skin');
      expect(limits).toHaveProperty('eye');
      expect(limits.skin).toBeGreaterThan(0);
      expect(limits.eye).toBeGreaterThan(0);
    }
  });
});

describe('OZONE_GENERATION_CONSTANT', () => {
  it('equals 10', () => {
    expect(OZONE_GENERATION_CONSTANT).toBe(10);
  });
});

describe('OZONE_WARNING_THRESHOLD_PPB', () => {
  it('equals 5', () => {
    expect(OZONE_WARNING_THRESHOLD_PPB).toBe(5);
  });
});
