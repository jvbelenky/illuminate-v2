/**
 * Tests for calculation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHoursToTLV,
  calculateOzoneIncrease,
  spacingFromNumPoints,
  numPointsFromSpacing,
} from './calculations';

describe('calculateHoursToTLV', () => {
  it('returns null for null dose', () => {
    expect(calculateHoursToTLV(null, 100)).toBeNull();
  });

  it('returns null for undefined dose', () => {
    expect(calculateHoursToTLV(undefined, 100)).toBeNull();
  });

  it('returns null for zero dose', () => {
    expect(calculateHoursToTLV(0, 100)).toBeNull();
  });

  it('returns null for negative dose', () => {
    expect(calculateHoursToTLV(-5, 100)).toBeNull();
  });

  it('calculates correctly for normal values', () => {
    // If maxDose is 8 mJ/cm² and TLV is 8 mJ/cm², it takes 8 hours to reach TLV
    expect(calculateHoursToTLV(8, 8)).toBe(8);

    // If maxDose is 16 mJ/cm² and TLV is 8 mJ/cm², it takes 4 hours
    expect(calculateHoursToTLV(16, 8)).toBe(4);

    // If maxDose is 4 mJ/cm² and TLV is 8 mJ/cm², it takes 16 hours
    expect(calculateHoursToTLV(4, 8)).toBe(16);
  });

  it('handles typical ACGIH eye TLV calculation', () => {
    // ACGIH eye TLV is 161 mJ/cm² over 8 hours
    // If dose rate is 20.125 mJ/cm² per hour, hours to TLV = (8 * 161) / (20.125 * 8) = 8
    const doseOver8Hours = 161; // At TLV exactly
    expect(calculateHoursToTLV(doseOver8Hours, 161)).toBe(8);
  });
});

describe('calculateOzoneIncrease', () => {
  it('returns null for null fluence', () => {
    expect(calculateOzoneIncrease(null, 2, 5)).toBeNull();
  });

  it('returns null for undefined fluence', () => {
    expect(calculateOzoneIncrease(undefined, 2, 5)).toBeNull();
  });

  it('returns null for zero fluence', () => {
    expect(calculateOzoneIncrease(0, 2, 5)).toBeNull();
  });

  it('returns null when denominator is zero', () => {
    // airChanges + decayConstant = 0
    expect(calculateOzoneIncrease(100, 0, 0)).toBeNull();
  });

  it('returns null when denominator is negative', () => {
    expect(calculateOzoneIncrease(100, -5, 2)).toBeNull();
  });

  it('calculates correctly for normal values', () => {
    // Formula: (avgFluence * OZONE_GENERATION_CONSTANT) / (airChanges + decayConstant)
    // OZONE_GENERATION_CONSTANT = 10
    const result = calculateOzoneIncrease(100, 2, 8);
    // (100 * 10) / (2 + 8) = 1000 / 10 = 100
    expect(result).toBe(100);
  });

  it('returns higher values with fewer air changes', () => {
    const lowAirChanges = calculateOzoneIncrease(100, 1, 5);
    const highAirChanges = calculateOzoneIncrease(100, 5, 5);
    expect(lowAirChanges).toBeGreaterThan(highAirChanges!);
  });
});

describe('spacingFromNumPoints', () => {
  it('returns span when numPoints is 1', () => {
    expect(spacingFromNumPoints(10, 1)).toBe(10);
  });

  it('returns span when numPoints is 0', () => {
    expect(spacingFromNumPoints(10, 0)).toBe(10);
  });

  it('returns span when numPoints is negative', () => {
    expect(spacingFromNumPoints(10, -1)).toBe(10);
  });

  it('calculates correct spacing for normal values', () => {
    // 10 points across 9 units = 1 unit spacing (9 intervals)
    expect(spacingFromNumPoints(9, 10)).toBe(1);

    // 5 points across 8 units = 2 unit spacing (4 intervals)
    expect(spacingFromNumPoints(8, 5)).toBe(2);

    // 2 points across 10 units = 10 unit spacing (1 interval)
    expect(spacingFromNumPoints(10, 2)).toBe(10);
  });

  it('handles small spans', () => {
    expect(spacingFromNumPoints(0.1, 11)).toBeCloseTo(0.01, 10);
  });
});

describe('numPointsFromSpacing', () => {
  it('returns 2 when spacing is zero', () => {
    expect(numPointsFromSpacing(10, 0)).toBe(2);
  });

  it('returns 2 when spacing is negative', () => {
    expect(numPointsFromSpacing(10, -1)).toBe(2);
  });

  it('calculates correct num points for normal values', () => {
    // 9 units with 1 unit spacing = 10 points
    expect(numPointsFromSpacing(9, 1)).toBe(10);

    // 8 units with 2 unit spacing = 5 points
    expect(numPointsFromSpacing(8, 2)).toBe(5);

    // 10 units with 10 unit spacing = 2 points
    expect(numPointsFromSpacing(10, 10)).toBe(2);
  });

  it('rounds to nearest integer', () => {
    // 9 units with 2 unit spacing = 5.5 -> rounds to 6 points (Math.round(4.5) + 1 = 6)
    expect(numPointsFromSpacing(9, 2)).toBe(6);
  });

  it('never returns less than 2', () => {
    expect(numPointsFromSpacing(1, 100)).toBe(2);
  });
});
