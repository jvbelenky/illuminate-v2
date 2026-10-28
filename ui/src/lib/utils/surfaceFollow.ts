/**
 * Calculation planes on the ceiling or a wall follow the room when its height
 * or outline changes, the way stuck lamps do (see lampSticking). Pure.
 */
import type { CalcZone, RoomConfig } from '$lib/types/project';
import { roomVertices, type Vertex } from '$lib/utils/roomGeometry';
import { isAxisScale, sameWall } from '$lib/utils/lampSticking';
import { fromWall, toWall, wallIndex, wallSegment, zoneSurface, type WallSegment } from '$lib/utils/surfaces';

const round9 = (v: number) => Math.round(v * 1e9) / 1e9;

export interface SurfaceFollow {
  id: string;
  partial: Partial<CalcZone>;
}

/**
 * The wall of `next` on the same line as `old`, facing the same way, that
 * shares the most of it; null when none does (the wall is gone).
 */
function matchWall(old: WallSegment, next: Vertex[], tol: number): number | null {
  let best: number | null = null;
  let most = tol;
  for (let j = 0; j < next.length; j++) {
    const seg = wallSegment(next, j);
    if (!seg) continue;
    const dot = seg.ux * old.ux + seg.uy * old.uy;
    const cross = seg.ux * old.uy - seg.uy * old.ux;
    if (dot <= 0 || Math.abs(cross) * Math.max(seg.length, old.length) > tol) continue;
    if (Math.abs((seg.x1 - old.x1) * old.nx + (seg.y1 - old.y1) * old.ny) > tol) continue;
    const a1 = (seg.x1 - old.x1) * old.ux + (seg.y1 - old.y1) * old.uy;
    const shared = Math.min(a1 + seg.length, old.length) - Math.max(a1, 0);
    if (shared > most) { most = shared; best = j; }
  }
  return best;
}

/**
 * Updates that keep planes on their surface. Only changes are returned, except
 * that a wall plane that resolves to a wall always gets its `surface` back, so
 * the sync resends the wall (its id changes when the outline switches between
 * rectangle and polygon), and a whole-wall plane always sends the whole wall
 * (`wall_vertices` present and undefined), so the backend drops its old outline.
 * A plane whose wall is gone is marked `wall_orphan` instead, never moved to
 * whatever wall now has its number.
 */
export function followSurfaces(zones: CalcZone[], prevRoom: RoomConfig, nextRoom: RoomConfig, tol: number): SurfaceFollow[] {
  const prev = roomVertices(prevRoom);
  const next = roomVertices(nextRoom);
  const scaled = isAxisScale(prev, next, tol);
  const out: SurfaceFollow[] = [];
  for (const zone of zones) {
    if (zone.type !== 'plane' || zone.isStandard) continue;
    const surface = zoneSurface(zone, prevRoom.z);
    if (surface === 'ceiling') {
      if (zone.height != null && nextRoom.z !== prevRoom.z) {
        out.push({ id: zone.id, partial: { height: round9(zone.height + nextRoom.z - prevRoom.z) } });
      }
      continue;
    }
    const i = wallIndex(surface);
    if (i == null) continue;

    let target: number | null = null;
    if (sameWall(prev, next, i, scaled, tol)) target = i;
    else {
      const old = wallSegment(prev, i);
      if (old) target = matchWall(old, next, tol);
    }
    if (target == null) {
      out.push({ id: zone.id, partial: { wall_orphan: true } });
      continue;
    }

    const partial: Partial<CalcZone> = { surface: `wall:${target}` };
    if (zone.normal_offset !== undefined) partial.normal_offset = zone.normal_offset;
    if (zone.fit_room || !zone.wall_vertices) partial.wall_vertices = undefined;
    else if (target !== i) {
      const from = wallSegment(prev, i), to = wallSegment(next, target);
      if (from && to) {
        partial.wall_vertices = zone.wall_vertices.map(([a, u]) => {
          const p = fromWall(a, u, 0, from);
          return [round9(toWall(p.x, p.y, p.z, to).along), u] as [number, number];
        });
      }
    }
    out.push({ id: zone.id, partial });
  }
  return out;
}

/**
 * A wall plane that no longer has its wall: the wall number is past the last
 * wall, or its drawn outline leaves the wall rectangle (along 0..length, up 0..height).
 */
export function strandedWallPlane(zone: CalcZone, room: RoomConfig, tol = 1e-6): boolean {
  if (zone.type !== 'plane' || !zone.surface) return false;
  if (zone.wall_orphan) return true;
  const i = wallIndex(zone.surface);
  if (i == null) return false;
  const vertices: Vertex[] = roomVertices(room);
  const seg = wallSegment(vertices, i);
  if (!seg) return true;
  return (zone.wall_vertices ?? []).some(([a, u]) => a < -tol || a > seg.length + tol || u < -tol || u > room.z + tol);
}
