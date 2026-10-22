import { describe, it, expect } from 'vitest';
import {
  addLevel,
  autoLevels,
  bandIndex,
  buildColorScale,
  limitLevels,
  limitSet,
  removeLevel,
  resolveLevels,
  resolvePlotSettings,
  scaleColor,
  setLevelColor,
  setLevelValue,
  setLevelLabel,
  levelText,
  valueRange,
  MAX_LEVELS,
} from './plotScale';
import { isoColorHex } from './colormaps';

describe('resolvePlotSettings', () => {
  it('defaults planes to a continuous heatmap and volumes to banded isosurfaces', () => {
    expect(resolvePlotSettings('plane', undefined)).toMatchObject({ view: 'heatmap', levelsSource: 'auto', levelCount: 4, filled: true, decimals: 2 });
    expect(resolvePlotSettings('volume', undefined)).toMatchObject({ view: 'iso' });
  });

  it('keeps a volume on isosurfaces and a plane off them', () => {
    expect(resolvePlotSettings('volume', { view: 'heatmap' }).view).toBe('iso');
    expect(resolvePlotSettings('plane', { view: 'iso' }).view).toBe('heatmap');
    expect(resolvePlotSettings('plane', undefined).showValues).toBe(false);
    expect(resolvePlotSettings('volume', { showValues: true }).showValues).toBe(false);
  });

  it('plots a plane as the room displays it when that is a heatmap or contours', () => {
    expect(resolvePlotSettings('plane', { view: 'heatmap' }, 'contours').view).toBe('contours');
    expect(resolvePlotSettings('plane', { view: 'contours' }, 'heatmap').view).toBe('heatmap');
    expect(resolvePlotSettings('plane', { view: 'contours' }, 'markers').view).toBe('contours');
    expect(resolvePlotSettings('volume', undefined, 'contours').view).toBe('iso');
  });

  it('falls back to auto when custom levels are empty, and sorts typed levels', () => {
    expect(resolvePlotSettings('plane', { levelsSource: 'custom', levels: [] }).levelsSource).toBe('auto');
    expect(resolvePlotSettings('plane', { levelsSource: 'custom', levels: [5, -1, 1, NaN] }).levels).toEqual([1, 5]);
  });
});

const LIMITS = limitSet([{ name: 'ICNIRP', value: 1.1 }, { name: 'ACGIH Eye', value: 5.59 }])!;

describe('levels', () => {
  it('picks 1-2-5 levels inside the data range', () => {
    const levels = autoLevels({ min: 0.3, max: 9.1 });
    expect(levels.length).toBeGreaterThan(1);
    expect(levels.length).toBeLessThanOrEqual(4);
    for (const l of levels) {
      expect(l).toBeGreaterThan(0.3);
      expect(l).toBeLessThan(9.1);
      expect([1, 2, 5]).toContain(Number((l / 10 ** Math.floor(Math.log10(l))).toPrecision(3)));
    }
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('spans the bulk of the data, not a hot spot', () => {
    const values = [...Array.from({ length: 999 }, (_, i) => 0.5 + (i % 10) * 0.1), 1000];
    const levels = autoLevels(valueRange(values));
    expect(Math.max(...levels)).toBeLessThan(2);
  });

  it('picks as many auto levels as asked for, all distinct and inside the data', () => {
    for (const count of [1, 4, 6, 10]) {
      const levels = autoLevels({ min: 0.3, max: 9.1 }, count);
      expect(levels).toHaveLength(count);
      expect(new Set(levels).size).toBe(count);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      for (const l of levels) {
        expect(l).toBeGreaterThan(0.3);
        expect(l).toBeLessThan(9.1);
      }
    }
  });

  it('auto uses the stored level count', () => {
    const s = resolvePlotSettings('plane', { view: 'contours', levelCount: 6 });
    expect(resolveLevels(s, { min: 0.3, max: 9.1 })).toHaveLength(6);
  });

  it('has no auto levels without positive data', () => {
    expect(autoLevels(null)).toEqual([]);
    expect(autoLevels({ min: 0, max: 0 })).toEqual([]);
  });

  it('spaces levels evenly when no 1-2-5 value fits', () => {
    expect(autoLevels({ min: 1.1, max: 1.9 })).toHaveLength(4);
  });

  it('names the limits in order, giving coinciding ones once and skipping unknown ones', () => {
    expect(limitSet([{ name: 'ACGIH Skin', value: 479 }, { name: 'ICNIRP', value: 23 }, { name: 'ACGIH Eye', value: 161 }])).toMatchObject({
      levels: [23, 161, 479],
      labels: ['ICNIRP', 'ACGIH Eye', 'ACGIH Skin'],
    });
    const coinciding = limitSet([{ name: 'A', value: 100 }, { name: 'B', value: 100 }, { name: 'C', value: NaN }]);
    expect(coinciding).toMatchObject({ levels: [100], labels: ['A'] });
    // Each limit is still there for its percentage preset
    expect(coinciding?.named).toEqual([{ name: 'A', value: 100 }, { name: 'B', value: 100 }]);
    expect(limitSet([{ name: 'A', value: NaN }])).toBeNull();
  });

  it('uses the source in force, falling back to auto without a limit', () => {
    const range = { min: 0.3, max: 9.1 };
    const limits = resolvePlotSettings('plane', { levelsSource: 'limits' });
    expect(resolveLevels(limits, range, LIMITS)).toEqual(LIMITS.levels);
    expect(resolveLevels(limits, range, null)).toEqual(autoLevels(range));
    const stored = resolvePlotSettings('plane', { levelsSource: 'limits', levels: [1, 2] });
    expect(resolveLevels(stored, range, null)).toEqual([1, 2]);
    expect(resolveLevels(stored, range, LIMITS)).toEqual(LIMITS.levels);
    const custom = resolvePlotSettings('plane', { levelsSource: 'custom', levels: [2, 4] });
    expect(resolveLevels(custom, range, LIMITS)).toEqual([2, 4]);
  });

  it('steps up to a limit in as many levels as are shown, named by their share of it', () => {
    const limits = limitSet([{ name: 'ICNIRP', value: 23.4 }, { name: 'ACGIH Eye', value: 23.4 }, { name: 'ACGIH Skin', value: 424 }]);
    expect(limitLevels({ levelsSource: 'pct-acgih-skin', levelCount: 4 }, limits)).toMatchObject({
      levels: [106, 212, 318, 424],
      labels: ['25% ACGIH Skin', '50% ACGIH Skin', '75% ACGIH Skin', '100% ACGIH Skin'],
    });
    // A limit that coincides with another still has its own preset
    expect(limitLevels({ levelsSource: 'pct-acgih-eye', levelCount: 3 }, limits)?.labels).toEqual(['33.3% ACGIH Eye', '66.7% ACGIH Eye', '100% ACGIH Eye']);
    expect(limitLevels({ levelsSource: 'pct-icnirp', levelCount: 2 }, null)).toBeNull();
    expect(limitLevels({ levelsSource: 'auto', levelCount: 2 }, limits)).toBeNull();
    // Resolved like Limits: live where the limits are known, else as stored
    const pct = resolvePlotSettings('plane', { levelsSource: 'pct-icnirp', levelCount: 2, levels: [1, 2] });
    expect(resolveLevels(pct, null, limits)).toEqual([11.7, 23.4]);
    expect(resolveLevels(pct, null, null)).toEqual([1, 2]);
  });

  it('finds the band a value falls in', () => {
    expect(bandIndex([1, 2, 5], 0.5)).toBe(-1);
    expect(bandIndex([1, 2, 5], 1)).toBe(0);
    expect(bandIndex([1, 2, 5], 4.9)).toBe(1);
    expect(bandIndex([1, 2, 5], 50)).toBe(2);
  });
});

describe('color scale', () => {
  const range = { min: 0, max: 10 };

  it('bands values at the levels with colormap colors unless overridden', () => {
    const s = resolvePlotSettings('plane', { view: 'contours', levelsSource: 'custom', levels: [1, 5], colors: [null, '#ff0000'] });
    const scale = buildColorScale(s, range, 'plasma');
    expect(scale.colors).toEqual([isoColorHex(0, 2, 'plasma'), '#ff0000']);
    expect(scaleColor(scale, 0.5)).toBeNull();
    expect(scaleColor(scale, 7)).toEqual({ r: 1, g: 0, b: 0 });
    expect(scaleColor(scale, NaN)).toBeNull();
  });

  it('maps continuously across the range', () => {
    const scale = buildColorScale(resolvePlotSettings('plane', undefined), range, 'plasma');
    expect(scale.levels).toBeNull();
    expect(scaleColor(scale, 0)).not.toEqual(scaleColor(scale, 10));
    expect(scaleColor(scale, 20)).toEqual(scaleColor(scale, 10));
  });

  it('ignores non-finite values in the range and applies the factor', () => {
    expect(valueRange([NaN, 2, 4, Infinity], 10)).toMatchObject({ min: 20, max: 40 });
    expect(valueRange([NaN])).toBeNull();
  });
});

describe('level list edits', () => {
  const list = { levels: [1, 2, 5], colors: ['#111111', null, '#555555'], labels: ['low', null, 'high'] };

  it('keeps each color and name with its level when a value moves past another', () => {
    expect(setLevelValue(list, 0, 3)).toEqual({ levels: [2, 3, 5], colors: [null, '#111111', '#555555'], labels: [null, 'low', 'high'] });
  });

  it('ignores a non-positive value', () => {
    expect(setLevelValue(list, 0, 0)).toBe(list);
  });

  it('sets one color', () => {
    expect(setLevelColor(list, 1, '#222222').colors).toEqual(['#111111', '#222222', '#555555']);
  });

  it('sets one name, and clears it when blank', () => {
    expect(setLevelLabel(list, 1, '  mid ').labels).toEqual(['low', 'mid', 'high']);
    expect(setLevelLabel(list, 0, '   ').labels).toEqual([null, null, 'high']);
  });

  it('adds a level halfway to the data max, or above the top level', () => {
    expect(addLevel(list, 9)).toEqual({ levels: [1, 2, 5, 7], colors: ['#111111', null, '#555555', null], labels: ['low', null, 'high', null] });
    expect(addLevel(list, 4).levels).toEqual([1, 2, 5, 7.5]);
  });

  it('caps the number of levels and keeps at least one', () => {
    const full = { levels: Array.from({ length: MAX_LEVELS }, (_, i) => i + 1), colors: [], labels: [] };
    expect(addLevel(full, 100)).toBe(full);
    const one = { levels: [1], colors: [null], labels: [null] };
    expect(removeLevel(one, 0)).toBe(one);
    expect(removeLevel(list, 1)).toEqual({ levels: [1, 5], colors: ['#111111', '#555555'], labels: ['low', 'high'] });
  });
});

describe('level names', () => {
  const range = { min: 0, max: 10 };

  it('marks a level by its name, or by its value when it has none', () => {
    const s = resolvePlotSettings('plane', { view: 'contours', levelsSource: 'custom', levels: [1, 5], labels: ['Low', '  '] });
    const scale = buildColorScale(s, range, 'plasma');
    expect(scale.names).toEqual(['Low', null]);
    expect(levelText(scale, 0, 2)).toBe('Low');
    expect(levelText(scale, 1, 2)).toBe('5.00');
  });
});
