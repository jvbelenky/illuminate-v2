/**
 * Calculation planes on the ceiling or a wall follow the room when its height
 * or outline changes, the way stuck lamps do (see lampSticking). Pure.
 */
import type { CalcZone, RoomConfig } from '$lib/types/project';
import { roomVertices, type Vertex } from '$lib/utils/roomGeometry';
import { isAxisScale, nearestWall, sameWall } from '$lib/utils/lampSticking';
import { fromWall, toWall, wallIndex, wallSegment, zoneSurface } from '$lib/utils/surfaces';

const round9 = (v: number) => Math.round(v * 1e9) / 1e9;

export interface SurfaceFollow {
  id: string;
  partial: Partial<CalcZone>;
}

/**
 * Updates that keep planes on their surface. Only changes are returned, except
 * that a wall plane that resolves to a wall always gets its `surface` back, so
 * the sync resends the wall (its id changes when the outline switches between
 * rectangle and polygon).
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
      if (old) {
        const foot = nearestWall((old.x1 + old.x2) / 2, (old.y1 + old.y2) / 2, next);
        const seg = foot ? wallSegment(next, foot.index) : null;
        // Same line, facing the same way
        if (foot && seg && foot.dist <= tol && seg.ux * old.ux + seg.uy * old.uy > 0) target = foot.index;
      }
    }
    if (target == null) continue;

    const partial: Partial<CalcZone> = { surface: `wall:${target}` };
    if (zone.normal_offset !== undefined) partial.normal_offset = zone.normal_offset;
    if (zone.wall_vertices) {
      if (zone.fit_room) partial.wall_vertices = undefined;
      else if (target !== i) {
        const from = wallSegment(prev, i), to = wallSegment(next, target);
        if (from && to) {
          partial.wall_vertices = zone.wall_vertices.map(([a, u]) => {
            const p = fromWall(a, u, 0, from);
            return [round9(toWall(p.x, p.y, p.z, to).along), u] as [number, number];
          });
        }
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
  const i = wallIndex(zone.surface);
  if (i == null) return false;
  const vertices: Vertex[] = roomVertices(room);
  const seg = wallSegment(vertices, i);
  if (!seg) return true;
  return (zone.wall_vertices ?? []).some(([a, u]) => a < -tol || a > seg.length + tol || u < -tol || u > room.z + tol);
}
