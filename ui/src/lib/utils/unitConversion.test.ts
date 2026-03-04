import { describe, it, expect } from 'vitest';
import {
  toDisplayUnit,
  fromDisplayUnit,
  unitAbbrev,
  unitLabel,
  METERS_PER_FOOT,
  FEET_PER_METER,
} from './unitConversion';

describe('unitConversion', () => {
  describe('constants', () => {
    it('METERS_PER_FOOT is correct', () => {
      expect(METERS_PER_FOOT).toBe(0.3048);
    });

    it('FEET_PER_METER is inverse of METERS_PER_FOOT', () => {
      expect(METERS_PER_FOOT * FEET_PER_METER).toBeCloseTo(1, 10);
    });
  });

  describe('toDisplayUnit', () => {
    it('returns meters unchanged when units is meters', () => {
      expect(toDisplayUnit(2.5, 'meters')).toBe(2.5);
    });

    it('converts meters to feet', () => {
      expect(toDisplayUnit(1, 'feet')).toBeCloseTo(3.28084, 4);
    });

    it('converts 0.3048m to 1ft', () => {
      expect(toDisplayUnit(0.3048, 'feet')).toBeCloseTo(1, 10);
    });

    it('handles zero', () => {
      expect(toDisplayUnit(0, 'feet')).toBe(0);
    });
  });

  describe('fromDisplayUnit', () => {
    it('returns meters unchanged when units is meters', () => {
      expect(fromDisplayUnit(2.5, 'meters')).toBe(2.5);
    });

    it('converts feet to meters', () => {
      expect(fromDisplayUnit(1, 'feet')).toBeCloseTo(0.3048, 10);
    });

    it('round-trips correctly', () => {
      const original = 4.572;
      const displayed = toDisplayUnit(original, 'feet');
      const roundTripped = fromDisplayUnit(displayed, 'feet');
      expect(roundTripped).toBeCloseTo(original, 10);
    });

    it('handles zero', () => {
      expect(fromDisplayUnit(0, 'feet')).toBe(0);
    });
  });

  describe('unitAbbrev', () => {
    it('returns m for meters', () => {
      expect(unitAbbrev('meters')).toBe('m');
    });

    it('returns ft for feet', () => {
      expect(unitAbbrev('feet')).toBe('ft');
    });
  });

  describe('unitLabel', () => {
    it('returns meters for meters', () => {
      expect(unitLabel('meters')).toBe('meters');
    });

    it('returns feet for feet', () => {
      expect(unitLabel('feet')).toBe('feet');
    });
  });
});
