import { describe, expect, it } from 'vitest';
import type { Vertex } from '$lib/utils/roomGeometry';
import { moveReference, normaliseReference, referencePoint, resizeShape, shapeSize, type ReferenceMode } from './shapeGeometry';

// A 2 x 1 box from (1, 1) to (3, 2).
const box: Vertex[] = [[1, 1], [3, 1], [3, 2], [1, 2]];
const close = (a: Vertex, b: Vertex) => {
  expect(a[0]).toBeCloseTo(b[0], 5);
  expect(a[1]).toBeCloseTo(b[1], 5);
};

const AT_YAW_0: Record<ReferenceMode, Vertex> = {
  'corner-bl': [1, 1],
  'corner-br': [3, 1],
  'corner-tl': [1, 2],
  'corner-tr': [3, 2],
  centre: [2, 1.5],
};

/** The box turned 90° counter-clockwise about its middle (2, 1.5). */
const turned: Vertex[] = [[2.5, 0.5], [2.5, 2.5], [1.5, 2.5], [1.5, 0.5]];
// Its own corners: local (x, y) offsets from the middle rotate by +90°: (dx, dy) -> (-dy, dx).
const AT_YAW_90: Record<ReferenceMode, Vertex> = {
  'corner-bl': [2.5, 0.5], // local (-1, -0.5)
  'corner-br': [2.5, 2.5], // local (1, -0.5)
  'corner-tl': [1.5, 0.5], // local (-1, 0.5)
  'corner-tr': [1.5, 2.5], // local (1, 0.5)
  centre: [2, 1.5],
};

const MODES = Object.keys(AT_YAW_0) as ReferenceMode[];

describe('normaliseReference', () => {
  it("reads the old 'corner' as the bottom-left corner and keeps the five modes", () => {
    expect(normaliseReference('corner')).toBe('corner-bl');
    for (const m of MODES) expect(normaliseReference(m)).toBe(m);
    expect(normaliseReference(undefined)).toBe('centre');
    expect(normaliseReference('nonsense')).toBe('centre');
  });
});

describe('referencePoint', () => {
  it.each(MODES)('%s at yaw 0', (m) => close(referencePoint(box, 0, m), AT_YAW_0[m]));
  it.each(MODES)('%s at yaw 90 is the shape\'s own corner', (m) => close(referencePoint(turned, 90, m), AT_YAW_90[m]));
  it("'corner' is the bottom-left corner", () => {
    close(referencePoint(box, 0, 'corner'), [1, 1]);
    close(referencePoint(turned, 90, 'corner'), AT_YAW_90['corner-bl']);
  });
});

describe('moveReference', () => {
  it.each(MODES)('%s: the chosen point lands on the value, the shape keeps its size', (m) => {
    for (const [vs, yaw, pts] of [[box, 0, AT_YAW_0], [turned, 90, AT_YAW_90]] as const) {
      const moved = moveReference([...vs], yaw, m, 0, 10);
      expect(referencePoint(moved, yaw, m)[0]).toBeCloseTo(10, 5);
      expect(referencePoint(moved, yaw, m)[1]).toBeCloseTo(pts[m][1], 5);
      const moved2 = moveReference(moved, yaw, m, 1, -4);
      close(referencePoint(moved2, yaw, m), [10, -4]);
      expect(shapeSize(moved2, yaw)).toEqual(shapeSize([...vs], yaw));
    }
  });
  it("'corner' moves the bottom-left corner", () => {
    close(referencePoint(moveReference(box, 0, 'corner', 0, 5), 0, 'corner-bl'), [5, 1]);
  });
});

describe('resizeShape', () => {
  it.each(MODES)('%s stays fixed when the width or length changes, at yaw 0 and 90', (m) => {
    for (const [vs, yaw, pts] of [[box, 0, AT_YAW_0], [turned, 90, AT_YAW_90], [box, 30, null]] as const) {
      const before = referencePoint([...vs], yaw, m);
      if (pts) close(before, pts[m]);
      const wider = resizeShape([...vs], yaw, m, 'width', 4);
      expect(shapeSize(wider, yaw).width).toBeCloseTo(4, 5);
      close(referencePoint(wider, yaw, m), before);
      const longer = resizeShape(wider, yaw, m, 'length', 3);
      expect(shapeSize(longer, yaw).length).toBeCloseTo(3, 5);
      close(referencePoint(longer, yaw, m), before);
    }
  });
  it('a bottom-right width change grows to the left; a top-left length change grows downward', () => {
    const w = resizeShape(box, 0, 'corner-br', 'width', 4);
    expect(Math.min(...w.map((v) => v[0]))).toBeCloseTo(-1, 5);
    const l = resizeShape(box, 0, 'corner-tl', 'length', 3);
    expect(Math.min(...l.map((v) => v[1]))).toBeCloseTo(-1, 5);
  });
  it("'corner' keeps the bottom-left corner fixed", () => {
    close(referencePoint(resizeShape(box, 0, 'corner', 'width', 5), 0, 'corner-bl'), [1, 1]);
  });
});
