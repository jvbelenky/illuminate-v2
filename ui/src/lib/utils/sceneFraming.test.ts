import { describe, it, expect } from 'vitest';
import { roomFrame, defaultCameraPosition, presetViewPosition } from './sceneFraming';

describe('roomFrame', () => {
  it('a rectangle at the origin frames as before: centre (x/2, z/2, -y/2), distance 1.4 x longest side', () => {
    const f = roomFrame({ x: 6, y: 4, z: 2.7 });
    expect(f.center).toEqual({ x: 3, y: 1.35, z: -2 });
    expect(f.size).toBe(6);
    expect(f.distance).toBeCloseTo(8.4);
    const d = f.distance;
    expect(defaultCameraPosition(f)).toEqual([-d * 0.7, d * 0.6, d * 0.7]);
    expect(presetViewPosition('front', f)).toEqual([3, 1.35, d]);
    expect(presetViewPosition('back', f)).toEqual([3, 1.35, -4 - d]);
    expect(presetViewPosition('left', f)).toEqual([-d, 1.35, -2]);
    expect(presetViewPosition('right', f)).toEqual([6 + d, 1.35, -2]);
    expect(presetViewPosition('iso-back-right', f)).toEqual([6 + d * 0.7, d * 0.6, -4 - d * 0.7]);
  });

  it("an L-shape drawn away from the origin centres on and fits its own min..max box", () => {
    // Bounding box x 3..5, y 2..3.5; room.x / room.y carry the maxima
    const f = roomFrame({
      x: 5, y: 3.5, z: 2.7, shape: 'polygon',
      vertices: [[3, 2], [5, 2], [5, 2.6], [3.8, 2.6], [3.8, 3.5], [3, 3.5]],
    });
    expect(f.center.x).toBeCloseTo(4);
    expect(f.center.y).toBeCloseTo(1.35);
    expect(f.center.z).toBeCloseTo(-2.75);
    // Fits the outline (longest side is the 2.7 height), not the 0..5 x 0..3.5 box
    expect(f.size).toBeCloseTo(2.7);
    const d = f.distance;
    expect(defaultCameraPosition(f)).toEqual([3 - d * 0.7, d * 0.6, -2 + d * 0.7]);
    // Every side view looks straight at the centre from just outside the box
    expect(presetViewPosition('front', f)).toEqual([4, 1.35, -2 + d]);
    expect(presetViewPosition('left', f)).toEqual([3 - d, 1.35, -2.75]);
    expect(presetViewPosition('right', f)).toEqual([5 + d, 1.35, -2.75]);
    expect(presetViewPosition('back', f)).toEqual([4, 1.35, -3.5 - d]);
  });
});
