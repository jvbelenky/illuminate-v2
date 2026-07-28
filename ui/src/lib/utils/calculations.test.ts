/**
 * Tests for calculation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHoursToTLV,
  spacingFromNumPoints,
  numPointsFromSpacing,
  doseConversionFactor,
  formatDoseTime,
  parseDoseTime,
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

  it('calculates correct spacing for normal values (cell model)', () => {
    // 10 points across 10 units = 1 unit spacing (cell model: span / n)
    expect(spacingFromNumPoints(10, 10)).toBe(1);

    // 5 points across 10 units = 2 unit spacing
    expect(spacingFromNumPoints(10, 5)).toBe(2);

    // 25 points across 5 units = 0.2 spacing
    expect(spacingFromNumPoints(5, 25)).toBe(0.2);
  });

  it('handles small spans', () => {
    // 10 points across 0.1 units = 0.01 spacing
    expect(spacingFromNumPoints(0.1, 10)).toBeCloseTo(0.01, 10);
  });
});

describe('numPointsFromSpacing', () => {
  it('returns 2 when spacing is zero', () => {
    expect(numPointsFromSpacing(10, 0)).toBe(2);
  });

  it('returns 2 when spacing is negative', () => {
    expect(numPointsFromSpacing(10, -1)).toBe(2);
  });

  it('calculates correct num points for normal values (cell model)', () => {
    // 10 units with 1 unit spacing = 10 points (cell model: round(span / s))
    expect(numPointsFromSpacing(10, 1)).toBe(10);

    // 10 units with 2 unit spacing = 5 points
    expect(numPointsFromSpacing(10, 2)).toBe(5);

    // 5 units with 0.2 spacing = 25 points
    expect(numPointsFromSpacing(5, 0.2)).toBe(25);
  });

  it('rounds to nearest integer', () => {
    // 9 units with 2 unit spacing = 4.5 -> rounds to 5 points (cell model: Math.round(4.5) = 5)
    expect(numPointsFromSpacing(9, 2)).toBe(5);

    // 7 units with 2 unit spacing = 3.5 -> rounds to 4 points
    expect(numPointsFromSpacing(7, 2)).toBe(4);
  });

  it('never returns less than 2', () => {
    expect(numPointsFromSpacing(1, 100)).toBe(2);
  });
});

describe('doseConversionFactor', () => {
  it('returns 1 when dose mode unchanged (both false)', () => {
    expect(doseConversionFactor(false, 8, false, 8)).toBe(1);
  });

  it('returns 1 when dose mode unchanged (both true, same hours)', () => {
    expect(doseConversionFactor(true, 8, true, 8)).toBe(1);
  });

  it('adjusts for hours change when both in dose mode', () => {
    // Calc at 8 hours, now displaying at 4 hours → factor = 4/8 = 0.5
    expect(doseConversionFactor(true, 4, true, 8)).toBe(0.5);
    // Calc at 4 hours, now displaying at 8 hours → factor = 8/4 = 2
    expect(doseConversionFactor(true, 8, true, 4)).toBe(2);
  });

  it('converts irradiance to dose when switching to dose mode', () => {
    // Stored as irradiance, display as dose: factor = 3.6 * hours
    expect(doseConversionFactor(true, 8, false, 8)).toBe(3.6 * 8);
    expect(doseConversionFactor(true, 4, false, 4)).toBe(3.6 * 4);
  });

  it('converts dose to irradiance when switching from dose mode', () => {
    // Stored as dose (8hr), display as irradiance: factor = 1 / (3.6 * 8)
    expect(doseConversionFactor(false, 8, true, 8)).toBeCloseTo(1 / (3.6 * 8));
  });

  it('handles undefined doseAtCalcTime (legacy results)', () => {
    // undefined defaults to false (irradiance), so switching to dose should convert
    expect(doseConversionFactor(true, 8, undefined, undefined)).toBe(3.6 * 8);
    // Staying in irradiance mode with undefined calc-time dose = no conversion
    expect(doseConversionFactor(false, 8, undefined, undefined)).toBe(1);
  });
});

describe('formatDoseTime', () => {
  it('always shows all three components', () => {
    expect(formatDoseTime(8, 0, 0)).toBe('8h 0m 0s');
    expect(formatDoseTime(0, 0, 0)).toBe('0h 0m 0s');
    expect(formatDoseTime(1, 30, 15)).toBe('1h 30m 15s');
    expect(formatDoseTime(0, 0, 45)).toBe('0h 0m 45s');
  });

  it('strips float artifacts', () => {
    expect(formatDoseTime(0.1 + 0.2, 0, 0)).toBe('0.3h 0m 0s');
    expect(formatDoseTime(8, 0, 29.999999999)).toBe('8h 0m 30s');
  });
});

describe('parseDoseTime', () => {
  it('parses the canonical suffix form', () => {
    expect(parseDoseTime('8h 0m 0s')).toEqual({ hours: 8, minutes: 0, seconds: 0 });
    expect(parseDoseTime('1h 30m 15s')).toEqual({ hours: 1, minutes: 30, seconds: 15 });
  });

  it('parses partial and compact suffix forms', () => {
    expect(parseDoseTime('8h30m')).toEqual({ hours: 8, minutes: 30, seconds: 0 });
    expect(parseDoseTime('1h 30m')).toEqual({ hours: 1, minutes: 30, seconds: 0 });
    expect(parseDoseTime('45s')).toEqual({ hours: 0, minutes: 0, seconds: 45 });
    expect(parseDoseTime('  2H  5M  ')).toEqual({ hours: 2, minutes: 5, seconds: 0 });
  });

  it('normalizes overflowing components', () => {
    expect(parseDoseTime('90m')).toEqual({ hours: 1, minutes: 30, seconds: 0 });
    expect(parseDoseTime('8.5h')).toEqual({ hours: 8, minutes: 30, seconds: 0 });
    expect(parseDoseTime('3600s')).toEqual({ hours: 1, minutes: 0, seconds: 0 });
  });

  it('parses colon form as h:m:s and h:m', () => {
    expect(parseDoseTime('8:00:00')).toEqual({ hours: 8, minutes: 0, seconds: 0 });
    expect(parseDoseTime('1:30:15')).toEqual({ hours: 1, minutes: 30, seconds: 15 });
    expect(parseDoseTime('8:30')).toEqual({ hours: 8, minutes: 30, seconds: 0 });
  });

  it('treats a bare number as hours', () => {
    expect(parseDoseTime('8')).toEqual({ hours: 8, minutes: 0, seconds: 0 });
    expect(parseDoseTime('0')).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it('rejects unparseable input', () => {
    expect(parseDoseTime('')).toBeNull();
    expect(parseDoseTime('   ')).toBeNull();
    expect(parseDoseTime('abc')).toBeNull();
    expect(parseDoseTime('-1h')).toBeNull();
    expect(parseDoseTime('8h garbage')).toBeNull();
    expect(parseDoseTime('1:2:3:4')).toBeNull();
  });

  it('rejects a repeated unit', () => {
    expect(parseDoseTime('1h 2h')).toBeNull();
    expect(parseDoseTime('30m 30m')).toBeNull();
  });

  it('round-trips through formatDoseTime', () => {
    for (const [h, m, s] of [[8, 0, 0], [0, 0, 0], [1, 30, 15], [12, 5, 59]]) {
      expect(parseDoseTime(formatDoseTime(h, m, s))).toEqual({
        hours: h,
        minutes: m,
        seconds: s,
      });
    }
  });
});
