import { describe, it, expect } from 'vitest';
import { planePlotStyle, zoneLimitSet } from './plotStyles';
import type { CalcZone, ZoneResult } from '$lib/types/project';

const zone = (over: Partial<CalcZone> = {}): CalcZone => ({ id: 'z', type: 'plane', ...over }) as CalcZone;

const result = (limits: ZoneResult['limits']): ZoneResult => ({ zone_id: 'z', zone_type: 'plane', statistics: {}, limits });

describe('zone limits', () => {
  const uniform = result({ icnirp: { ref: 20 }, acgih_eye: { ref: 100 }, acgih_skin: { ref: 400 } });

  it('gives a dose zone its limits and an irradiance zone the irradiance reaching them over its exposure time', () => {
    expect(zoneLimitSet(zone({ dose: true }), uniform)).toMatchObject({ levels: [20, 100, 400], labels: ['ICNIRP', 'ACGIH Eye', 'ACGIH Skin'] });
    // 8 h: 100 mJ/cm² over 28 800 s is 3.47 µW/cm²
    expect(zoneLimitSet(zone({ dose: false, hours: 8 }), uniform)?.levels).toEqual([0.694, 3.47, 13.9]);
    // Results from before limits were calculated have none
    expect(zoneLimitSet(zone(), result(undefined))).toBeNull();
    expect(zoneLimitSet(zone(), undefined)).toBeNull();
  });

  it('carries a limit that varies across the plane to the levels set from it', () => {
    const grid = [[6, 12], [12, 23]];
    const mixed = result({ icnirp: { ref: 10, grid } });
    const set = zoneLimitSet(zone({ dose: true }), mixed)!;
    expect(set.levelLimits).toEqual([{ key: 'icnirp', perPoint: { ref: 10, grid } }]);
    // One lamp type: the limit is the same everywhere, so nothing per point
    expect(zoneLimitSet(zone({ dose: true }), uniform)!.levelLimits[0]).toEqual({ key: 'icnirp', perPoint: null });
  });
});

describe('planePlotStyle', () => {
  const values = [[1, 2], [3, 4]];

  it('sends contour levels in stored units with the names the window prints', () => {
    const style = planePlotStyle(
      { view: 'contours', levelsSource: 'custom', levels: [2, 6], labels: ['Low', null], decimals: 1, title: 'Office' },
      values, 2, 'plasma', null,
    );
    expect(style).toMatchObject({ view: 'contours', levels: [1, 3], labels: ['Low', '6.0'], decimals: 1, title: 'Office' });
    expect(style.colors).toHaveLength(2);
  });

  it('resolves contour levels for a plane shown as a heatmap too', () => {
    const style = planePlotStyle({ showValues: true }, values, 1, 'plasma', null);
    expect(style).toMatchObject({ view: 'heatmap', show_values: true, title: null });
    expect(style.levels?.length).toBeGreaterThan(0);
  });

  it('tells the server which limit each level was set from', () => {
    const limits = zoneLimitSet(zone({ dose: true }), result({ icnirp: { ref: 2 }, acgih_eye: { ref: 3 } }));
    const style = planePlotStyle({ view: 'contours', levelsSource: 'pct-icnirp', levelCount: 2 }, values, 1, 'plasma', limits);
    expect(style).toMatchObject({ levels: [1, 2], level_limits: ['icnirp', 'icnirp'] });
    const custom = planePlotStyle({ view: 'contours', levelsSource: 'custom', levels: [2] }, values, 1, 'plasma', limits);
    expect(custom.level_limits).toEqual([null]);
  });

  it('draws a plane displayed as contours as contours, even with no plot settings', () => {
    expect(planePlotStyle(undefined, values, 1, 'plasma', null, 'contours').view).toBe('contours');
    expect(planePlotStyle(undefined, values, 1, 'plasma', null, 'contours').levels?.length).toBeGreaterThan(0);
  });
});
