/**
 * Tests for lamp placement utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  findOptimalLampPosition,
  getDownlightPlacement,
  getCornerPlacement,
  getEdgePlacement,
  getNextCornerIndex,
  getNextEdgeIndex,
  getCornerAimTargets,
  getEdgeAimTargets,
  type LampPlacement,
} from './lampPlacement';
import { pointInPolygon, distanceToBoundary } from './roomGeometry';
import type { RoomConfig, LampInstance } from '$lib/types/project';
import { defaultSurfaceSpacings, defaultSurfaceNumPoints, ROOM_DEFAULTS } from '$lib/types/project';

// Helper to create a minimal room config for testing
function createRoom(x: number = 5, y: number = 5, z: number = 3): RoomConfig {
  const r = ROOM_DEFAULTS.reflectance;
  return {
    x,
    y,
    z,
    shape: 'rectangle',
    precision: 2,
    standard: 'ANSI IES RP 27.1-22 (ACGIH Limits)',
    enable_reflectance: false,
    reflectances: { floor: r, ceiling: r, north: r, south: r, east: r, west: r },
    reflectance_spacings: defaultSurfaceSpacings(),
    reflectance_num_points: defaultSurfaceNumPoints(),
    reflectance_resolution_mode: ROOM_DEFAULTS.reflectance_resolution_mode,
    reflectance_max_num_passes: ROOM_DEFAULTS.reflectance_max_num_passes,
    reflectance_threshold: ROOM_DEFAULTS.reflectance_threshold,
    air_changes: 2,
    ozone_decay_constant: 4.6,
    colormap: 'plasma',
    useStandardZones: true,
    showDimensions: true,
    showPhotometricWebs: true,
    showGrid: true,
    showXYZMarker: true,
    showLampLabels: false,
    showCalcPointLabels: false,
    globalHeatmapNormalization: false,
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
    const room = createRoom(5, 5, 3);
    const pos = findOptimalLampPosition(room, [createLamp(2.5, 2.5, 2.9)]);

    // Wall offset is 0.1m, so position should be at least 0.1 from edges
    expect(pos.x).toBeGreaterThanOrEqual(0.1);
    expect(pos.x).toBeLessThanOrEqual(4.9);
    expect(pos.y).toBeGreaterThanOrEqual(0.1);
    expect(pos.y).toBeLessThanOrEqual(4.9);
  });

  it('handles large room dimensions', () => {
    const room = createRoom(10, 10, 10);
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
    const room = createRoom(5, 5, 3);
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
    const room = createRoom(5, 5, 3);
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
    const room = createRoom(5, 5, 3);
    const placement = getCornerPlacement(room, []);

    // If position is at (0.1, 0.1), aim should be at (5, 5, 0)
    if (placement.x < 1 && placement.y < 1) {
      expect(placement.aimx).toBe(5);
      expect(placement.aimy).toBe(5);
    }
    expect(placement.aimz).toBe(0);
  });

  it('cycles through corners with currentIndex', () => {
    const room = createRoom(5, 5, 3);

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

  it('skips occupied corner and picks next available', () => {
    const room = createRoom(5, 5, 3);
    // Lamp at corner 0 (0.1, 0.1)
    const existingLamps = [createLamp(0.1, 0.1, 2.9)];

    const placement = getCornerPlacement(room, existingLamps);

    // Should skip corner 0 (occupied) and pick corner 1 (4.9, 0.1)
    expect(placement.x).toBeCloseTo(4.9, 1);
    expect(placement.y).toBeCloseTo(0.1, 1);
  });
});

describe('getEdgePlacement', () => {
  it('returns position at ceiling edge center', () => {
    const room = createRoom(5, 5, 3);
    const placement = getEdgePlacement(room, []);

    // Should be at ceiling height
    expect(placement.z).toBeCloseTo(2.9, 5);

    // Should be at edge center (one coordinate at wall, other at center)
    const atWall = Math.abs(placement.x - 0.1) < 0.01 || Math.abs(placement.x - 4.9) < 0.01 ||
                   Math.abs(placement.y - 0.1) < 0.01 || Math.abs(placement.y - 4.9) < 0.01;
    expect(atWall).toBe(true);
  });

  it('aims at opposite floor edge', () => {
    const room = createRoom(5, 5, 3);
    const placement = getEdgePlacement(room, []);

    // Aim should be at floor
    expect(placement.aimz).toBe(0);

    // Aim should be at opposite wall
    if (placement.x < 1) {
      expect(placement.aimx).toBe(5); // Aim at X=max
    }
  });

  it('cycles through edges with currentIndex', () => {
    const room = createRoom(5, 5, 3);

    const placement0 = getEdgePlacement(room, [], 0);
    const placement1 = getEdgePlacement(room, [], 1);
    const placement2 = getEdgePlacement(room, [], 2);
    const placement3 = getEdgePlacement(room, [], 3);

    expect(placement0.nextIndex).toBe(1);
    expect(placement1.nextIndex).toBe(2);
    expect(placement2.nextIndex).toBe(3);
    expect(placement3.nextIndex).toBe(0);
  });

  it('skips occupied edge and picks next available', () => {
    const room = createRoom(5, 5, 3);
    // Lamp at edge 0 (x=0.1, y=2.5)
    const existingLamps = [createLamp(0.1, 2.5, 2.9)];

    const placement = getEdgePlacement(room, existingLamps);

    // Should skip edge 0 (occupied) and pick edge 1 (x=2.5, y=4.9)
    expect(placement.x).toBeCloseTo(2.5, 1);
    expect(placement.y).toBeCloseTo(4.9, 1);
  });

  it('places at edge center in Y direction', () => {
    const room = createRoom(10, 5, 3);
    const placement = getEdgePlacement(room, []);

    // One of the edge positions should have y at center (2.5)
    const yAtCenter = Math.abs(placement.y - 2.5) < 0.1;
    const xAtCenter = Math.abs(placement.x - 5) < 0.1;

    // Either x or y should be at center
    expect(yAtCenter || xAtCenter).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Polygon rooms
// ---------------------------------------------------------------------------

const L_SHAPE: [number, number][] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]];

function createPolygonRoom(vertices: [number, number][] = L_SHAPE, z: number = 3): RoomConfig {
  const xs = vertices.map(v => v[0]);
  const ys = vertices.map(v => v[1]);
  return { ...createRoom(Math.max(...xs), Math.max(...ys), z), shape: 'polygon', vertices };
}

describe('polygon rooms', () => {
  it('rectangle placements are unchanged when expressed as a 4-vertex polygon', () => {
    const rect = createRoom(5, 5, 3);
    const poly = { ...createRoom(5, 5, 3), shape: 'polygon' as const, vertices: [[0, 0], [5, 0], [5, 5], [0, 5]] as [number, number][] };
    for (let i = 0; i < 4; i++) {
      expect(getCornerPlacement(poly, [], i)).toEqual(getCornerPlacement(rect, [], i));
      expect(getEdgePlacement(poly, [], i)).toEqual(getEdgePlacement(rect, [], i));
    }
    expect(getCornerAimTargets(rect)).toEqual([
      { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }, { x: 0, y: 5, z: 0 },
    ]);
    expect(getEdgeAimTargets(rect)).toEqual([
      { x: 2.5, y: 0, z: 0 }, { x: 5, y: 2.5, z: 0 }, { x: 2.5, y: 5, z: 0 }, { x: 0, y: 2.5, z: 0 },
    ]);
  });

  it('downlight placement stays inside an L-shaped outline', () => {
    const room = createPolygonRoom();
    const first = getDownlightPlacement(room, []);
    expect(pointInPolygon(L_SHAPE, first.x, first.y)).toBe(true);
    // The bounding-box centre (3, 2) is the reflex corner; the placement must
    // be well inside the wide wing instead
    expect(distanceToBoundary(L_SHAPE, first.x, first.y)).toBeGreaterThan(0.9);
    expect(first.z).toBeCloseTo(2.9, 5);

    const second = getDownlightPlacement(room, [createLamp(first.x, first.y, first.z)]);
    expect(pointInPolygon(L_SHAPE, second.x, second.y)).toBe(true);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(1);
  });

  it('corner placement offers one corner per vertex, inside the room', () => {
    const room = createPolygonRoom();
    for (let i = 0; i < L_SHAPE.length; i++) {
      const p = getCornerPlacement(room, [], (i + L_SHAPE.length - 1) % L_SHAPE.length);
      expect(p.nextIndex).toBe(i);
      expect(pointInPolygon(L_SHAPE, p.x, p.y)).toBe(true);
      // 0.1 from each wall line; at the reflex corner the nearest *segment*
      // point is the vertex itself, so the distance there is 0.1 * sqrt(2)
      expect(distanceToBoundary(L_SHAPE, p.x, p.y)).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(distanceToBoundary(L_SHAPE, p.x, p.y)).toBeLessThanOrEqual(0.1 * Math.SQRT2 + 1e-9);
      expect(pointInPolygon(L_SHAPE, p.aimx, p.aimy) || distanceToBoundary(L_SHAPE, p.aimx, p.aimy) < 1e-9).toBe(true);
    }
    expect(getNextCornerIndex(room, [], 5)).toBe(0);
    // Corner 0 at (0.1, 0.1) aims at the farthest vertex: (6, 2) at ~6.2 beats (6, 0) at ~5.9
    const c0 = getCornerPlacement(room, [], 5);
    expect([c0.aimx, c0.aimy]).toEqual([6, 2]);
  });

  it('edge placement offers one edge per wall and aims across the room', () => {
    const room = createPolygonRoom();
    const n = L_SHAPE.length;
    for (let i = 0; i < n; i++) {
      const p = getEdgePlacement(room, [], (i + n - 1) % n);
      expect(p.nextIndex).toBe(i);
      expect(pointInPolygon(L_SHAPE, p.x, p.y)).toBe(true);
      expect(distanceToBoundary(L_SHAPE, p.x, p.y)).toBeCloseTo(0.1, 5);
      expect(distanceToBoundary(L_SHAPE, p.aimx, p.aimy)).toBeLessThan(1e-9);
    }
    expect(getNextEdgeIndex(room, [], n - 1)).toBe(0);
    // First edge visited is the last CCW edge (0,4)->(0,0): the x=0 wall
    const e0 = getEdgePlacement(room, [], n - 1);
    expect(e0.x).toBeCloseTo(0.1, 5);
    expect(e0.y).toBeCloseTo(2, 5);
    // Its inward normal (+x) hits the notch wall at x=3 for y=2? y=2 is the
    // notch edge itself, the ray along y=2 grazes it; the far wall is x=6
    expect(e0.aimx).toBeGreaterThanOrEqual(3);
  });
});
