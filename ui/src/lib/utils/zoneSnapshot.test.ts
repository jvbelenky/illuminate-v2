import { describe, it, expect } from 'vitest';
import { snapshotDimensions, dimensionsMatch } from './zoneSnapshot';
import type { CalcZone } from '$lib/types/project';

const wallPlane = {
  id: 'zw', type: 'plane', name: 'W', surface: 'wall:1', normal_offset: 0, flip: false,
  fit_room: false, wall_vertices: [[0.5, 0.5], [2, 0.5], [2, 2]], num_x: 10, num_y: 10,
} as unknown as CalcZone;

describe('zone dimension snapshots', () => {
  it('an unchanged wall plane still matches its snapshot (including a JSON round trip)', () => {
    const snap = snapshotDimensions(wallPlane);
    expect(dimensionsMatch(wallPlane, snap)).toBe(true);
    expect(dimensionsMatch(wallPlane, JSON.parse(JSON.stringify(snap)))).toBe(true);
  });

  it('a changed normal_offset, flip, wall_vertices or surface makes the snapshot mismatch', () => {
    const snap = snapshotDimensions(wallPlane);
    expect(dimensionsMatch({ ...wallPlane, normal_offset: 0.5 }, snap)).toBe(false);
    expect(dimensionsMatch({ ...wallPlane, flip: true }, snap)).toBe(false);
    expect(dimensionsMatch({ ...wallPlane, wall_vertices: [[0.5, 0.5], [2.5, 0.5], [2, 2]] }, snap)).toBe(false);
    expect(dimensionsMatch({ ...wallPlane, wall_vertices: undefined }, snap)).toBe(false);
    expect(dimensionsMatch({ ...wallPlane, surface: 'wall:2' }, snap)).toBe(false);
  });

  it('a floor plane with no surface matches as before', () => {
    const floor = { id: 'zf', type: 'plane', x1: 0, x2: 2, y1: 0, y2: 2, height: 1, num_x: 5, num_y: 5 } as unknown as CalcZone;
    expect(dimensionsMatch(floor, JSON.parse(JSON.stringify(snapshotDimensions(floor))))).toBe(true);
    expect(dimensionsMatch({ ...floor, height: 2 }, snapshotDimensions(floor))).toBe(false);
  });
});
