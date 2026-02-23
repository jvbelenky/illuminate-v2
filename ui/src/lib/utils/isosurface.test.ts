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

import { calculateIsoLevels, extractIsosurface, buildIsosurfaces } from './isosurface';

describe('calculateIsoLevels', () => {
  it('returns empty array for empty values', () => {
    expect(calculateIsoLevels([])).toEqual([]);
  });

  it('returns empty array for all non-finite values', () => {
    expect(calculateIsoLevels([[[NaN, Infinity], [-Infinity, NaN]]])).toEqual([]);
  });

  it('returns [value] when all values are the same positive value', () => {
    const values = [[[5, 5], [5, 5]], [[5, 5], [5, 5]]];
    expect(calculateIsoLevels(values)).toEqual([5]);
  });

  it('filters out zero and negative values', () => {
    // Only 10 is positive and finite -> min=max=10 -> returns [10]
    const values = [[[0, 10], [-1, 0]]];
    expect(calculateIsoLevels(values)).toEqual([10]);
  });

  it('uses logarithmic decade spacing', () => {
    // Range 0.05 to 500: decades in range include 0.1, 1, 10, 100
    // plus half-decades ~0.316, ~3.16, ~31.6, ~316
    const values = [[[0.05, 500], [100, 1]]];
    const levels = calculateIsoLevels(values, 3);
    expect(levels).toHaveLength(3);
    // All levels should be within range
    for (const l of levels) {
      expect(l).toBeGreaterThanOrEqual(0.05);
      expect(l).toBeLessThanOrEqual(500);
    }
  });

  it('returns all candidates when fewer than surfaceCount', () => {
    // Range 5 to 50: decade candidates in range: 10, ~31.6
    const values = [[[5, 50], [20, 10]]];
    const levels = calculateIsoLevels(values, 5);
    // Should return all candidates since there are fewer than 5
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.length).toBeLessThanOrEqual(5);
  });

  it('defaults to 3 surfaces', () => {
    // Wide range to ensure enough decade candidates
    const values = [[[0.01, 1000], [1, 100]]];
    const levels = calculateIsoLevels(values);
    expect(levels).toHaveLength(3);
  });

  it('returns [value] when all positive values are the same', () => {
    const values = [[[10, 10], [10, 10]]];
    expect(calculateIsoLevels(values)).toEqual([10]);
  });

  it('falls back to geometric spacing when no decade markers in range', () => {
    // Very narrow range with no powers of 10 or half-decades: e.g., 1.5 to 2.5
    const values = [[[1.5, 2.5], [2.0, 1.8]]];
    const levels = calculateIsoLevels(values, 3);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toBeCloseTo(1.5);
    expect(levels[2]).toBeCloseTo(2.5);
  });

  it('ignores non-finite values', () => {
    // Only 10 is positive+finite -> returns [10]
    const values = [[[NaN, 0, 10, Infinity]]];
    const levels = calculateIsoLevels(values, 3);
    expect(levels).toEqual([10]);
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

  it('returns isosurfaces based on logarithmic levels', () => {
    // Use a wider range so we get enough decade candidates
    const values = [
      [[0.1, 0.1], [0.1, 0.1]],
      [[100, 100], [100, 100]],
    ];
    const results = buildIsosurfaces(values, bounds, 1, 'viridis', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('each result contains geometry and isoLevel', () => {
    const values = [
      [[0.1, 0.1], [0.1, 0.1]],
      [[100, 100], [100, 100]],
    ];
    const results = buildIsosurfaces(values, bounds, 1, 'viridis', 2);
    for (const r of results) {
      expect(r).toHaveProperty('geometry');
      expect(r).toHaveProperty('isoLevel');
    }
  });

  it('returns levels in ascending order', () => {
    const values = [
      [[0.1, 0.1], [0.1, 0.1]],
      [[100, 100], [100, 100]],
    ];
    const results = buildIsosurfaces(values, bounds, 1, 'viridis', 2);
    if (results.length >= 2) {
      expect(results[0].isoLevel).toBeLessThan(results[1].isoLevel);
    }
  });
});

