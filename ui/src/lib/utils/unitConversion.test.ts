import { describe, it, expect } from 'vitest';
import {
  unitAbbrev,
  unitLabel,
  roomVolumeM3,
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

  describe('roomVolumeM3', () => {
    it('returns the raw product when dimensions are already in meters', () => {
      expect(roomVolumeM3(2, 3, 4, 'meters')).toBe(24);
    });

    it('converts feet dimensions to cubic meters', () => {
      // A 10ft x 10ft x 10ft room is 1000 ft³ ≈ 28.3168 m³, NOT 1000 m³.
      expect(roomVolumeM3(10, 10, 10, 'feet')).toBeCloseTo(1000 * 0.3048 ** 3, 6);
    });

    it('does not inflate feet volume by ~35x (regression: CADR too big)', () => {
      // The bug treated feet as meters, making volume (and CADR) ~35.3x too big.
      const asMeters = roomVolumeM3(10, 10, 10, 'feet');
      expect(asMeters).toBeLessThan(30); // ~28.3, not 1000
    });
  });
});
