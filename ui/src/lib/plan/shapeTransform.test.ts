import { describe, it, expect } from 'vitest';
import type { Vertex } from '$lib/utils/roomGeometry';
import {
  shapeBox, boxCorners, handlePoint, rotateHandlePoint, resizeByHandle, rotateByDrag, rotateShapeBy, snapRotation,
  normalizeYaw, dragAngle, localAxisToWorld, snapLineToOutline, shapeKind, handleAngle, HANDLES, toWorld,
} from './shapeTransform';

const close = (a: Vertex[], b: Vertex[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(b[i][0], 6);
    expect(p[1]).toBeCloseTo(b[i][1], 6);
  });
};

/** A 4 x 2 rectangle centred on (c), turned by yaw. */
function rect(c: Vertex, w: number, h: number, yaw: number): Vertex[] {
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Vertex[]).map((p) => {
    const [x, y] = toWorld(p, yaw);
    return [c[0] + x, c[1] + y] as Vertex;
  });
}

describe('shapeBox', () => {
  it('is the bounds of an unturned shape', () => {
    const b = shapeBox([[1, 1], [5, 1], [5, 3], [1, 3]], 0);
    expect(b.min).toEqual([1, 1]);
    expect(b.max).toEqual([5, 3]);
    expect(b.centre[0]).toBeCloseTo(3, 9);
    expect(b.centre[1]).toBeCloseTo(2, 9);
    expect(b.width).toBeCloseTo(4, 9);
    expect(b.height).toBeCloseTo(2, 9);
  });

  it('is drawn in the shape frame: a turned rectangle fits its own box exactly', () => {
    const vs = rect([3, 2], 4, 2, 30);
    const b = shapeBox(vs, 30);
    expect(b.width).toBeCloseTo(4, 9);
    expect(b.height).toBeCloseTo(2, 9);
    expect(b.centre[0]).toBeCloseTo(3, 9);
    expect(b.centre[1]).toBeCloseTo(2, 9);
    // Its corners are the rectangle's own
    close(boxCorners(b), vs);
  });

  it('places the handles on the corners and edge middles, and the rotate handle above the top', () => {
    const b = shapeBox([[0, 0], [4, 0], [4, 2], [0, 2]], 0);
    expect(handlePoint(b, { sx: -1, sy: 1 })).toEqual([0, 2]);
    expect(handlePoint(b, { sx: 1, sy: 0 })).toEqual([4, 1]);
    expect(handlePoint(b, { sx: 0, sy: -1 })).toEqual([2, 0]);
    expect(rotateHandlePoint(b, 0.5)).toEqual([2, 2.5]);
    // Turned a quarter, the stem points along -x
    const t = shapeBox(rect([0, 0], 4, 2, 90), 90);
    const [rx, ry] = rotateHandlePoint(t, 0.5);
    expect(rx).toBeCloseTo(-1.5, 9);
    expect(ry).toBeCloseTo(0, 9);
    expect(HANDLES).toHaveLength(8);
    expect(handleAngle({ sx: 1, sy: 0 }, 90)).toBeCloseTo(90, 9);
  });
});

describe('resizeByHandle', () => {
  const box: Vertex[] = [[0, 0], [4, 0], [4, 2], [0, 2]];

  it('a corner handle scales about the opposite corner', () => {
    close(resizeByHandle(box, 0, { sx: 1, sy: 1 }, [6, 3]), [[0, 0], [6, 0], [6, 3], [0, 3]]);
    close(resizeByHandle(box, 0, { sx: -1, sy: -1 }, [2, 1]), [[2, 1], [4, 1], [4, 2], [2, 2]]);
  });

  it('an edge handle moves one side only', () => {
    close(resizeByHandle(box, 0, { sx: 1, sy: 0 }, [5, 7]), [[0, 0], [5, 0], [5, 2], [0, 2]]);
    close(resizeByHandle(box, 0, { sx: 0, sy: 1 }, [9, 3]), [[0, 0], [4, 0], [4, 3], [0, 3]]);
  });

  it('works in the shape frame with a yaw: the opposite corner stays put', () => {
    const vs = rect([3, 2], 4, 2, 30);
    const before = shapeBox(vs, 30);
    const anchor = handlePoint(before, { sx: -1, sy: -1 });
    // Drag the top-right corner out to where a 6 x 3 box's corner would be
    const target = handlePoint({ ...before, max: [before.min[0] + 6, before.min[1] + 3] }, { sx: 1, sy: 1 });
    const next = resizeByHandle(vs, 30, { sx: 1, sy: 1 }, target);
    const after = shapeBox(next, 30);
    expect(after.width).toBeCloseTo(6, 5);
    expect(after.height).toBeCloseTo(3, 5);
    const a2 = handlePoint(after, { sx: -1, sy: -1 });
    expect(a2[0]).toBeCloseTo(anchor[0], 5);
    expect(a2[1]).toBeCloseTo(anchor[1], 5);
  });

  it('Shift keeps the ratio on a corner handle (the larger factor wins), not on an edge one', () => {
    close(resizeByHandle(box, 0, { sx: 1, sy: 1 }, [8, 2.2], { keepRatio: true }), [[0, 0], [8, 0], [8, 4], [0, 4]]);
    close(resizeByHandle(box, 0, { sx: 1, sy: 0 }, [8, 9], { keepRatio: true }), [[0, 0], [8, 0], [8, 2], [0, 2]]);
  });

  it('never gets smaller than the minimum size, nor turns inside out', () => {
    const next = resizeByHandle(box, 0, { sx: 1, sy: 1 }, [-3, -3], { minSize: 0.1 });
    const b = shapeBox(next, 0);
    expect(b.width).toBeCloseTo(0.1, 6);
    expect(b.height).toBeCloseTo(0.1, 6);
    expect(b.min).toEqual([0, 0]);
  });

  it('snaps the moving edge through the snap callback, in the shape frame', () => {
    const snap = (axis: 0 | 1, v: number) => (axis === 0 ? Math.round(v) : v);
    close(resizeByHandle(box, 0, { sx: 1, sy: 0 }, [5.3, 1], { snap }), [[0, 0], [5, 0], [5, 2], [0, 2]]);
  });

  it('scales a polygon proportionally', () => {
    const l: Vertex[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 2], [0, 2]];
    close(resizeByHandle(l, 0, { sx: 1, sy: 0 }, [8, 0]), [[0, 0], [8, 0], [8, 1], [2, 1], [2, 2], [0, 2]]);
  });
});

describe('rotation', () => {
  it('measures the drag angle about the centre', () => {
    expect(dragAngle([0, 0], [1, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(dragAngle([0, 0], [0, 1], [1, 0])).toBeCloseTo(-90, 9);
  });

  it('snaps to 15° within the tolerance; Alt rotates freely', () => {
    expect(snapRotation(43)).toBe(45);
    expect(snapRotation(52)).toBe(52);
    expect(snapRotation(49.5)).toBe(49.5);
    expect(snapRotation(43, true)).toBe(43);
    expect(snapRotation(-91)).toBe(-90);
  });

  it('keeps yaw within (-180, 180]', () => {
    expect(normalizeYaw(270)).toBe(-90);
    expect(normalizeYaw(-180)).toBe(180);
    expect(normalizeYaw(540)).toBe(180);
    expect(normalizeYaw(-30)).toBe(-30);
  });

  it('turns the shape about its box centre, a quarter turn by dragging the handle a quarter round', () => {
    const vs: Vertex[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    // The handle starts above the centre (2, 1); dragged to its left is a quarter turn counter-clockwise
    const r = rotateByDrag(vs, 0, [2, 3], [-0.02, 1.05]);
    expect(r.yaw).toBe(90);
    close(r.vertices, [[3, -1], [3, 3], [1, 3], [1, -1]]);
    // Free with Alt
    const free = rotateByDrag(vs, 0, [2, 3], [-0.02, 1.05], true);
    expect(free.yaw).not.toBe(90);
    expect(Math.abs(free.yaw - 90)).toBeLessThan(2);
  });

  it('rotates on from the current yaw', () => {
    const vs = rect([1, 1], 2, 1, 30);
    const r = rotateShapeBy(vs, 30, 90);
    expect(r.yaw).toBe(120);
    const b = shapeBox(r.vertices, 120);
    expect(b.width).toBeCloseTo(2, 5);
    expect(b.height).toBeCloseTo(1, 5);
    expect(b.centre[0]).toBeCloseTo(1, 5);
    expect(b.centre[1]).toBeCloseTo(1, 5);
  });
});

describe('snapping helpers', () => {
  it('maps a local axis onto a world axis at right angles only', () => {
    expect(localAxisToWorld(0, 0)).toEqual({ axis: 0, sign: 1 });
    expect(localAxisToWorld(90, 0)).toEqual({ axis: 1, sign: 1 });
    expect(localAxisToWorld(90, 1)).toEqual({ axis: 0, sign: -1 });
    expect(localAxisToWorld(180, 1)).toEqual({ axis: 1, sign: -1 });
    expect(localAxisToWorld(30, 0)).toBeNull();
  });

  it('snaps an edge line onto a parallel wall within the tolerance', () => {
    const room: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];
    expect(snapLineToOutline(0, 5.9, 1, 2, room, 0.2)).toEqual({ value: 6, edge: 1 });
    expect(snapLineToOutline(0, 5.5, 1, 2, room, 0.2)).toBeNull();
    expect(snapLineToOutline(1, 0.05, 1, 2, room, 0.2)).toEqual({ value: 0, edge: 0 });
    // Not alongside the wall
    expect(snapLineToOutline(0, 5.9, 5, 6, room, 0.2)).toBeNull();
  });
});

describe('shapeKind', () => {
  it('names rectangles in their own frame and polygons by corner count', () => {
    expect(shapeKind(rect([0, 0], 2, 1, 37), 37)).toBe('Rectangle');
    expect(shapeKind([[0, 0], [2, 0], [3, 1], [0, 1]], 0)).toBe('Polygon, 4 vertices');
    expect(shapeKind([[0, 0], [2, 0], [0, 1]], 0)).toBe('Polygon, 3 vertices');
  });
});
