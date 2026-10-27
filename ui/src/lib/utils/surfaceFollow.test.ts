import { describe, it, expect } from 'vitest';
import type { CalcZone, RoomConfig } from '$lib/types/project';
import { followSurfaces, strandedWallPlane } from './surfaceFollow';

const rect = (x: number, y: number, z: number) => ({ x, y, z, shape: 'rectangle' }) as RoomConfig;
const poly = (vertices: [number, number][], z = 3) =>
  ({ x: 6, y: 4, z, shape: 'polygon', vertices }) as RoomConfig;
const plane = (over: Partial<CalcZone>): CalcZone => ({ id: 'a', type: 'plane', ...over }) as CalcZone;
const TOL = 1e-4;

describe('followSurfaces', () => {
  it('ceiling plane keeps its distance below the ceiling', () => {
    const z = plane({ surface: 'ceiling', height: 2.7 });
    const out = followSurfaces([z], rect(6, 4, 3), rect(6, 4, 3.5), TOL);
    expect(out).toHaveLength(1);
    expect(out[0].partial.height).toBeCloseTo(3.2);
  });

  it('floor plane is unchanged by a height change', () => {
    const z = plane({ surface: 'floor', height: 0.75 });
    expect(followSurfaces([z], rect(6, 4, 3), rect(6, 4, 3.5), TOL)).toEqual([]);
  });

  it('wall plane follows its wall when the room is scaled', () => {
    const z = plane({ surface: 'wall:1' });
    const out = followSurfaces([z], rect(6, 4, 3), rect(8, 5, 3), TOL);
    expect(out).toHaveLength(1);
    expect(out[0].partial.surface).toBe('wall:1');
  });

  it('wall plane re-attaches by position when corners are inserted before it', () => {
    const prev = poly([[0, 0], [6, 0], [6, 4], [0, 4]]);
    const next = poly([[0, 0], [3, 0], [6, 0], [6, 4], [0, 4]]);
    // wall:1 (the x=6 wall) becomes wall:2
    const out = followSurfaces([plane({ surface: 'wall:1' })], prev, next, TOL);
    expect(out[0].partial.surface).toBe('wall:2');
  });

  it('re-expresses a drawn outline on the new wall', () => {
    const prev = poly([[0, 0], [6, 0], [6, 4], [0, 4]]);
    const next = poly([[0, 0], [3, 0], [6, 0], [6, 4], [0, 4]]);
    // the south wall (wall:0) now starts at the same corner, so use the x=6 wall
    // whose start corner is unchanged: along stays the same
    const z = plane({ surface: 'wall:1', wall_vertices: [[1, 0.5], [2, 0.5], [2, 1.5]] });
    const out = followSurfaces([z], prev, next, TOL);
    expect(out[0].partial.surface).toBe('wall:2');
    expect(out[0].partial.wall_vertices).toEqual([[1, 0.5], [2, 0.5], [2, 1.5]]);
  });

  it('fit wall plane drops its outline to cover the resized wall', () => {
    const z = plane({ surface: 'wall:0', fit_room: true, wall_vertices: [[0, 0], [6, 0], [6, 3]] });
    const out = followSurfaces([z], rect(6, 4, 3), rect(8, 4, 3), TOL);
    expect(out[0].partial).toHaveProperty('wall_vertices', undefined);
  });

  it('outline that no longer fits is kept and reported stranded', () => {
    const z = plane({ surface: 'wall:0', wall_vertices: [[0, 0], [5, 0], [5, 2.5]] });
    const next = rect(4, 4, 3);
    const out = followSurfaces([z], rect(6, 4, 3), next, TOL);
    expect(out.every((o) => !('wall_vertices' in o.partial))).toBe(true);
    expect(strandedWallPlane(z, next)).toBe(true);
    expect(strandedWallPlane(z, rect(6, 4, 3))).toBe(false);
  });

  it('deleted wall -> stranded, surface unchanged', () => {
    const prev = poly([[0, 0], [6, 0], [6, 4], [2, 6]]);
    const next = poly([[0, 0], [6, 0], [0, 4]]);
    const z = plane({ surface: 'wall:3' });
    const out = followSurfaces([z], prev, next, TOL);
    expect(out.every((o) => o.partial.surface === undefined || o.partial.surface === 'wall:3')).toBe(true);
    expect(strandedWallPlane(z, next)).toBe(true);
  });
});
