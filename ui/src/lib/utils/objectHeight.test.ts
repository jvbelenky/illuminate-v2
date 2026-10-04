import { describe, it, expect } from 'vitest';
import { isFloorToCeiling, floorToCeilingUpdate, bottomUpdate, topUpdate, objectHeightText } from './objectHeight';

describe('objectHeight', () => {
  it('detects floor to ceiling within tolerance', () => {
    expect(isFloorToCeiling({ z: 0, height: 2.7 }, 2.7)).toBe(true);
    expect(isFloorToCeiling({ z: 0, height: 2.7000000001 }, 2.7)).toBe(true);
    expect(isFloorToCeiling({ z: 0.1, height: 2.6 }, 2.7)).toBe(false);
    expect(isFloorToCeiling({ z: 0, height: 2.0 }, 2.7)).toBe(false);
  });

  it('full-height update spans the room', () => {
    expect(floorToCeilingUpdate(3)).toEqual({ z: 0, height: 3 });
  });

  it('moving the bottom keeps the top in place', () => {
    expect(bottomUpdate({ z: 0, height: 1.5 }, 0.7)).toEqual({ z: 0.7, height: 0.8 });
  });

  it('moving the bottom above the top leaves a minimal slab', () => {
    expect(bottomUpdate({ z: 0, height: 1 }, 2)).toEqual({ z: 2, height: 0.001 });
  });

  it('moving the top keeps the bottom in place', () => {
    expect(topUpdate({ z: 0.7, height: 0.8 }, 2.2).height).toBeCloseTo(1.5, 9);
    expect(topUpdate({ z: 0.7, height: 0.8 }, 0.1)).toEqual({ height: 0.001 });
  });

  it('describes the height for a row', () => {
    expect(objectHeightText({ z: 0, height: 2.7 }, 2.7, 1, 'm')).toBe('floor to ceiling');
    expect(objectHeightText({ z: 0.7, height: 0.8 }, 2.7, 1, 'm')).toBe('0.7 to 1.5 m');
  });
});
