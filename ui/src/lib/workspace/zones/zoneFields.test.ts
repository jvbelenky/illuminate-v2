import { describe, it, expect } from 'vitest';
import type { CalcZone } from '$lib/types/project';
import { distanceOf, distancePartial, flipPartial, gridSummary, distanceLabel, isLegacyPlane, spacingText } from './zoneFields';
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
