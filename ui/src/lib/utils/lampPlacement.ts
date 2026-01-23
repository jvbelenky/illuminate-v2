/**
 * Lamp placement utilities using the guv-calcs algorithm.
 */

import type { RoomConfig, LampInstance } from '$lib/types/project';

/**
 * Find optimal lamp position using a grid-based approach.
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

  let bestGx = M / 2;
  let bestGy = N / 2;
  let maxMinDist = -1;

  for (let gx = 0; gx < M; gx++) {
    for (let gy = 0; gy < N; gy++) {
      // Calculate minimum distance to existing lamps (in grid units)
      let minLampDist = Infinity;
      for (const pos of lampGridPositions) {
        const dist = Math.sqrt((gx - pos.gx) ** 2 + (gy - pos.gy) ** 2);
        minLampDist = Math.min(minLampDist, dist);
      }

      // Calculate minimum distance to grid boundaries (in grid units)
      const minBoundaryDist = Math.min(gx, M - 1 - gx, gy, N - 1 - gy);

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
