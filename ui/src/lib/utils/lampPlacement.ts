/**
 * Lamp placement utilities using the guv-calcs algorithm.
 *
 * Works for rectangular and polygon rooms. Rectangles keep the original
 * grid/corner/edge behaviour exactly; polygon rooms generalise it:
 * - downlight: grid search over the bounding box restricted to points inside
 *   the outline, maximising distance to other lamps and to the walls
 * - corner: each polygon vertex, offset inward, aiming at the farthest floor vertex
 * - edge: each edge midpoint, offset along the inward normal, aiming at the
 *   point where that normal leaves the room
 */

import type { RoomConfig, LampInstance } from '$lib/types/project';
import {
  type Vertex,
  roomVertices,
  isPolygonRoom,
  edgeMidpoints,
  edgeInwardNormals,
  vertexInwardDirections,
  distanceToBoundary,
  isInsideWithMargin,
  rayToBoundary,
} from './roomGeometry';

/** Wall offset in meters (10cm) */
const WALL_OFFSET_METERS = 0.1;

/**
 * Get wall offset in meters (10cm from walls/ceiling)
 */
function getWallOffset(room: RoomConfig): number {
  // Disable offset entirely if it doesn't fit in the room
  if (WALL_OFFSET_METERS >= room.x || WALL_OFFSET_METERS >= room.y || WALL_OFFSET_METERS >= room.z) return 0;
  return WALL_OFFSET_METERS;
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

type PositionWithAim = { x: number; y: number; z: number; aimx: number; aimy: number; aimz: number };

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
  if (isPolygonRoom(room)) {
    return findOptimalPolygonPosition(room, existingLamps);
  }

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
  let maxMinDistSq = -1;

  for (let gx = Math.ceil(offsetGx); gx < M - offsetGx; gx++) {
    for (let gy = Math.ceil(offsetGy); gy < N - offsetGy; gy++) {
      // Boundary distance is O(1) — check first to skip lamp loop entirely
      const minBoundaryDist = Math.min(gx - offsetGx, M - 1 - offsetGx - gx, gy - offsetGy, N - 1 - offsetGy - gy);
      const minBoundaryDistSq = minBoundaryDist * minBoundaryDist;
      if (minBoundaryDistSq <= maxMinDistSq) continue;

      // Find minimum squared distance to existing lamps.
      // Early-exit: if any lamp is closer than the current best, this point can't win.
      let minLampDistSq = Infinity;
      let dominated = false;
      for (const pos of lampGridPositions) {
        const dSq = (gx - pos.gx) ** 2 + (gy - pos.gy) ** 2;
        if (dSq <= maxMinDistSq) { dominated = true; break; }
        if (dSq < minLampDistSq) minLampDistSq = dSq;
      }
      if (dominated) continue;

      const minDistSq = Math.min(minLampDistSq, minBoundaryDistSq);
      if (minDistSq > maxMinDistSq) {
        maxMinDistSq = minDistSq;
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
 * Polygon-room variant of the grid search. Candidate points are the bounding
 * box grid restricted to the inside of the outline (at least `offset` from
 * every wall); the score is the minimum of the distance to the nearest lamp
 * and to the nearest wall, all measured in room units. With no lamps this
 * picks the point deepest inside the outline, which — unlike the bounding-box
 * centre — is guaranteed to be in the room.
 */
function findOptimalPolygonPosition(
  room: RoomConfig,
  existingLamps: LampInstance[]
): { x: number; y: number } {
  const vertices = roomVertices(room);
  const offset = getWallOffset(room);
  const M = 100;
  const N = 100;
  const stepX = room.x / (M - 1);
  const stepY = room.y / (N - 1);

  let best: { x: number; y: number } | null = null;
  let bestScoreSq = -1;

  for (let gx = 0; gx < M; gx++) {
    const x = gx * stepX;
    for (let gy = 0; gy < N; gy++) {
      const y = gy * stepY;
      if (!isInsideWithMargin(vertices, x, y, offset)) continue;

      const boundaryDist = distanceToBoundary(vertices, x, y) - offset;
      const boundaryDistSq = boundaryDist * boundaryDist;
      if (boundaryDistSq <= bestScoreSq) continue;

      let minLampDistSq = Infinity;
      let dominated = false;
      for (const lamp of existingLamps) {
        const dSq = (x - lamp.x) ** 2 + (y - lamp.y) ** 2;
        if (dSq <= bestScoreSq) { dominated = true; break; }
        if (dSq < minLampDistSq) minLampDistSq = dSq;
      }
      if (dominated) continue;

      const scoreSq = Math.min(minLampDistSq, boundaryDistSq);
      if (scoreSq > bestScoreSq) {
        bestScoreSq = scoreSq;
        best = { x, y };
      }
    }
  }

  if (best) return best;
  // Degenerate outline (thinner than the offset everywhere): fall back to the
  // first vertex so the caller always gets a finite position.
  return { x: vertices[0][0], y: vertices[0][1] };
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

/** Farthest outline vertex from (x, y) — the natural "opposite corner". */
function farthestVertex(vertices: Vertex[], x: number, y: number): Vertex {
  let best = vertices[0];
  let bestDistSq = -1;
  for (const v of vertices) {
    const dSq = (v[0] - x) ** 2 + (v[1] - y) ** 2;
    if (dSq > bestDistSq) {
      bestDistSq = dSq;
      best = v;
    }
  }
  return best;
}

/**
 * Corner positions (ceiling corners with offset), one per outline vertex in
 * CCW order — for a rectangle: (0,0), (max,0), (max,max), (0,max).
 * Each aims at the farthest floor vertex (the opposite corner of a rectangle).
 */
function getCornerPositions(room: RoomConfig): PositionWithAim[] {
  const vertices = roomVertices(room);
  const offset = getWallOffset(room);
  const normals = edgeInwardNormals(vertices);
  const n = vertices.length;
  const z = room.z - offset;

  return vertices.map(([vx, vy], i) => {
    // Move `offset` away from both adjacent walls. For a right angle this is
    // exactly (offset, offset) as before; in general the sum of the two
    // inward normals, scaled by 1/(1 + n1·n2), keeps the distance to each wall
    // equal to `offset`.
    const n1 = normals[(i - 1 + n) % n];
    const n2 = normals[i];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const scale = offset / Math.max(1 + dot, 0.25);
    let x = vx + (n1[0] + n2[0]) * scale;
    let y = vy + (n1[1] + n2[1]) * scale;
    if (!isInsideWithMargin(vertices, x, y, 0)) {
      // Very acute corner: fall back to a short step along the bisector
      const [bx, by] = vertexInwardDirections(vertices)[i];
      x = vx + bx * offset;
      y = vy + by * offset;
    }
    const [ax, ay] = farthestVertex(vertices, x, y);
    return { x, y, z, aimx: ax, aimy: ay, aimz: 0 };
  });
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
 * Edge positions (ceiling edges with offset). Each lamp sits at an edge
 * midpoint, pushed `offset` into the room, aiming at the floor where the
 * inward normal meets the far wall. Edges are visited clockwise starting with
 * the last CCW edge — for a rectangle: X=0 edge, Y=max edge, X=max edge, Y=0 edge.
 */
function getEdgePositions(room: RoomConfig): PositionWithAim[] {
  const vertices = roomVertices(room);
  const offset = getWallOffset(room);
  const midpoints = edgeMidpoints(vertices);
  const normals = edgeInwardNormals(vertices);
  const z = room.z - offset;
  const n = vertices.length;

  const out: PositionWithAim[] = [];
  for (let k = 0; k < n; k++) {
    const i = n - 1 - k;
    const [mx, my] = midpoints[i];
    const [nx, ny] = normals[i];
    const x = mx + nx * offset;
    const y = my + ny * offset;
    const hit = rayToBoundary(vertices, [mx, my], [nx, ny]) ?? farthestVertex(vertices, x, y);
    out.push({ x, y, z, aimx: hit[0], aimy: hit[1], aimz: 0 });
  }
  return out;
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
  const corners = getCornerPositions(room);
  if (currentIndex >= 0) {
    return (currentIndex + 1) % corners.length;
  }
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
  const edges = getEdgePositions(room);
  if (currentIndex >= 0) {
    return (currentIndex + 1) % edges.length;
  }
  const tolerance = Math.min(room.x, room.y) * 0.15;
  return findNextUnoccupied(edges, existingLamps, 0, tolerance);
}

/**
 * Floor-level aim targets for the LampEditor's cycling buttons: one per
 * outline vertex (corners) and one per edge midpoint (edges), in CCW order.
 */
export function getCornerAimTargets(room: RoomConfig): Array<{ x: number; y: number; z: number }> {
  return roomVertices(room).map(([x, y]) => ({ x, y, z: 0 }));
}

export function getEdgeAimTargets(room: RoomConfig): Array<{ x: number; y: number; z: number }> {
  return edgeMidpoints(roomVertices(room)).map(([x, y]) => ({ x, y, z: 0 }));
}
