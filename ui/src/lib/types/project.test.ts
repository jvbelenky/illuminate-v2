/**
 * Tests for project type helpers.
 */

import { describe, it, expect } from 'vitest';
import { defaultZone, defaultRoom, defaultObject } from './project';

describe('defaultZone', () => {
  it('honors minutes and seconds overrides for dose time', () => {
    const zone = defaultZone(defaultRoom(), 0, { dose: true, hours: 2, minutes: 30, seconds: 15 });
    expect(zone.hours).toBe(2);
    expect(zone.minutes).toBe(30);
    expect(zone.seconds).toBe(15);
  });

  it('defaults minutes and seconds to 0 when not overridden', () => {
    const zone = defaultZone(defaultRoom(), 0, { dose: true });
    expect(zone.minutes).toBe(0);
    expect(zone.seconds).toBe(0);
  });
});

describe('defaultObject', () => {
  it('stands a 1 m box on the floor at the centre of a rectangular room', () => {
    const obj = defaultObject(defaultRoom({ x: 4, y: 6, z: 3 }), 'meters');
    expect(obj).toMatchObject({ shape: 'box', width: 1, length: 1, height: 1, x: 2, y: 3, z: 0, reflectance: 0, transmittance: 0, enabled: true });
  });
  it('uses 3 ft sides in feet', () => {
    expect(defaultObject(defaultRoom(), 'feet').width).toBe(3);
  });
  it('avoids the notch of an L-shaped room', () => {
    // L room: 6 x 6 bounding box with the top-right 3 x 3 missing; the bounding
    // centre (3, 3) sits exactly on the inner corner, so prefer the centroid.
    const room = { ...defaultRoom({ x: 6, y: 6, z: 3 }), shape: 'polygon' as const, vertices: [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]] as [number, number][] };
    const obj = defaultObject(room, 'meters');
    expect(obj.x).toBeLessThan(3);
    expect(obj.y).toBeLessThan(3);
  });
});
