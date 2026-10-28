/**
 * Where a calculation plane sits in the room (world x, y, z, display units).
 *
 * Every plane is a frame: an origin, a unit `u` and `v` in the plane, and the
 * (u, v) range its outline spans. A wall plane's u runs along its wall from
 * vertex i and its v straight up, at `normal_offset` into the room. A floor or
 * ceiling plane is world x, y at its height; a legacy XZ / YZ plane off any
 * wall keeps its bounds.
 */
import type { CalcZone, RoomConfig } from '$lib/types/project';
import { roomVertices, type Vertex } from '$lib/utils/roomGeometry';
import { wallIndex, wallSegment, fromWall, type WallSegment } from '$lib/utils/surfaces';
import { zoneFootprint, roomFootprint } from '$lib/utils/zoneFootprint';
import { wallToCanvas } from '$lib/plan/wallProjection';

export type Vec3 = [number, number, number];

export interface PlaneFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  u1: number; u2: number; v1: number; v2: number;
  /** The outline in (u, v), when it is not the whole u1..u2 x v1..v2 rectangle. */
  outline: Vertex[] | null;
  /** Set for a plane on a wall. */
  wall: WallSegment | null;
}

/** The wall a plane lies on, if its surface names a wall the room has (and it is not orphaned). */
export function planeWall(zone: Pick<CalcZone, 'surface' | 'wall_orphan'>, room: RoomConfig): WallSegment | null {
  const i = zone.surface && !zone.wall_orphan ? wallIndex(zone.surface) : null;
  return i === null ? null : wallSegment(roomVertices(room), i);
}

/** A wall plane's outline in (along, up): its drawn one, or the whole wall. */
export function wallPlaneOutline(zone: Pick<CalcZone, 'wall_vertices' | 'fit_room'>, seg: WallSegment, roomZ: number): Vertex[] {
  if (!zone.fit_room && zone.wall_vertices && zone.wall_vertices.length >= 3) {
    return zone.wall_vertices.map(([a, u]) => [a, u] as Vertex);
  }
  return [[0, 0], [seg.length, 0], [seg.length, roomZ], [0, roomZ]];
}

function bounds(vs: Vertex[]) {
  const us = vs.map((p) => p[0]), vv = vs.map((p) => p[1]);
  return { u1: Math.min(...us), u2: Math.max(...us), v1: Math.min(...vv), v2: Math.max(...vv) };
}

/** The plane's frame; null for a zone that is not a plane. */
export function planeFrame(zone: CalcZone, room: RoomConfig): PlaneFrame | null {
  if (zone.type !== 'plane') return null;
  const seg = planeWall(zone, room);
  if (seg) {
    const outline = wallPlaneOutline(zone, seg, room.z);
    const o = fromWall(0, 0, zone.normal_offset ?? 0, seg);
    const drawn = !zone.fit_room && !!zone.wall_vertices && zone.wall_vertices.length >= 3;
    return { origin: [o.x, o.y, 0], u: [seg.ux, seg.uy, 0], v: [0, 0, 1], ...bounds(outline), outline: drawn ? outline : null, wall: seg };
  }
  const h = zone.height ?? 0;
  const ref = zone.ref_surface ?? 'xy';
  if (ref === 'xz') {
    const b = { u1: zone.x1 ?? 0, u2: zone.x2 ?? room.x, v1: zone.z_min ?? 0, v2: zone.z_max ?? room.z };
    return { origin: [0, h, 0], u: [1, 0, 0], v: [0, 0, 1], ...normalized(b), outline: null, wall: null };
  }
  if (ref === 'yz') {
    const b = { u1: zone.y1 ?? 0, u2: zone.y2 ?? room.y, v1: zone.z_min ?? 0, v2: zone.z_max ?? room.z };
    return { origin: [h, 0, 0], u: [0, 1, 0], v: [0, 0, 1], ...normalized(b), outline: null, wall: null };
  }
  const drawn = zone.vertices && zone.vertices.length >= 3;
  const footprint = drawn ? zoneFootprint(zone) : zone.x1 == null && zone.fit_room ? roomFootprint(room) : zoneFootprint(zone);
  return { origin: [0, 0, h], u: [1, 0, 0], v: [0, 1, 0], ...bounds(footprint), outline: drawn ? footprint : null, wall: null };
}

function normalized(b: { u1: number; u2: number; v1: number; v2: number }) {
  return { u1: Math.min(b.u1, b.u2), u2: Math.max(b.u1, b.u2), v1: Math.min(b.v1, b.v2), v2: Math.max(b.v1, b.v2) };
}

/** How a plot window draws a wall plane. */
export interface WallPlotAxes {
  u1: number; u2: number; v1: number; v2: number;
  uLabel: 'Along'; vLabel: 'Up';
  /** Distance from the wall. */
  fixed: number;
  /** Values run toward +up (their last column is the top), as `planeGrid` takes it. */
  flipV: boolean;
  /** The plot is seen from inside, so along runs right to left: columns are mirrored. */
  mirrorU: true;
  /** A world point on the plot's axes. */
  toPlot: (x: number, y: number, z: number) => [number, number];
}

/**
 * A wall plane's plot axes: Along (seen from inside, x = length - along, as the
 * wall view draws it) and Up, with values running down from the top edge, or up
 * from the bottom one when flipped (as CalcPlane3D reads them). Null for any
 * other plane.
 */
export function wallPlotAxes(zone: CalcZone, room: RoomConfig): WallPlotAxes | null {
  const fr = planeFrame(zone, room);
  const seg = fr?.wall;
  if (!fr || !seg) return null;
  const [x1] = wallToCanvas(fr.u2, 0, seg);
  const [x2] = wallToCanvas(fr.u1, 0, seg);
  return {
    u1: x1, u2: x2, v1: fr.v1, v2: fr.v2, uLabel: 'Along', vLabel: 'Up',
    fixed: zone.normal_offset ?? 0,
    flipV: !!zone.flip,
    mirrorU: true,
    toPlot: (x, y, z) => wallToCanvas((x - seg.x1) * seg.ux + (y - seg.y1) * seg.uy, z, seg),
  };
}

/** A point of the plane at (u, v), in world coordinates. */
export function frameToWorld(fr: PlaneFrame, u: number, v: number): Vec3 {
  return [
    fr.origin[0] + u * fr.u[0] + v * fr.v[0],
    fr.origin[1] + u * fr.u[1] + v * fr.v[1],
    fr.origin[2] + u * fr.u[2] + v * fr.v[2],
  ];
}

/** World corners of the plane's outline (its drawn polygon, or its rectangle). */
export function planeWorldCorners(zone: CalcZone, room: RoomConfig): Vec3[] {
  const fr = planeFrame(zone, room);
  if (!fr) return [];
  const outline: Vertex[] = fr.outline ?? (fr.wall
    ? wallPlaneOutline(zone, fr.wall, room.z)
    : [[fr.u1, fr.v1], [fr.u2, fr.v1], [fr.u2, fr.v2], [fr.u1, fr.v2]]);
  return outline.map(([u, v]) => frameToWorld(fr, u, v));
}

/**
 * The way the plane faces: into the room for a wall plane (away from it when
 * flipped), up or down by `direction` for a floor or ceiling one, along +y / +x
 * by `direction` for a legacy XZ / YZ plane.
 */
export function planeNormal(zone: CalcZone, room: RoomConfig): Vec3 {
  const seg = planeWall(zone, room);
  if (seg) {
    const s = zone.flip ? -1 : 1;
    return [s * seg.nx + 0, s * seg.ny + 0, 0];
  }
  const d = (zone.direction ?? 1) < 0 ? -1 : 1;
  const ref = zone.ref_surface ?? 'xy';
  if (ref === 'xz') return [0, d, 0];
  if (ref === 'yz') return [d, 0, 0];
  return [0, 0, d];
}
