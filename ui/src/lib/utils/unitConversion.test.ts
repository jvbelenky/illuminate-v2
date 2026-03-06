import { describe, it, expect } from 'vitest';
import {
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
