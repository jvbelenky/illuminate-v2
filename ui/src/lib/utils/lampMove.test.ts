import { describe, it, expect } from 'vitest';
import { moveLampKeepingAim } from './lampMove';

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
