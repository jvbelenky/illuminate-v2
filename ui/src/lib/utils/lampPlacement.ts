/**
 * Lamp placement utilities using the guv-calcs algorithm.
 */

import type { RoomConfig, LampInstance } from '$lib/types/project';

/** Wall offset in meters (10cm) */
const WALL_OFFSET_METERS = 0.1;

/**
 * Get wall offset in room units (10cm from walls/ceiling)
 */
function getWallOffset(room: RoomConfig): number {
  const base = room.units === 'meters' ? WALL_OFFSET_METERS : WALL_OFFSET_METERS * 3.28084;
  // Cap offset so lamp always stays inside the room with room to spare for aim point
  const maxOffset = Math.min(room.x, room.y, room.z) / 2;
  return Math.min(base, maxOffset);
}

/**
 * Placement mode types
 */
export type PlacementMode = 'downlight' | 'corner' | 'edge' | 'horizontal';

/**
 * Full lamp placement result including position, aim point, and next index for cycling
 */
export interface LampPlacement {
  x: number;
  y: number;
  z: number;
  aimx: number;
  aimy: number;
  aimz: number;
  nextIndex: number;
}

/**
 * Find optimal lamp position using a grid-based approach (Downlight mode).
 * Uses the same algorithm as guv-calcs where distances are calculated in grid units,
 * ensuring consistent behavior regardless of room aspect ratio.
 *
 * @param room - Room configuration with dimensions
 * @param existingLamps - Array of existing lamp instances
 * @returns Optimal { x, y } position for a new lamp
 */
export function findOptimalLampPosition(
  room: RoomConfig,
  existingLamps: LampInstance[]
): { x: number; y: number } {
  const offset = getWallOffset(room);

  // If no existing lamps, place in center
  if (existingLamps.length === 0) {
    return { x: room.x / 2, y: room.y / 2 };
  }

  // Use a fixed 100x100 grid like guv-calcs
  const M = 100;
  const N = 100;

  // Convert existing lamp positions to grid coordinates
  const lampGridPositions = existingLamps.map(lamp => ({
    gx: (lamp.x / room.x) * (M - 1),
    gy: (lamp.y / room.y) * (N - 1)
  }));

  // Calculate offset in grid units
  const offsetGx = (offset / room.x) * (M - 1);
  const offsetGy = (offset / room.y) * (N - 1);

  let bestGx = M / 2;
  let bestGy = N / 2;
  let maxMinDist = -1;

  for (let gx = Math.ceil(offsetGx); gx < M - offsetGx; gx++) {
    for (let gy = Math.ceil(offsetGy); gy < N - offsetGy; gy++) {
      // Calculate minimum distance to existing lamps (in grid units)
      let minLampDist = Infinity;
      for (const pos of lampGridPositions) {
        const dist = Math.sqrt((gx - pos.gx) ** 2 + (gy - pos.gy) ** 2);
        minLampDist = Math.min(minLampDist, dist);
      }

      // Calculate minimum distance to grid boundaries (in grid units)
      const minBoundaryDist = Math.min(gx - offsetGx, M - 1 - offsetGx - gx, gy - offsetGy, N - 1 - offsetGy - gy);

      // Overall minimum distance (to lamps or walls)
      const minDist = Math.min(minLampDist, minBoundaryDist);

      // Track the position with maximum minimum distance
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestGx = gx;
        bestGy = gy;
      }
    }
  }

  // Convert back to room coordinates
  return {
    x: (bestGx / (M - 1)) * room.x,
    y: (bestGy / (N - 1)) * room.y
  };
}

/**
 * Get downlight placement - lamp at ceiling facing down
 */
export function getDownlightPlacement(
  room: RoomConfig,
  existingLamps: LampInstance[]
): LampPlacement {
  const offset = getWallOffset(room);
  const { x, y } = findOptimalLampPosition(room, existingLamps);
  const z = room.z - offset;

  return {
    x,
    y,
    z,
    aimx: x,
    aimy: y,
    aimz: 0,
    nextIndex: 0
  };
}

/**
 * Check if a position is occupied by any lamp (2D proximity check in x/y).
 */
function isPositionOccupied(
  pos: { x: number; y: number },
  lamps: LampInstance[],
  tolerance: number
): boolean {
  return lamps.some(
    lamp => Math.abs(lamp.x - pos.x) < tolerance && Math.abs(lamp.y - pos.y) < tolerance
  );
}

/**
 * Find the next unoccupied position index starting from startIndex.
 * If all positions are occupied, returns startIndex % count.
 */
function findNextUnoccupied(
  positions: Array<{ x: number; y: number }>,
  lamps: LampInstance[],
  startIndex: number,
  tolerance: number
): number {
  const count = positions.length;
  for (let i = 0; i < count; i++) {
    const idx = (startIndex + i) % count;
    if (!isPositionOccupied(positions[idx], lamps, tolerance)) {
      return idx;
    }
  }
  // All occupied — fall back to the requested start
  return startIndex % count;
}

/**
 * Corner positions (ceiling corners with offset)
 * Order: (0,0), (max,0), (max,max), (0,max)
 */
function getCornerPositions(room: RoomConfig): Array<{ x: number; y: number; z: number; aimx: number; aimy: number; aimz: number }> {
  const offset = getWallOffset(room);
  return [
    { x: offset, y: offset, z: room.z - offset, aimx: room.x, aimy: room.y, aimz: 0 },
    { x: room.x - offset, y: offset, z: room.z - offset, aimx: 0, aimy: room.y, aimz: 0 },
    { x: room.x - offset, y: room.y - offset, z: room.z - offset, aimx: 0, aimy: 0, aimz: 0 },
    { x: offset, y: room.y - offset, z: room.z - offset, aimx: room.x, aimy: 0, aimz: 0 }
  ];
}

/**
 * Get corner placement - lamp in ceiling corner, aiming at opposite floor corner
 */
export function getCornerPlacement(
  room: RoomConfig,
  existingLamps: LampInstance[],
  currentIndex: number = -1
): LampPlacement {
  const corners = getCornerPositions(room);

  let bestIndex: number;
  if (currentIndex < 0) {
    // Initial placement: pick first unoccupied corner
    const tolerance = Math.min(room.x, room.y) * 0.15;
    bestIndex = findNextUnoccupied(corners, existingLamps, 0, tolerance);
  } else {
    // Cycling: go to next corner regardless of occupancy
    bestIndex = (currentIndex + 1) % corners.length;
  }

  const corner = corners[bestIndex];
  return {
    ...corner,
    nextIndex: bestIndex
  };
}

/**
 * Edge positions (ceiling edges with offset)
 * Each edge has lamp positioned along the edge center, aiming at floor edge of opposite wall
 * Order: X=0 edge, Y=max edge, X=max edge, Y=0 edge
 */
function getEdgePositions(room: RoomConfig): Array<{ x: number; y: number; z: number; aimx: number; aimy: number; aimz: number }> {
  const offset = getWallOffset(room);
  return [
    // Along X=0 wall (center of Y), aim at X=max floor edge
    { x: offset, y: room.y / 2, z: room.z - offset, aimx: room.x, aimy: room.y / 2, aimz: 0 },
    // Along Y=max wall (center of X), aim at Y=0 floor edge
    { x: room.x / 2, y: room.y - offset, z: room.z - offset, aimx: room.x / 2, aimy: 0, aimz: 0 },
    // Along X=max wall (center of Y), aim at X=0 floor edge
    { x: room.x - offset, y: room.y / 2, z: room.z - offset, aimx: 0, aimy: room.y / 2, aimz: 0 },
    // Along Y=0 wall (center of X), aim at Y=max floor edge
    { x: room.x / 2, y: offset, z: room.z - offset, aimx: room.x / 2, aimy: room.y, aimz: 0 }
  ];
}

/**
 * Get edge placement - lamp along ceiling edge, aiming at opposite floor edge
 */
export function getEdgePlacement(
  room: RoomConfig,
  existingLamps: LampInstance[],
  currentIndex: number = -1
): LampPlacement {
  const edges = getEdgePositions(room);

  let bestIndex: number;
  if (currentIndex < 0) {
    // Initial placement: pick first unoccupied edge
    const tolerance = Math.min(room.x, room.y) * 0.15;
    bestIndex = findNextUnoccupied(edges, existingLamps, 0, tolerance);
  } else {
    // Cycling: go to next edge regardless of occupancy
    bestIndex = (currentIndex + 1) % edges.length;
  }

  const edge = edges[bestIndex];
  return {
    ...edge,
    nextIndex: bestIndex
  };
}

/**
 * Get the next corner index. On initial placement (currentIndex < 0),
 * picks the first unoccupied corner. On cycling, just increments.
 */
export function getNextCornerIndex(
  room: RoomConfig,
  existingLamps: LampInstance[],
  currentIndex: number
): number {
  if (currentIndex >= 0) {
    return (currentIndex + 1) % 4;
  }
  const corners = getCornerPositions(room);
  const tolerance = Math.min(room.x, room.y) * 0.15;
  return findNextUnoccupied(corners, existingLamps, 0, tolerance);
}

/**
 * Get the next edge index. On initial placement (currentIndex < 0),
 * picks the first unoccupied edge. On cycling, just increments.
 */
export function getNextEdgeIndex(
  room: RoomConfig,
  existingLamps: LampInstance[],
  currentIndex: number
): number {
  if (currentIndex >= 0) {
    return (currentIndex + 1) % 4;
  }
  const edges = getEdgePositions(room);
  const tolerance = Math.min(room.x, room.y) * 0.15;
  return findNextUnoccupied(edges, existingLamps, 0, tolerance);
}
