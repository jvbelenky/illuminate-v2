/**
 * The wall view: an elevation of one wall, seen from inside the room. Lamps
 * and structures in front of the wall are projected onto it and fade with
 * their distance from it.
 *
 * Projections here are in wall coordinates (`along` from vertex i, `up` from
 * the floor), as stored. Seen from inside, `along` runs right to left, so the
 * canvas is mirrored: always go through `wallToCanvas` / `canvasToWall`.
 */
import type { Vertex } from '$lib/utils/roomGeometry';
import { toWall, fromWall, surfaceName, type WallSegment } from '$lib/utils/surfaces';
import { encodeT } from '$lib/utils/lampSticking';
import type { LampInstance, SceneObject } from '$lib/types/project';

/** The faintest a projected item is drawn. */
export const MIN_WALL_OPACITY = 0.25;

/** Wall coordinates to the wall view's canvas (x, y), seen from inside: x = length - along. */
export function wallToCanvas(along: number, up: number, seg: WallSegment): [number, number] {
  return [seg.length - along, up];
}

/** The wall view's canvas (x, y) back to wall coordinates. */
export function canvasToWall(x: number, y: number, seg: WallSegment): { along: number; up: number } {
  return { along: seg.length - x, up: y };
}

/** The wall face on the canvas: its length across, the room height up (the same mirrored or not). */
export function wallOutline(seg: WallSegment, roomZ: number): [number, number][] {
  return [[0, 0], [seg.length, 0], [seg.length, roomZ], [0, roomZ]];
}

/** The room's largest extent perpendicular to the wall (how far into the room it reaches). */
export function wallDepth(vertices: Vertex[], seg: WallSegment): number {
  return Math.max(0, ...vertices.map(([x, y]) => toWall(x, y, 0, seg).depth));
}

function fade(depth: number, maxDepth: number): number {
  if (!(maxDepth > 0)) return 1;
  return Math.min(1, Math.max(MIN_WALL_OPACITY, 1 - depth / maxDepth));
}

/** Farthest first, so nearer items draw on top. */
const byDepthDesc = <T extends { depth: number }>(a: T, b: T) => b.depth - a.depth;

/**
 * Lamps in front of the wall (depth >= 0) at their (along, up), faded by depth.
 * `maxDepth` is the room's extent perpendicular to the wall (`wallDepth`); it
 * defaults to the deepest lamp given.
 */
export function projectLamps(
  lamps: { id: string; x: number; y: number; z: number }[],
  seg: WallSegment,
  maxDepth?: number,
): { id: string; along: number; up: number; depth: number; opacity: number }[] {
  const front = lamps
    .map((l) => ({ id: l.id, ...toWall(l.x, l.y, l.z, seg) }))
    .filter((p) => p.depth >= -1e-9)
    .map((p) => ({ ...p, depth: Math.max(0, p.depth) }));
  const scale = maxDepth ?? Math.max(0, ...front.map((p) => p.depth));
  return front.map((p) => ({ ...p, opacity: fade(p.depth, scale) })).sort(byDepthDesc);
}

/**
 * Structures with any part in front of the wall, as the rectangle their
 * footprint's along-range spans from bottom to top (cut to the room height).
 * `depth` is the footprint's nearest point; `maxDepth` as for `projectLamps`.
 */
export function projectStructures(
  objects: { id: string; vertices: Vertex[]; z: number; height: number }[],
  seg: WallSegment,
  roomZ: number,
  maxDepth?: number,
): { id: string; rect: [number, number][]; depth: number; opacity: number }[] {
  const front = objects.flatMap((o) => {
    if (o.vertices.length === 0) return [];
    const ws = o.vertices.map(([x, y]) => toWall(x, y, 0, seg));
    const depths = ws.map((w) => w.depth);
    if (Math.max(...depths) < 0) return [];
    const a0 = Math.min(...ws.map((w) => w.along));
    const a1 = Math.max(...ws.map((w) => w.along));
    const bottom = Math.max(0, o.z);
    const top = Math.min(roomZ, o.z + o.height);
    if (top <= bottom) return [];
    const rect: [number, number][] = [[a0, bottom], [a1, bottom], [a1, top], [a0, top]];
    return [{ id: o.id, rect, depth: Math.max(0, Math.min(...depths)) }];
  });
  const scale = maxDepth ?? Math.max(0, ...front.map((s) => s.depth));
  return front.map((s) => ({ ...s, opacity: fade(s.depth, scale) })).sort(byDepthDesc);
}

/**
 * The walls meeting this one, seen from inside: the next wall (at its end,
 * along = length) on the left, the previous one (at its start) on the right.
 */
export function neighbourLabels(vertices: Vertex[], index: number): { left: string; right: string } {
  const n = vertices.length;
  const name = (i: number) => surfaceName(`wall:${((i % n) + n) % n}`);
  return { left: name(index + 1), right: name(index - 1) };
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * A lamp dragged to (along, up) on wall `wallIndex`'s view. It keeps its
 * distance from the wall; its aim travels with it. A lamp stuck to this wall
 * slides along it (its `wall_t`, signed as `encodeT` does) and stays stuck.
 */
export function unprojectLampMove(
  lamp: Pick<LampInstance, 'x' | 'y' | 'z' | 'aimx' | 'aimy' | 'aimz' | 'stick_wall' | 'wall_index'>,
  seg: WallSegment,
  along: number,
  up: number,
  wallIndex?: number,
): Partial<LampInstance> {
  const stuck = !!lamp.stick_wall && wallIndex !== undefined && lamp.wall_index === wallIndex;
  const a = stuck ? Math.min(seg.length, Math.max(0, along)) : along;
  const { depth } = toWall(lamp.x, lamp.y, lamp.z, seg);
  const p = fromWall(a, up, depth, seg);
  const x = r6(p.x), y = r6(p.y), z = r6(p.z);
  return {
    x, y, z,
    aimx: r6(lamp.aimx + x - lamp.x),
    aimy: r6(lamp.aimy + y - lamp.y),
    aimz: r6(lamp.aimz + z - lamp.z),
    ...(stuck ? { stick_wall: true, wall_t: encodeT(a, seg.length) } : {}),
  };
}

/** A structure moved by (dAlong, dUp) on a wall's view: its position slides along the wall, its bottom rises (never below the floor). */
export function unprojectStructureMove(
  object: Pick<SceneObject, 'x' | 'y' | 'z'>,
  seg: WallSegment,
  dAlong: number,
  dUp: number,
): Partial<SceneObject> {
  return {
    x: r6(object.x + dAlong * seg.ux),
    y: r6(object.y + dAlong * seg.uy),
    z: Math.max(0, r6(object.z + dUp)),
  };
}
