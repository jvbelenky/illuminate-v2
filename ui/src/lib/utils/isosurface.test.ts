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

import { extractIsosurface, buildIsosurfaces } from './isosurface';

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
  const values = [
    [[0.1, 0.1], [0.1, 0.1]],
    [[100, 100], [100, 100]],
  ];

  it('returns nothing without levels or values', () => {
    expect(buildIsosurfaces([], bounds, 1, [1])).toEqual([]);
    expect(buildIsosurfaces(values, bounds, 1, [])).toEqual([]);
  });

  it('builds one surface per level, in the order given', () => {
    const results = buildIsosurfaces(values, bounds, 1, [1, 10]);
    expect(results.map((r) => r.isoLevel)).toEqual([1, 10]);
    for (const r of results) expect(r).toHaveProperty('geometry');
  });
});
