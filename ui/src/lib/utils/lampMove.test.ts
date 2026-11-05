import { describe, it, expect } from 'vitest';
import { moveLampKeepingAim, movePointKeepingAim, pointPlacement } from './lampMove';

const lamp = { x: 2, y: 2, z: 2.7, aimx: 2, aimy: 2, aimz: 0 };

describe('moveLampKeepingAim', () => {
  it('moves the lamp only: the aim point stays in the room, so the lamp re-aims at it', () => {
    expect(moveLampKeepingAim(lamp, 3, 1)).toEqual({ x: 3, y: 1, z: 2.7 });
    expect(moveLampKeepingAim(lamp, 3, 1, 2)).toEqual({ x: 3, y: 1, z: 2 });
  });
  it('a lamp landing on its own aim point carries the aim along instead', () => {
    expect(moveLampKeepingAim(lamp, 2, 2, 0)).toEqual({ x: 2, y: 2, z: 0, aimx: 2, aimy: 2, aimz: -2.7 });
  });
});

describe('movePointKeepingAim', () => {
  const point = { x: 1, y: 1, z: 1.2, aim_x: 3, aim_y: 1, aim_z: 1.2 };
  it('moves the point only: its aim target stays, so its direction turns to it', () => {
    expect(movePointKeepingAim(point, 1, 3)).toEqual({ x: 1, y: 3, z: 1.2 });
    expect(movePointKeepingAim(point, 2, 2, 1.8)).toEqual({ x: 2, y: 2, z: 1.8 });
  });
  it('a point landing on its own aim point carries the aim along instead', () => {
    expect(movePointKeepingAim(point, 3, 1)).toEqual({ x: 3, y: 1, z: 1.2, aim_x: 5, aim_y: 1, aim_z: 1.2 });
  });
  it('an aim never set reads as straight up from the point', () => {
    expect(pointPlacement({ x: 2, y: 3, z: 1 })).toEqual({ x: 2, y: 3, z: 1, aimx: 2, aimy: 3, aimz: 2 });
  });
});
