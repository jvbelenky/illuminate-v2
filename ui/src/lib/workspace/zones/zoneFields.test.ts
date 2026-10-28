import { describe, it, expect } from 'vitest';
import type { CalcZone } from '$lib/types/project';
import { distanceOf, distancePartial, flipPartial, gridSummary, distanceLabel, isLegacyPlane, spacingText, surfacePartial, surfaceChoice, fitPartial, editRange, rangePartial } from './zoneFields';
import { defaultRoom } from '$lib/types/project';
import { zoneSurface } from '$lib/utils/surfaces';

const plane = (extra: Partial<CalcZone> = {}): CalcZone => ({ id: 'z', type: 'plane', ...extra });

describe('distance from the surface', () => {
  it('on the floor it is the height, both ways', () => {
    const z = plane({ surface: 'floor', height: 1.8 });
    expect(distanceOf(z, 'floor', 2.7)).toBe(1.8);
    expect(distancePartial(z, 'floor', 2.7, 0.75)).toEqual({ height: 0.75 });
  });

  it('on the ceiling it is the room height less the plane height, both ways', () => {
    const z = plane({ surface: 'ceiling', height: 2.4, direction: -1 });
    expect(distanceOf(z, 'ceiling', 2.7)).toBeCloseTo(0.3, 9);
    const p = distancePartial(z, 'ceiling', 2.7, 0.5);
    expect(Object.keys(p)).toEqual(['height']);
    expect(p.height).toBeCloseTo(2.2, 9);
    expect(distanceOf({ ...z, ...p }, 'ceiling', 2.7)).toBeCloseTo(0.5, 9);
  });

  it('on a wall it is the offset from the wall, defaulting to 0, and never touches height', () => {
    const z = plane({ surface: 'wall:2' });
    expect(distanceOf(z, 'wall:2', 2.7)).toBe(0);
    expect(distanceOf({ ...z, normal_offset: 0.4 }, 'wall:2', 2.7)).toBe(0.4);
    expect(distancePartial(z, 'wall:2', 2.7, 0.6)).toEqual({ normal_offset: 0.6 });
  });

  it('a legacy ceiling plane (no stored surface) stays on the ceiling after Below ceiling and Flip', () => {
    const z = plane({ height: 2.7, direction: -1 });
    expect(zoneSurface(z, 2.7)).toBe('ceiling');
    const moved = { ...z, ...distancePartial(z, 'ceiling', 2.7, 0.5) };
    expect(moved.height).toBeCloseTo(2.2, 9);
    expect(zoneSurface(moved, 2.7)).toBe('ceiling');
    const flipped = { ...z, ...flipPartial(z, 'ceiling') };
    expect(flipped.direction).toBe(1);
    expect(zoneSurface(flipped, 2.7)).toBe('ceiling');
  });

  it('labels the distance by surface', () => {
    expect(distanceLabel('floor')).toBe('Height');
    expect(distanceLabel('ceiling')).toBe('Below ceiling');
    expect(distanceLabel('wall:0')).toBe('From wall');
  });
});

describe('flip', () => {
  it('on the floor or ceiling negates direction', () => {
    expect(flipPartial(plane({ surface: 'floor', direction: 1 }), 'floor')).toEqual({ direction: -1 });
    expect(flipPartial(plane({ surface: 'ceiling', direction: -1 }), 'ceiling')).toEqual({ direction: 1 });
    // Unset direction: a floor plane faces up, a ceiling plane down
    expect(flipPartial(plane({ surface: 'floor' }), 'floor')).toEqual({ direction: -1 });
    expect(flipPartial(plane({ surface: 'ceiling' }), 'ceiling')).toEqual({ direction: 1 });
  });

  it('a plane with no stored surface keeps the one it is on', () => {
    expect(flipPartial(plane(), 'floor')).toEqual({ direction: -1, surface: 'floor' });
  });

  it('on a wall toggles flip', () => {
    expect(flipPartial(plane({ surface: 'wall:1' }), 'wall:1')).toEqual({ flip: true });
    expect(flipPartial(plane({ surface: 'wall:1', flip: true }), 'wall:1')).toEqual({ flip: false });
  });
});

describe('grid summary', () => {
  it('a plane shows two counts and a volume three', () => {
    expect(gridSummary(plane({ num_x: 10, num_y: 12 }))).toBe('10 × 12');
    expect(gridSummary({ id: 'v', type: 'volume', num_x: 10, num_y: 12, num_z: 8 })).toBe('10 × 12 × 8');
  });

  it('spacing text follows the mode', () => {
    const z = plane({ num_x: 10, num_y: 12, x_spacing: 0.5, y_spacing: 0.25 });
    expect(spacingText(z, 'm', 2)).toBe('0.50 × 0.25 m');
    expect(spacingText({ ...z, resolution_mode: 'spacing' }, 'm', 2)).toBe('10 × 12 points');
  });
});

describe('legacy planes', () => {
  it('a vertical plane on no wall is legacy; wall, floor and ceiling planes are not', () => {
    expect(isLegacyPlane(plane({ ref_surface: 'xz' }))).toBe(true);
    expect(isLegacyPlane(plane({ ref_surface: 'yz' }))).toBe(true);
    expect(isLegacyPlane(plane({ ref_surface: 'xz', surface: 'wall:0' }))).toBe(false);
    expect(isLegacyPlane(plane({ ref_surface: 'xy' }))).toBe(false);
    expect(isLegacyPlane({ type: 'volume' })).toBe(false);
  });
});

describe('moving a plane to another surface', () => {
  const room = { ...defaultRoom(), x: 6, y: 4, z: 2.7 };

  it('the floor: whole room at eye height, facing up, wall fields cleared', () => {
    const p = surfacePartial('floor', room, 'meters');
    expect(p).toMatchObject({ surface: 'floor', fit_room: true, height: 1.8, direction: 1, ref_surface: 'xy', x1: 0, x2: 6, y1: 0, y2: 4 });
    for (const k of ['normal_offset', 'flip', 'wall_vertices', 'vertices', 'wall_orphan'] as const) {
      expect(k in p && p[k] === undefined).toBe(true);
    }
  });

  it('eye height is in the project units', () => {
    expect(surfacePartial('floor', room, 'feet').height).toBeCloseTo(5.91, 2);
  });

  it('the ceiling: whole room at the ceiling, facing down', () => {
    const p = surfacePartial('ceiling', room, 'meters');
    expect(p).toMatchObject({ surface: 'ceiling', fit_room: true, height: 2.7, direction: -1, ref_surface: 'xy' });
    expect('wall_orphan' in p).toBe(true);
  });

  it('a wall: the whole wall, on it, unflipped', () => {
    const p = surfacePartial('wall:2', room, 'meters');
    expect(p).toEqual({ surface: 'wall:2', fit_room: true, normal_offset: 0, flip: false, wall_vertices: undefined, wall_orphan: undefined });
  });

  it('the select value: the surface, or none for an orphan or a legacy plane', () => {
    expect(surfaceChoice(plane({ surface: 'wall:1' }), 2.7)).toBe('wall:1');
    expect(surfaceChoice(plane({ surface: 'wall:1', wall_orphan: true }), 2.7)).toBe('');
    expect(surfaceChoice(plane({ ref_surface: 'xz' }), 2.7)).toBe('');
    expect(surfaceChoice(plane({ height: 2.7, direction: -1 }), 2.7)).toBe('ceiling');
  });
});

describe('Fit to room', () => {
  const room = { ...defaultRoom(), x: 6, y: 4, z: 2.7 };

  it('on refits a floor plane to the room; off keeps what it shows as explicit bounds', () => {
    const z = plane({ surface: 'floor', height: 1, fit_room: false, x1: 1, x2: 2, y1: 1, y2: 3 });
    expect(fitPartial(z, room, true)).toMatchObject({ fit_room: true, x1: 0, x2: 6, y1: 0, y2: 4, vertices: undefined });
    const fit = plane({ surface: 'floor', height: 1, fit_room: true });
    expect(fitPartial(fit, room, false)).toEqual({ fit_room: false, x1: 0, x2: 6, y1: 0, y2: 4, vertices: undefined });
  });

  it('on a wall: on clears the outline, off keeps the whole wall as an outline', () => {
    const z = plane({ surface: 'wall:0', fit_room: true, normal_offset: 0 });
    expect(fitPartial(z, room, true)).toEqual({ fit_room: true, wall_vertices: undefined });
    expect(fitPartial(z, room, false)).toEqual({ fit_room: false, wall_vertices: [[0, 0], [6, 0], [6, 2.7], [0, 2.7]] });
  });

  it('a volume: on fills floor to ceiling, off keeps its footprint', () => {
    const v: CalcZone = { id: 'v', type: 'volume', fit_room: false, x_min: 1, x_max: 2, y_min: 1, y_max: 2, z_min: 0.5, z_max: 1 };
    expect(fitPartial(v, room, true)).toMatchObject({ fit_room: true, x_min: 0, x_max: 6, y_min: 0, y_max: 4, z_min: 0, z_max: 2.7 });
    expect(fitPartial({ ...v, fit_room: true, x_min: undefined }, room, false)).toEqual({ fit_room: false, x_min: 0, x_max: 6, y_min: 0, y_max: 4, vertices: undefined });
  });
});

describe('range edits', () => {
  it('sets one end, keeping the other; the ends swap rather than cross', () => {
    expect(editRange([0, 6, 0, 4], 1, 3)).toEqual([0, 3, 0, 4]);
    expect(editRange([2, 6, 0, 4], 0, 7)).toEqual([6, 7, 0, 4]);
    expect(editRange([0, 6, 0, 4], 2, 1)).toEqual([0, 6, 1, 4]);
  });

  it('refuses an empty range', () => {
    expect(editRange([0, 6, 0, 4], 0, 6)).toBeNull();
  });

  it('writes the rectangle for each kind, turning Fit off', () => {
    expect(rangePartial('plane', [1, 2, 3, 4])).toEqual({ x1: 1, x2: 2, y1: 3, y2: 4, vertices: undefined, fit_room: false });
    expect(rangePartial('volume', [1, 2, 3, 4])).toEqual({ x_min: 1, x_max: 2, y_min: 3, y_max: 4, vertices: undefined, fit_room: false });
    expect(rangePartial('wall', [1, 2, 0, 1])).toEqual({ wall_vertices: [[1, 0], [2, 0], [2, 1], [1, 1]], fit_room: false });
  });
});
