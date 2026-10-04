import { describe, it, expect } from 'vitest';
import {
  LENGTH_UNITS,
  UNIT_INFO,
  DEFAULT_UNITS,
  isLengthUnit,
  toLengthUnit,
  metersPerUnit,
  unitsPerMeter,
  lengthFactor,
  convertLength,
  fromMeters,
  toMeters,
  unitAbbrev,
  unitLabel,
  isMetric,
  unitDecimals,
  unitStep,
  unitFineStep,
  unitSnap,
  gridCellSize,
  roundToUnit,
  precisionAfterUnitChange,
  roomVolumeM3,
  METERS_PER_FOOT,
  FEET_PER_METER,
  type LengthUnit,
} from './unitConversion';

const PAIRS: [LengthUnit, LengthUnit][] = [];
for (const a of LENGTH_UNITS) for (const b of LENGTH_UNITS) if (a !== b) PAIRS.push([a, b]);

describe('unitConversion', () => {
  describe('constants', () => {
    it('METERS_PER_FOOT is correct', () => {
      expect(METERS_PER_FOOT).toBe(0.3048);
    });

    it('FEET_PER_METER is inverse of METERS_PER_FOOT', () => {
      expect(METERS_PER_FOOT * FEET_PER_METER).toBeCloseTo(1, 10);
    });

    it('lists the five app units with meters first', () => {
      expect(LENGTH_UNITS).toEqual(['meters', 'centimeters', 'millimeters', 'feet', 'inches']);
      expect(DEFAULT_UNITS).toBe('meters');
    });

    it('every unit has complete, distinct metadata', () => {
      const abbrevs = new Set<string>();
      for (const u of LENGTH_UNITS) {
        const info = UNIT_INFO[u];
        expect(info.label).toBe(u);
        expect(info.metersPerUnit).toBeGreaterThan(0);
        expect(info.step).toBeGreaterThan(info.fineStep);
        expect(info.snap).toBeGreaterThan(0);
        expect(info.gridCell).toBeGreaterThan(0);
        expect(info.roundDecimals).toBeGreaterThanOrEqual(info.decimals);
        abbrevs.add(info.abbrev);
      }
      expect(abbrevs.size).toBe(LENGTH_UNITS.length);
    });

    it('physical defaults are the same size in every unit', () => {
      // step ≈ 10 cm (metric) / 0.1 ft or 1 in; snap = 10 cm or 3 in; grid = 1 m or 1 ft
      for (const u of LENGTH_UNITS) {
        const snapM = toMeters(unitSnap(u), u);
        expect(isMetric(u) ? snapM : snapM / 0.0254).toBeCloseTo(isMetric(u) ? 0.1 : 3, 9);
        const gridM = toMeters(gridCellSize(u), u);
        expect(gridM).toBeCloseTo(isMetric(u) ? 1 : 0.3048, 9);
      }
    });
  });

  describe('isLengthUnit / toLengthUnit', () => {
    it('accepts the known units', () => {
      for (const u of LENGTH_UNITS) expect(isLengthUnit(u)).toBe(true);
    });

    it('rejects anything else and falls back to meters', () => {
      expect(isLengthUnit('yards')).toBe(false);
      expect(isLengthUnit('m')).toBe(false);
      expect(isLengthUnit(undefined)).toBe(false);
      expect(isLengthUnit(3)).toBe(false);
      expect(toLengthUnit('yards')).toBe('meters');
      expect(toLengthUnit(undefined)).toBe('meters');
      expect(toLengthUnit('inches')).toBe('inches');
      expect(toLengthUnit('bogus', 'feet')).toBe('feet');
    });
  });

  describe('factors', () => {
    it('known factors', () => {
      expect(lengthFactor('feet', 'inches')).toBeCloseTo(12, 12);
      expect(lengthFactor('meters', 'centimeters')).toBeCloseTo(100, 12);
      expect(lengthFactor('meters', 'millimeters')).toBeCloseTo(1000, 12);
      expect(lengthFactor('inches', 'centimeters')).toBeCloseTo(2.54, 12);
      expect(lengthFactor('inches', 'millimeters')).toBeCloseTo(25.4, 12);
      expect(lengthFactor('meters', 'feet')).toBeCloseTo(FEET_PER_METER, 12);
    });

    it.each(PAIRS)('%s -> %s round-trips', (a, b) => {
      expect(lengthFactor(a, b) * lengthFactor(b, a)).toBeCloseTo(1, 12);
      expect(convertLength(convertLength(2.7, a, b), b, a)).toBeCloseTo(2.7, 10);
    });

    it.each(PAIRS)('%s -> %s is consistent with going through meters', (a, b) => {
      expect(convertLength(5, a, b)).toBeCloseTo(fromMeters(toMeters(5, a), b), 10);
    });

    it('same unit is the identity', () => {
      for (const u of LENGTH_UNITS) {
        expect(lengthFactor(u, u)).toBe(1);
        expect(convertLength(1.23456789, u, u)).toBe(1.23456789);
      }
    });

    it('metersPerUnit and unitsPerMeter are inverses', () => {
      for (const u of LENGTH_UNITS) expect(metersPerUnit(u) * unitsPerMeter(u)).toBeCloseTo(1, 12);
    });

    it('fromMeters expresses physical sizes in the display unit', () => {
      expect(fromMeters(0.1, 'centimeters')).toBeCloseTo(10, 12);
      expect(fromMeters(0.1, 'millimeters')).toBeCloseTo(100, 12);
      expect(fromMeters(1.8, 'inches')).toBeCloseTo(70.866, 3);
      expect(fromMeters(2, 'meters')).toBe(2);
    });
  });

  describe('labels', () => {
    it('unitAbbrev', () => {
      expect(unitAbbrev('meters')).toBe('m');
      expect(unitAbbrev('feet')).toBe('ft');
      expect(unitAbbrev('inches')).toBe('in');
      expect(unitAbbrev('centimeters')).toBe('cm');
      expect(unitAbbrev('millimeters')).toBe('mm');
    });

    it('unitLabel returns the API token', () => {
      for (const u of LENGTH_UNITS) expect(unitLabel(u)).toBe(u);
    });

    it('isMetric', () => {
      expect(isMetric('meters')).toBe(true);
      expect(isMetric('centimeters')).toBe(true);
      expect(isMetric('millimeters')).toBe(true);
      expect(isMetric('feet')).toBe(false);
      expect(isMetric('inches')).toBe(false);
    });
  });

  describe('precision defaults', () => {
    it('display decimals', () => {
      expect(unitDecimals('meters')).toBe(1);
      expect(unitDecimals('feet')).toBe(1);
      expect(unitDecimals('centimeters')).toBe(0);
      expect(unitDecimals('millimeters')).toBe(0);
      expect(unitDecimals('inches')).toBe(0);
    });

    it('input steps', () => {
      expect(unitStep('meters')).toBe(0.1);
      expect(unitStep('centimeters')).toBe(1);
      expect(unitStep('millimeters')).toBe(10);
      expect(unitStep('feet')).toBe(0.1);
      expect(unitStep('inches')).toBe(1);
      expect(unitFineStep('meters')).toBe(0.01);
      expect(unitFineStep('inches')).toBe(0.1);
      expect(unitFineStep('millimeters')).toBe(1);
    });

    it('roundToUnit keeps one digit more than the display default', () => {
      expect(roundToUnit(266.69999999999996, 'centimeters')).toBe(266.7);
      expect(roundToUnit(1.99999999, 'meters')).toBe(2);
      expect(roundToUnit(2.123456, 'meters')).toBe(2.12);
      expect(roundToUnit(70.86614, 'inches')).toBe(70.9);
      expect(roundToUnit(1800.4, 'millimeters')).toBe(1800);
      expect(roundToUnit(8.858267, 'feet')).toBe(8.86);
    });

    it('precisionAfterUnitChange follows the default and keeps a custom value', () => {
      expect(precisionAfterUnitChange(1, 'meters', 'centimeters')).toBe(0);
      expect(precisionAfterUnitChange(1, 'meters', 'inches')).toBe(0);
      expect(precisionAfterUnitChange(1, 'meters', 'feet')).toBe(1);
      expect(precisionAfterUnitChange(0, 'centimeters', 'meters')).toBe(1);
      expect(precisionAfterUnitChange(0, 'inches', 'millimeters')).toBe(0);
      // user-chosen precision is kept
      expect(precisionAfterUnitChange(3, 'meters', 'centimeters')).toBe(3);
      expect(precisionAfterUnitChange(2, 'inches', 'meters')).toBe(2);
    });
  });

  describe('roomVolumeM3', () => {
    it('returns the raw product when dimensions are already in meters', () => {
      expect(roomVolumeM3({ x: 2, y: 3, z: 4 }, 'meters')).toBe(24);
    });

    it('converts feet dimensions to cubic meters', () => {
      // A 10ft x 10ft x 10ft room is 1000 ft³ ≈ 28.3168 m³, NOT 1000 m³.
      expect(roomVolumeM3({ x: 10, y: 10, z: 10 }, 'feet')).toBeCloseTo(1000 * 0.3048 ** 3, 6);
    });

    it('does not inflate feet volume by ~35x (regression: CADR too big)', () => {
      // The bug treated feet as meters, making volume (and CADR) ~35.3x too big.
      const asMeters = roomVolumeM3({ x: 10, y: 10, z: 10 }, 'feet');
      expect(asMeters).toBeLessThan(30); // ~28.3, not 1000
    });

    it('is the same physical volume in every unit', () => {
      for (const u of LENGTH_UNITS) {
        const k = unitsPerMeter(u);
        expect(roomVolumeM3({ x: 6 * k, y: 4 * k, z: 2.7 * k }, u)).toBeCloseTo(6 * 4 * 2.7, 6);
      }
    });

    it('uses the floor-plan area for polygon rooms', () => {
      const lShape: [number, number][] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]];
      // 18 m² footprint (not the 24 m² bounding box) × 2.5 m
      expect(roomVolumeM3({ x: 6, y: 4, z: 2.5, shape: 'polygon', vertices: lShape }, 'meters')).toBe(45);
    });
  });
});
