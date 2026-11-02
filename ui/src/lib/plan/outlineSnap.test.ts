import { describe, it, expect } from 'vitest';
import { snapPointToOutline, snapTranslationToOutline, edgeAxis } from './outlineSnap';
import type { Vertex } from '$lib/utils/roomGeometry';

const room: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const TOL = 0.1;

describe('snapPointToOutline', () => {
  it('a corner near a wall goes onto the wall', () => {
    const s = snapPointToOutline([2.5, 0.07], room, TOL)!;
    expect(s.point[0]).toBeCloseTo(2.5, 12);
    expect(s.point[1]).toBeCloseTo(0, 12);
    expect(s.edge).toBe(0);
    expect(s.corner).toBeNull();
    const e = snapPointToOutline([5.95, 2], room, TOL)!;
    expect(e.point).toEqual([6, 2]);
    expect(e.edge).toBe(1);
  });

  it('a corner near an outline corner goes onto the corner', () => {
    const s = snapPointToOutline([5.94, 3.95], room, TOL)!;
    expect(s.point).toEqual([6, 4]);
    expect(s.corner).toBe(2);
    expect(s.edge).toBeNull();
  });

  it('an angled wall: the point goes onto it along its normal', () => {
    const tri: Vertex[] = [[0, 0], [4, 0], [0, 4]];
    // The hypotenuse x + y = 4; (2.05, 2.03) is 0.057 off it
    const s = snapPointToOutline([2.05, 2.03], tri, TOL)!;
    expect(s.point[0] + s.point[1]).toBeCloseTo(4, 12);
    expect(s.point[0] - s.point[1]).toBeCloseTo(0.02, 12);
    expect(s.edge).toBe(1);
  });

  it('beyond tolerance, or with tolerance 0 (Alt), nothing happens', () => {
    expect(snapPointToOutline([2.5, 0.2], room, TOL)).toBeNull();
    expect(snapPointToOutline([2.5, 0.05], room, 0)).toBeNull();
    expect(snapPointToOutline([2.5, 0.05], undefined, TOL)).toBeNull();
  });
});

describe('snapTranslationToOutline', () => {
  const box = (x: number, y: number, w = 1, h = 1): Vertex[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  it('a body drag near a wall goes flush', () => {
    // 0.06 short of the right wall
    const s = snapTranslationToOutline(box(4.94, 1.5), room, TOL)!;
    expect(s.offset[0]).toBeCloseTo(0.06, 12);
    expect(s.offset[1]).toBeCloseTo(0, 12);
    expect(s.x).toBe(true);
    expect(s.y).toBe(false);
    expect(s.edges).toEqual([1]);
    // Past the wall comes back flush too
    const back = snapTranslationToOutline(box(5.04, 1.5), room, TOL)!;
    expect(back.offset[0]).toBeCloseTo(-0.04, 12);
  });

  it('in a room corner, flush to both walls', () => {
    const s = snapTranslationToOutline(box(0.05, 2.93), room, TOL)!;
    expect(s.offset[0]).toBeCloseTo(-0.05, 12);
    expect(s.offset[1]).toBeCloseTo(0.07, 12);
    expect(s.x && s.y).toBe(true);
    expect(s.edges.sort()).toEqual([2, 3]);
  });

  it('an angled wall snaps along its normal', () => {
    const tri: Vertex[] = [[0, 0], [4, 0], [0, 4]];
    // A small square whose top-right corner is 0.05 / sqrt(2) inside the hypotenuse
    const s = snapTranslationToOutline(box(1, 1, 0.5, 0.5).map(([x, y]) => [x + 0.475, y + 0.475] as Vertex), tri, TOL)!;
    expect(s.offset[0]).toBeCloseTo(0.025, 12);
    expect(s.offset[1]).toBeCloseTo(0.025, 12);
    expect(s.x && s.y).toBe(true);
    expect(s.edges).toEqual([1]);
  });

  it('an angled wall and a floor wall at once: the corner sits in the joint', () => {
    const tri: Vertex[] = [[0, 0], [4, 0], [0, 4]];
    // A corner near (4, 0): 0.03 above the floor wall and left of the hypotenuse
    const s = snapTranslationToOutline([[3.9, 0.03], [3, 0.03], [3, 0.5]], tri, TOL)!;
    const moved = [3.9 + s.offset[0], 0.03 + s.offset[1]];
    expect(moved[1]).toBeCloseTo(0, 12);
    expect(moved[0] + moved[1]).toBeCloseTo(4, 12);
  });

  it('beyond tolerance, or with tolerance 0 (Alt), nothing happens', () => {
    expect(snapTranslationToOutline(box(4.8, 1.5), room, TOL)).toBeNull();
    expect(snapTranslationToOutline(box(4.94, 1.5), room, 0)).toBeNull();
    // Alongside a wall's line but far past its end does not count
    const l: Vertex[] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 5], [0, 5]];
    expect(snapTranslationToOutline(box(1, 1.95), l, TOL)).toBeNull();
  });
});

describe('edgeAxis', () => {
  it('names horizontal, vertical and angled edges', () => {
    expect(edgeAxis(room, 0)).toBe('horizontal');
    expect(edgeAxis(room, 1)).toBe('vertical');
    expect(edgeAxis([[0, 0], [4, 0], [0, 4]], 1)).toBeNull();
  });
});
