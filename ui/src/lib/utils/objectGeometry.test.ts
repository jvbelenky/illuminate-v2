import { describe, it, expect } from 'vitest';
import { objectFootprint, localFootprint, polygonCentroid, footprintUpdate } from './objectGeometry';
import { rotateShape } from '$lib/workspace/parts/shapeGeometry';

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

describe('footprintUpdate', () => {
  const box = { shape: 'box' as const, width: 1.2, length: 0.6, x: 2, y: 3, yaw: 30 };

  it('is the inverse of objectFootprint for a rotated box, which stays a box', () => {
    const u = footprintUpdate(box, objectFootprint(box), 30);
    expect(u.shape).toBeUndefined();
    expect(u.x).toBeCloseTo(2, 6);
    expect(u.y).toBeCloseTo(3, 6);
    expect(u.width).toBeCloseTo(1.2, 6);
    expect(u.length).toBeCloseTo(0.6, 6);
    expect(u.yaw).toBe(30);
  });

  it('turning a box over and over never drifts its size or centre', () => {
    let obj: Parameters<typeof footprintUpdate>[0] & { yaw: number } = { ...box, width: 2, x: 1.5 };
    for (const yaw of [45, 15, 77.3, 0]) {
      obj = { ...obj, ...footprintUpdate(obj, rotateShape(objectFootprint(obj), obj.yaw, yaw), yaw) };
    }
    expect(obj).toMatchObject({ width: 2, length: 0.6, x: 1.5, y: 3, yaw: 0 });
  });

  it('a box whose footprint is no longer a rectangle becomes an extrusion that draws the same corners', () => {
    const world = objectFootprint(box);
    world[2] = [world[2][0] + 0.5, world[2][1]];
    const u = footprintUpdate(box, world, 30);
    expect(u.shape).toBe('extrusion');
    const back = objectFootprint({ ...box, ...u });
    back.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(world[i][0], 5);
      expect(y).toBeCloseTo(world[i][1], 5);
    });
  });
});
