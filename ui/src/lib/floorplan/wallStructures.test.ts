import { describe, it, expect } from 'vitest';
import { wallNames, wallObject } from './wallStructures';
import { defaultObject, defaultRoom } from '$lib/types/project';

const base = defaultObject(defaultRoom(), 'meters');

describe('wallNames', () => {
  it('counts from 1 and steps past names already taken', () => {
    expect(wallNames([], 3)).toEqual(['Wall 1', 'Wall 2', 'Wall 3']);
    expect(wallNames([{ name: 'Wall 1' }, { name: 'Wall 3' }, { name: 'Structure 1' }], 3)).toEqual(['Wall 2', 'Wall 4', 'Wall 5']);
  });
});

describe('wallObject', () => {
  it('a wall along x: a box that long, that thick, floor to ceiling, with the structure defaults', () => {
    const o = wallObject({ a: [1, 2], b: [4, 2], thickness: 0.1 }, 1, 2.7, 'Wall 1', base);
    expect(o).toMatchObject({ shape: 'box', name: 'Wall 1', width: 3, length: 0.1, height: 2.7, x: 2.5, y: 2, z: 0, yaw: 0 });
    expect(o.reflectance).toBe(base.reflectance);
    expect(o.transmittance).toBe(base.transmittance);
  });

  it('a wall along y is long in y with no turn; a thin one is built 5 cm thick', () => {
    const o = wallObject({ a: [1, 3], b: [1, 0.5], thickness: 0.01 }, 1, 2.7, 'Wall 2', base);
    expect(o).toMatchObject({ width: 0.05, length: 2.5, x: 1, y: 1.75, yaw: 0 });
  });

  it('an oblique wall turns by its angle; display units scale everything', () => {
    const o = wallObject({ a: [0, 0], b: [1, 1], thickness: 0.1 }, 100, 270, 'Wall 3', base);
    expect(o.yaw).toBeCloseTo(45, 6);
    expect(o.width).toBeCloseTo(141.421356, 4);
    expect(o.length).toBeCloseTo(10, 6);
    expect(o).toMatchObject({ x: 50, y: 50, height: 270 });
  });
});
