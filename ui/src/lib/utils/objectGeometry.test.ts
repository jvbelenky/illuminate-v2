import { describe, it, expect } from 'vitest';
import { objectFootprint, localFootprint, polygonCentroid } from './objectGeometry';

function sortPts(pts: [number, number][]): [number, number][] {
  return pts
    .map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('objectFootprint', () => {
  it('centres a box on its position', () => {
    const pts = objectFootprint({ shape: 'box', width: 2, length: 1, x: 5, y: 5, yaw: 0 });
    expect(sortPts(pts)).toEqual(sortPts([[4, 4.5], [6, 4.5], [6, 5.5], [4, 5.5]]));
  });

  it('rotates a box counter-clockwise by yaw about its centre', () => {
    const pts = objectFootprint({ shape: 'box', width: 2, length: 1, x: 5, y: 5, yaw: 90 });
    expect(sortPts(pts)).toEqual(sortPts([[5.5, 4], [5.5, 6], [4.5, 6], [4.5, 4]]));
  });

  it('places an extrusion by its centroid, matching guv_calcs', () => {
    // 2x2 square footprint given with its corner at the origin: centroid (1, 1)
    const pts = objectFootprint({
      shape: 'extrusion', width: 2, length: 2, x: 10, y: 10, yaw: 0,
      vertices: [[0, 0], [2, 0], [2, 2], [0, 2]],
    });
    expect(sortPts(pts)).toEqual(sortPts([[9, 9], [11, 9], [11, 11], [9, 11]]));
  });

  it('falls back to a box when an extrusion has no usable vertices', () => {
    const pts = localFootprint({ shape: 'extrusion', width: 1, length: 1, vertices: [[0, 0]] });
    expect(pts).toHaveLength(4);
  });
});

describe('polygonCentroid', () => {
  it('matches the area-weighted centroid of an L shape', () => {
    // guv_calcs' Polygon2D.centroid for this L is (0.8333, 0.8333)
    const c = polygonCentroid([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
    expect(c[0]).toBeCloseTo(5 / 6, 6);
    expect(c[1]).toBeCloseTo(5 / 6, 6);
  });
});
