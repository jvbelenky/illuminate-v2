import { describe, it, expect, vi } from 'vitest';

// Mock three.js
vi.mock('three', () => {
  class MockBufferGeometry {
    attributes: Record<string, any> = {};
    setAttribute = vi.fn((name: string, attr: any) => {
      this.attributes[name] = attr;
    });
    computeVertexNormals = vi.fn();
    computeBoundingBox = vi.fn();
    computeBoundingSphere = vi.fn();
  }

  class MockFloat32BufferAttribute {
    array: Float32Array;
    itemSize: number;
    constructor(array: number[], itemSize: number) {
      this.array = new Float32Array(array);
      this.itemSize = itemSize;
    }
  }

  return {
    BufferGeometry: MockBufferGeometry,
    Float32BufferAttribute: MockFloat32BufferAttribute,
  };
});

import { calculateIsoLevels, extractIsosurface, buildIsosurfaces, getIsosurfaceColor } from './isosurface';

describe('calculateIsoLevels', () => {
  it('returns empty array for empty values', () => {
    expect(calculateIsoLevels([])).toEqual([]);
  });

  it('returns empty array for all non-finite values', () => {
    expect(calculateIsoLevels([[[NaN, Infinity], [-Infinity, NaN]]])).toEqual([]);
  });

  it('returns [mean] when all values are the same (isoMin >= isoMax)', () => {
    const values = [[[5, 5], [5, 5]], [[5, 5], [5, 5]]];
    expect(calculateIsoLevels(values)).toEqual([5]);
  });

  it('returns single level at midpoint for surfaceCount=1', () => {
    // values: min=0, max=10, mean=5, isoMin=max(0, 5/2)=2.5, isoMax=10
    const values = [[[0, 10], [5, 5]], [[5, 5], [5, 5]]];
    const levels = calculateIsoLevels(values, 1);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toBeCloseTo((2.5 + 10) / 2);
  });

  it('distributes levels evenly between isoMin and isoMax', () => {
    // values: 0,2,4,6,8,10 -> mean=5, isoMin=max(0, 5/2)=2.5, isoMax=10
    const values = [[[0, 2, 4], [6, 8, 10]]];
    const levels = calculateIsoLevels(values, 3);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toBeCloseTo(2.5); // isoMin
    expect(levels[1]).toBeCloseTo(6.25); // midpoint
    expect(levels[2]).toBeCloseTo(10); // isoMax
  });

  it('defaults to 3 surfaces', () => {
    const values = [[[0, 5, 10]]];
    const levels = calculateIsoLevels(values);
    expect(levels).toHaveLength(3);
  });

  it('uses mean/2 as isoMin (matching guv_calcs)', () => {
    // values: all 10 -> mean=10, min=10, isoMin=max(10, 10/2)=10, isoMax=10
    // isoMin >= isoMax -> returns [mean]
    const values = [[[10, 10], [10, 10]]];
    expect(calculateIsoLevels(values)).toEqual([10]);
  });

  it('clamps isoMin to actual minimum', () => {
    // values: 8,9,10 -> mean=9, isoMin=max(8, 9/2)=max(8,4.5)=8
    const values = [[[8, 9, 10]]];
    const levels = calculateIsoLevels(values, 3);
    expect(levels[0]).toBeCloseTo(8); // isoMin = max(8, 4.5) = 8
  });

  it('ignores non-finite values', () => {
    const values = [[[NaN, 0, 10, Infinity]]];
    const levels = calculateIsoLevels(values, 3);
    expect(levels).toHaveLength(3);
    // Only 0 and 10 are finite: mean=5, isoMin=max(0, 2.5)=2.5, isoMax=10
    expect(levels[0]).toBeCloseTo(2.5);
    expect(levels[2]).toBeCloseTo(10);
  });
});

describe('extractIsosurface', () => {
  const bounds = { x1: 0, x2: 1, y1: 0, y2: 1, z1: 0, z2: 1 };

  it('returns empty geometry for arrays < 2 in any dimension', () => {
    const geo = extractIsosurface([[[1]]], 0.5, bounds, 1);
    expect(geo.setAttribute).not.toHaveBeenCalled();
  });

  it('returns empty geometry for 1-element x dimension', () => {
    const geo = extractIsosurface([[[1, 2], [3, 4]]], 2, bounds, 1);
    expect(geo.setAttribute).not.toHaveBeenCalled();
  });

  it('generates vertices when isosurface crosses cells', () => {
    // 2x2x2 volume with a clear crossing at isoLevel=5
    const values = [
      [[0, 0], [0, 0]],
      [[10, 10], [10, 10]],
    ];
    const geo = extractIsosurface(values, 5, bounds, 1);
    expect(geo.setAttribute).toHaveBeenCalledWith('position', expect.anything());
    expect(geo.computeVertexNormals).toHaveBeenCalled();
    expect(geo.computeBoundingBox).toHaveBeenCalled();
  });

  it('returns empty geometry when all values are above isoLevel', () => {
    const values = [
      [[10, 10], [10, 10]],
      [[10, 10], [10, 10]],
    ];
    const geo = extractIsosurface(values, 5, bounds, 1);
    // All vertices are above isoLevel, no edges crossed
    // The position attribute may still be set but with empty array
    if ((geo.setAttribute as any).mock.calls.length > 0) {
      const posAttr = (geo.setAttribute as any).mock.calls[0][1];
      expect(posAttr.array.length).toBe(0);
    }
  });

  it('applies scale factor to coordinates', () => {
    const values = [
      [[0, 0], [0, 0]],
      [[10, 10], [10, 10]],
    ];
    const scale = 2;
    const geo = extractIsosurface(values, 5, bounds, scale);
    expect(geo.setAttribute).toHaveBeenCalled();
    const posAttr = (geo.setAttribute as any).mock.calls[0][1];
    // All coordinates should be scaled by 2
    for (let i = 0; i < posAttr.array.length; i++) {
      expect(Math.abs(posAttr.array[i])).toBeLessThanOrEqual(2); // bounds * scale
    }
  });
});

describe('buildIsosurfaces', () => {
  const bounds = { x1: 0, x2: 1, y1: 0, y2: 1, z1: 0, z2: 1 };

  it('returns empty array when no levels (empty values)', () => {
    expect(buildIsosurfaces([], bounds, 1, 'viridis')).toEqual([]);
  });

  it('returns correct number of isosurfaces', () => {
    const values = [
      [[0, 0], [0, 0]],
      [[10, 10], [10, 10]],
    ];
    const results = buildIsosurfaces(values, bounds, 1, 'viridis', 3);
    expect(results).toHaveLength(3);
  });

  it('each result contains geometry, isoLevel, normalizedLevel', () => {
    const values = [
      [[0, 0], [0, 0]],
      [[10, 10], [10, 10]],
    ];
    const results = buildIsosurfaces(values, bounds, 1, 'viridis', 2);
    for (const r of results) {
      expect(r).toHaveProperty('geometry');
      expect(r).toHaveProperty('isoLevel');
      expect(r).toHaveProperty('normalizedLevel');
      expect(r.normalizedLevel).toBeGreaterThanOrEqual(0);
      expect(r.normalizedLevel).toBeLessThanOrEqual(1);
    }
  });

  it('normalizes levels relative to value range', () => {
    const values = [
      [[0, 0], [0, 0]],
      [[10, 10], [10, 10]],
    ];
    const results = buildIsosurfaces(values, bounds, 1, 'viridis', 2);
    // First level should be closer to min -> lower normalized
    // Last level should be closer to max -> higher normalized
    expect(results[0].normalizedLevel).toBeLessThan(results[1].normalizedLevel);
  });
});

describe('getIsosurfaceColor', () => {
  it('returns RGB values', () => {
    const color = getIsosurfaceColor(0.5, 'viridis');
    expect(color).toHaveProperty('r');
    expect(color).toHaveProperty('g');
    expect(color).toHaveProperty('b');
    expect(color.r).toBeGreaterThanOrEqual(0);
    expect(color.r).toBeLessThanOrEqual(255);
  });

  it('returns different colors for different levels', () => {
    const color1 = getIsosurfaceColor(0, 'viridis');
    const color2 = getIsosurfaceColor(1, 'viridis');
    // Colors at 0 and 1 should differ
    expect(color1.r !== color2.r || color1.g !== color2.g || color1.b !== color2.b).toBe(true);
  });
});
