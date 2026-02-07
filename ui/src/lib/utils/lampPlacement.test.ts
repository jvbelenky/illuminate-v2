/**
 * Tests for lamp placement utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  findOptimalLampPosition,
  getDownlightPlacement,
  getCornerPlacement,
  getEdgePlacement,
  type LampPlacement,
} from './lampPlacement';
import type { RoomConfig, LampInstance } from '$lib/types/project';
import { defaultSurfaceSpacings, defaultSurfaceNumPoints, ROOM_DEFAULTS } from '$lib/types/project';

// Helper to create a minimal room config for testing
function createRoom(x: number = 5, y: number = 5, z: number = 3, units: 'meters' | 'feet' = 'meters'): RoomConfig {
  const r = ROOM_DEFAULTS.reflectance;
  return {
    x,
    y,
    z,
    units,
    precision: 2,
    standard: 'ACGIH',
    enable_reflectance: false,
    reflectances: { floor: r, ceiling: r, north: r, south: r, east: r, west: r },
    reflectance_spacings: defaultSurfaceSpacings(),
    reflectance_num_points: defaultSurfaceNumPoints(x, y, z),
    reflectance_resolution_mode: ROOM_DEFAULTS.reflectance_resolution_mode,
    reflectance_max_num_passes: ROOM_DEFAULTS.reflectance_max_num_passes,
    reflectance_threshold: ROOM_DEFAULTS.reflectance_threshold,
    air_changes: 2,
    ozone_decay_constant: 4.6,
    colormap: 'plasma',
    useStandardZones: true,
  };
}

// Helper to create a lamp at a position
function createLamp(x: number, y: number, z: number, id: string = 'lamp-1'): LampInstance {
  return {
    id,
    lamp_type: 'krcl_222',
    x,
    y,
    z,
    aimx: x,
    aimy: y,
    aimz: 0,
    scaling_factor: 1,
    enabled: true,
  };
}

describe('findOptimalLampPosition', () => {
  it('places first lamp at room center', () => {
    const room = createRoom(10, 8, 3);
    const pos = findOptimalLampPosition(room, []);

    expect(pos.x).toBe(5);
    expect(pos.y).toBe(4);
  });

  it('places second lamp away from first', () => {
    const room = createRoom(10, 10, 3);
    const existingLamps = [createLamp(5, 5, 2.9)];

    const pos = findOptimalLampPosition(room, existingLamps);

    // Should be far from center
    const distFromCenter = Math.sqrt((pos.x - 5) ** 2 + (pos.y - 5) ** 2);
    expect(distFromCenter).toBeGreaterThan(2);
  });

  it('respects wall offset', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const pos = findOptimalLampPosition(room, [createLamp(2.5, 2.5, 2.9)]);

    // Wall offset is 0.1m, so position should be at least 0.1 from edges
    expect(pos.x).toBeGreaterThanOrEqual(0.1);
    expect(pos.x).toBeLessThanOrEqual(4.9);
    expect(pos.y).toBeGreaterThanOrEqual(0.1);
    expect(pos.y).toBeLessThanOrEqual(4.9);
  });

  it('uses feet offset for feet units', () => {
    const room = createRoom(10, 10, 10, 'feet');
    const pos = findOptimalLampPosition(room, []);

    // Position should be in room center
    expect(pos.x).toBe(5);
    expect(pos.y).toBe(5);
  });

  it('handles multiple existing lamps', () => {
    const room = createRoom(10, 10, 3);
    const existingLamps = [
      createLamp(2, 2, 2.9, 'lamp-1'),
      createLamp(8, 2, 2.9, 'lamp-2'),
      createLamp(2, 8, 2.9, 'lamp-3'),
    ];

    const pos = findOptimalLampPosition(room, existingLamps);

    // Should place away from all existing lamps
    expect(pos.x).toBeGreaterThan(4);
    expect(pos.y).toBeGreaterThan(4);
  });
});

describe('getDownlightPlacement', () => {
  it('returns position at ceiling with wall offset', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const placement = getDownlightPlacement(room, []);

    // Should be at ceiling with offset (3 - 0.1 = 2.9)
    expect(placement.z).toBeCloseTo(2.9, 5);
  });

  it('aims at floor directly below', () => {
    const room = createRoom(5, 5, 3);
    const placement = getDownlightPlacement(room, []);

    expect(placement.aimx).toBe(placement.x);
    expect(placement.aimy).toBe(placement.y);
    expect(placement.aimz).toBe(0);
  });

  it('uses optimal position from grid algorithm', () => {
    const room = createRoom(10, 10, 3);
    const placement = getDownlightPlacement(room, []);

    // First lamp should be at center
    expect(placement.x).toBe(5);
    expect(placement.y).toBe(5);
  });

  it('nextIndex is always 0 for downlight mode', () => {
    const room = createRoom(5, 5, 3);
    const placement = getDownlightPlacement(room, []);

    expect(placement.nextIndex).toBe(0);
  });
});

describe('getCornerPlacement', () => {
  it('returns position at ceiling corner with offset', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const placement = getCornerPlacement(room, []);

    // Should be near a corner at ceiling height
    expect(placement.z).toBeCloseTo(2.9, 5);

    // Should be near corner (with offset)
    const nearXMin = Math.abs(placement.x - 0.1) < 0.01;
    const nearXMax = Math.abs(placement.x - 4.9) < 0.01;
    const nearYMin = Math.abs(placement.y - 0.1) < 0.01;
    const nearYMax = Math.abs(placement.y - 4.9) < 0.01;

    expect(nearXMin || nearXMax).toBe(true);
    expect(nearYMin || nearYMax).toBe(true);
  });

  it('aims at opposite floor corner', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const placement = getCornerPlacement(room, []);

    // If position is at (0.1, 0.1), aim should be at (5, 5, 0)
    if (placement.x < 1 && placement.y < 1) {
      expect(placement.aimx).toBe(5);
      expect(placement.aimy).toBe(5);
    }
    expect(placement.aimz).toBe(0);
  });

  it('cycles through corners with currentIndex', () => {
    const room = createRoom(5, 5, 3, 'meters');

    const placement0 = getCornerPlacement(room, [], 0);
    const placement1 = getCornerPlacement(room, [], 1);
    const placement2 = getCornerPlacement(room, [], 2);
    const placement3 = getCornerPlacement(room, [], 3);
    const placement4 = getCornerPlacement(room, [], 0); // Wraps back

    // Each should be at a different corner
    expect(placement0.nextIndex).toBe(1);
    expect(placement1.nextIndex).toBe(2);
    expect(placement2.nextIndex).toBe(3);
    expect(placement3.nextIndex).toBe(0);
    expect(placement4.nextIndex).toBe(1);
  });

  it('finds furthest corner from existing lamps', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const existingLamps = [createLamp(0.1, 0.1, 2.9)];

    const placement = getCornerPlacement(room, existingLamps);

    // Should be at the opposite corner
    expect(placement.x).toBeCloseTo(4.9, 1);
    expect(placement.y).toBeCloseTo(4.9, 1);
  });
});

describe('getEdgePlacement', () => {
  it('returns position at ceiling edge center', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const placement = getEdgePlacement(room, []);

    // Should be at ceiling height
    expect(placement.z).toBeCloseTo(2.9, 5);

    // Should be at edge center (one coordinate at wall, other at center)
    const atWall = Math.abs(placement.x - 0.1) < 0.01 || Math.abs(placement.x - 4.9) < 0.01 ||
                   Math.abs(placement.y - 0.1) < 0.01 || Math.abs(placement.y - 4.9) < 0.01;
    expect(atWall).toBe(true);
  });

  it('aims at opposite floor edge', () => {
    const room = createRoom(5, 5, 3, 'meters');
    const placement = getEdgePlacement(room, []);

    // Aim should be at floor
    expect(placement.aimz).toBe(0);

    // Aim should be at opposite wall
    if (placement.x < 1) {
      expect(placement.aimx).toBe(5); // Aim at X=max
    }
  });

  it('cycles through edges with currentIndex', () => {
    const room = createRoom(5, 5, 3, 'meters');

    const placement0 = getEdgePlacement(room, [], 0);
    const placement1 = getEdgePlacement(room, [], 1);
    const placement2 = getEdgePlacement(room, [], 2);
    const placement3 = getEdgePlacement(room, [], 3);

    expect(placement0.nextIndex).toBe(1);
    expect(placement1.nextIndex).toBe(2);
    expect(placement2.nextIndex).toBe(3);
    expect(placement3.nextIndex).toBe(0);
  });

  it('finds furthest edge from existing lamps', () => {
    const room = createRoom(5, 5, 3, 'meters');
    // Lamp at x=0 edge
    const existingLamps = [createLamp(0.1, 2.5, 2.9)];

    const placement = getEdgePlacement(room, existingLamps);

    // Should be at the opposite edge (x=max)
    expect(placement.x).toBeCloseTo(4.9, 1);
  });

  it('places at edge center in Y direction', () => {
    const room = createRoom(10, 5, 3, 'meters');
    const placement = getEdgePlacement(room, []);

    // One of the edge positions should have y at center (2.5)
    const yAtCenter = Math.abs(placement.y - 2.5) < 0.1;
    const xAtCenter = Math.abs(placement.x - 5) < 0.1;

    // Either x or y should be at center
    expect(yAtCenter || xAtCenter).toBe(true);
  });
});
