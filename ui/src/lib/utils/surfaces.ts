/**
 * Surfaces a calculation plane can lie on: the floor, the ceiling, or one wall.
 * A wall is the outline edge `i -> i+1` of the CCW room outline (the same
 * index `wall_index` uses for lamps). Wall planes live in (along, up) wall
 * coordinates, with `depth` measured from the wall toward the room.
 */
import type { CalcZone } from '$lib/types/project';
import { wallIdsFor, type Vertex } from '$lib/utils/roomGeometry';

export type Surface = 'floor' | 'ceiling' | `wall:${number}`;

const WALL_RE = /^wall:(\d+)$/;

export function parseSurface(s: unknown): Surface | null {
  if (s === 'floor' || s === 'ceiling') return s;
  if (typeof s === 'string' && WALL_RE.test(s)) return s as Surface;
  return null;
}

export function wallIndex(s: Surface): number | null {
  const m = WALL_RE.exec(s);
  return m ? Number(m[1]) : null;
}

/** Floor, ceiling, then the walls in index order. */
export function allSurfaces(vertices: Vertex[]): Surface[] {
  return ['floor', 'ceiling', ...vertices.map((_, i) => `wall:${i}` as Surface)];
}

/** The next (+1) or previous (-1) surface, wrapping around. */
export function stepSurface(current: Surface, vertices: Vertex[], delta: 1 | -1): Surface {
  const all = allSurfaces(vertices);
  const i = all.indexOf(current);
  const from = i < 0 ? 0 : i;
  return all[(from + delta + all.length) % all.length];
}

export function surfaceName(s: Surface): string {
  if (s === 'floor') return 'Floor';
  if (s === 'ceiling') return 'Ceiling';
  return `Wall ${(wallIndex(s) ?? 0) + 1}`;
}

export interface WallSegment {
  x1: number; y1: number; x2: number; y2: number;
  length: number;
  /** Unit vector along the wall. */
  ux: number; uy: number;
  /** Room-facing normal (left of the direction, for a CCW outline). */
  nx: number; ny: number;
}

export function wallSegment(vertices: Vertex[], index: number): WallSegment | null {
  const n = vertices.length;
  if (index < 0 || index >= n || n < 3) return null;
  const [x1, y1] = vertices[index];
  const [x2, y2] = vertices[(index + 1) % n];
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0) return null;
  const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
  return { x1, y1, x2, y2, length, ux, uy, nx: -uy, ny: ux };
}

/** World point to wall coordinates: along the wall, up from the floor, depth into the room. */
export function toWall(x: number, y: number, z: number, seg: WallSegment): { along: number; up: number; depth: number } {
  const dx = x - seg.x1, dy = y - seg.y1;
  return { along: dx * seg.ux + dy * seg.uy, up: z, depth: dx * seg.nx + dy * seg.ny };
}

export function fromWall(along: number, up: number, depth: number, seg: WallSegment): { x: number; y: number; z: number } {
  return {
    x: seg.x1 + along * seg.ux + depth * seg.nx,
    y: seg.y1 + along * seg.uy + depth * seg.ny,
    z: up,
  };
}

export function wallIdForIndex(vertices: Vertex[], index: number): string {
  return wallIdsFor(vertices)[index] ?? `wall_${index}`;
}

export function wallIndexForId(vertices: Vertex[], id: string): number | null {
  const i = wallIdsFor(vertices).indexOf(id);
  return i < 0 ? null : i;
}

/** The wall a plane lies on; null off the walls, or when its wall is gone (`wall_orphan`). */
export function zoneWallIndex(zone: Pick<CalcZone, 'type' | 'surface' | 'wall_orphan'>): number | null {
  if (zone.type !== 'plane' || !zone.surface || zone.wall_orphan) return null;
  return wallIndex(zone.surface);
}

/**
 * Where a zone lies: its own surface, else derived from a flat plane's height and direction.
 * A plane whose wall is gone opens on the floor.
 */
export function zoneSurface(zone: Pick<CalcZone, 'surface' | 'type' | 'ref_surface' | 'direction' | 'height' | 'wall_orphan'>, roomZ: number): Surface {
  if (zone.wall_orphan) return 'floor';
  if (zone.surface) return zone.surface;
  if (
    zone.type === 'plane'
    && (zone.ref_surface ?? 'xy') === 'xy'
    && zone.direction === -1
    && zone.height != null
    && Math.abs(zone.height - roomZ) <= 1e-6 * roomZ
  ) return 'ceiling';
  return 'floor';
}
