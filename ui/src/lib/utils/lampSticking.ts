/**
 * Stick to ceiling / Stick to wall: lamps placed on a surface follow it when
 * the room's Height or outline changes.
 *
 * A ceiling-stuck lamp keeps its distance below the ceiling. A wall-stuck lamp
 * keeps its wall (edge `wall_index` of the CCW outline), its distance from the
 * nearer end of that wall and its distance in from it, so a corner lamp stays
 * in its corner. The state is frontend-only and in the project's units.
 *
 * Everything here is pure.
 */
import { z } from 'zod';
import type { LampInstance, LampStick } from '$lib/types/project';
import { roomExtents, roomVertices, type RoomOutline, type Vertex } from './roomGeometry';
import type { PlacementMode } from './lampPlacement';

const EPS = 1e-9;
/** A lamp within this many default offsets of the ceiling keeps its distance when stuck. */
const NEAR_FACTOR = 5;
/**
 * Default length tolerance (project units) for matching walls and offsets
 * across a room change; the store passes one scaled to the project's units.
 */
const DEFAULT_TOL = 1e-6;
const MAX_STICK_ENTRIES = 10000;

export const STICK_KEYS = ['stick_ceiling', 'ceiling_offset', 'stick_wall', 'wall_index', 'wall_t', 'wall_offset'] as const;

const Length = z.number().finite().min(-1e6).max(1e6);
const Distance = z.number().finite().min(0).max(1e6);
export const LampStickSchema = z.object({
  stick_ceiling: z.boolean().optional(),
  ceiling_offset: Distance.optional(),
  stick_wall: z.boolean().optional(),
  wall_index: z.number().int().min(0).max(10000).optional(),
  wall_t: Length.optional(),
  wall_offset: Distance.optional(),
});
/**
 * Stick state by lamp id, as saved beside the project; bounded since files can
 * be crafted. The entry count is checked before any entry is parsed.
 */
export const LampStickMapSchema = z
  .custom<Record<string, unknown>>((v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= MAX_STICK_ENTRIES)
  .pipe(z.record(z.string().max(200), LampStickSchema));

type Position = Pick<LampInstance, 'x' | 'y' | 'z' | 'aimx' | 'aimy' | 'aimz'>;
export type StickMove = { id: string } & Position & Partial<LampStick>;

const round9 = (v: number) => Math.round(v * 1e9) / 1e9;

/** The surfaces a placement mounts the lamp on. */
export function stickByPlacement(mode: PlacementMode): { stick_ceiling: boolean; stick_wall: boolean } {
  switch (mode) {
    case 'downlight': return { stick_ceiling: true, stick_wall: false };
    case 'corner':
    case 'edge': return { stick_ceiling: true, stick_wall: true };
    case 'horizontal': return { stick_ceiling: false, stick_wall: true };
  }
}

/**
 * Stick the lamp to the ceiling. With `defaultOffset`, a lamp far from the
 * ceiling moves to that distance below it, and one already near keeps its
 * distance; without, it keeps whatever distance it has. A level aim moves with it.
 */
export function attachCeiling(lamp: Position, roomZ: number, defaultOffset?: number): Partial<LampInstance> {
  const current = roomZ - lamp.z;
  // A lamp at or above the ceiling (rounding can put a placement there) sits on it
  const keep = Math.max(0, current);
  const offset = defaultOffset === undefined || (current >= -EPS && current <= defaultOffset * NEAR_FACTOR) ? keep : defaultOffset;
  const z = round9(roomZ - offset);
  const level = Math.abs(lamp.aimz - lamp.z) < EPS;
  return { stick_ceiling: true, ceiling_offset: round9(offset), z, aimz: level ? z : lamp.aimz };
}

interface WallFoot {
  index: number;
  /** Distance along the wall from its start vertex, clamped to the wall. */
  t: number;
  len: number;
  /** Signed distance in from the wall (positive inside a CCW outline). */
  offset: number;
  /** Distance to the wall segment. */
  dist: number;
}

export function wallAt(vertices: Vertex[], index: number) {
  const [ax, ay] = vertices[index];
  const [bx, by] = vertices[(index + 1) % vertices.length];
  const len = Math.hypot(bx - ax, by - ay);
  return { ax, ay, len, ux: len > EPS ? (bx - ax) / len : 0, uy: len > EPS ? (by - ay) / len : 0 };
}

/** The wall nearest (x, y); the first one wins a tie. */
export function nearestWall(x: number, y: number, vertices: Vertex[]): WallFoot | null {
  let best: WallFoot | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const { ax, ay, len, ux, uy } = wallAt(vertices, i);
    if (len <= EPS) continue;
    const t = Math.min(len, Math.max(0, (x - ax) * ux + (y - ay) * uy));
    const dist = Math.hypot(x - (ax + ux * t), y - (ay + uy * t));
    if (!best || dist < best.dist - EPS) {
      best = { index: i, t, len, offset: (x - ax) * -uy + (y - ay) * ux, dist };
    }
  }
  return best;
}

/** `wall_t`: the distance from the nearer end, negative when that is the end vertex. */
export function encodeT(t: number, len: number): number {
  return t <= len - t ? round9(t) : -Math.max(round9(len - t), EPS);
}

function pointOnWall(vertices: Vertex[], index: number, wallT: number, offset: number): [number, number] | null {
  if (!Number.isInteger(index) || index < 0 || index >= vertices.length) return null;
  const { ax, ay, len, ux, uy } = wallAt(vertices, index);
  if (len <= EPS) return null;
  const t = wallT >= 0 ? Math.min(wallT, len) : Math.max(0, len + wallT);
  return [round9(ax + ux * t - uy * offset), round9(ay + uy * t + ux * offset)];
}

/**
 * Stick the lamp to its nearest wall. With `offset` it moves to that distance
 * in from the wall (its aim travels with it); without, it stays where it is.
 */
export function attachWall(lamp: Position, vertices: Vertex[], offset?: number): Partial<LampInstance> {
  const foot = nearestWall(lamp.x, lamp.y, vertices);
  if (!foot) return { stick_wall: false };
  const stick = { stick_wall: true, wall_index: foot.index, wall_t: encodeT(foot.t, foot.len) };
  if (offset === undefined) return { ...stick, wall_offset: Math.max(0, round9(foot.offset)) };
  const [x, y] = pointOnWall(vertices, foot.index, foot.t, offset)!;
  return { ...stick, wall_offset: offset, x, y, aimx: round9(lamp.aimx + x - lamp.x), aimy: round9(lamp.aimy + y - lamp.y) };
}

const near = (a: Vertex, b: Vertex, tol: number) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/**
 * Whether the new outline is the old one scaled along X and Y about the origin
 * (a rectangle resized, or a polygon resized by its X/Y fields), so every wall
 * keeps its number.
 */
export function isAxisScale(prev: Vertex[], next: Vertex[], tol: number): boolean {
  if (prev.length !== next.length) return false;
  const pe = roomExtents(prev), ne = roomExtents(next);
  const fx = pe.x > EPS ? ne.x / pe.x : 1;
  const fy = pe.y > EPS ? ne.y / pe.y : 1;
  return prev.every(([x, y], k) => near([x * fx, y * fy], next[k], tol));
}

/**
 * Whether wall `i` of the new outline is still wall `i` of the old one. True
 * when the whole outline was scaled, or when the edit was local: at most two
 * corners moved (a corner drag, or a wall's edge dragged), and each of them is
 * a corner of wall `i` or of one other wall. A redraw, or the same outline
 * started at another corner, moves more and is not trusted by number.
 */
export function sameWall(prev: Vertex[] | null, next: Vertex[], i: number, scaled: boolean, tol: number): boolean {
  if (!prev) return true;
  const n = next.length;
  if (prev.length !== n || !Number.isInteger(i) || i < 0 || i >= n) return false;
  if (scaled) return true;
  const moved: number[] = [];
  for (let k = 0; k < n; k++) if (!near(prev[k], next[k], tol)) moved.push(k);
  if (moved.length > 2) return false;
  const rest = moved.filter((k) => k !== i && k !== (i + 1) % n);
  // What is left over must be the corners of a single other wall
  return rest.length <= 1 || (rest[1] - rest[0] === 1 || (rest[0] === 0 && rest[1] === n - 1));
}

/**
 * Where each stuck lamp goes in `room`: only the lamps that move or lose their
 * wall are returned. `previous` is the room before the change. A lamp follows
 * its wall by number only while that is still the same wall; otherwise (a
 * redrawn or renumbered outline) it finds its wall again by where it stands,
 * at its offset within `tol`, and unsticks if no wall is there any more, so it
 * never jumps to a different wall.
 */
export function applySticking(lamps: LampInstance[], room: RoomOutline & { z: number }, previous?: RoomOutline, tol: number = DEFAULT_TOL): StickMove[] {
  const vertices = roomVertices(room);
  const prev = previous ? roomVertices(previous) : null;
  const scaled = prev !== null && isAxisScale(prev, vertices, tol);
  const out: StickMove[] = [];
  for (const lamp of lamps) {
    if (!lamp.stick_ceiling && !lamp.stick_wall) continue;
    let { x, y, z, aimx, aimy, aimz } = lamp;
    const stick: Partial<LampStick> = {};
    if (lamp.stick_ceiling && Number.isFinite(lamp.ceiling_offset)) {
      const nz = round9(room.z - lamp.ceiling_offset!);
      if (Math.abs(aimz - z) < EPS) aimz = nz;
      z = nz;
    }
    if (lamp.stick_wall) {
      if (!sameWall(prev, vertices, lamp.wall_index ?? -1, scaled, tol)) {
        const foot = nearestWall(x, y, vertices);
        if (foot && Math.abs(foot.offset - (lamp.wall_offset ?? 0)) <= tol && Math.abs(foot.dist - Math.abs(foot.offset)) <= tol) {
          stick.wall_index = foot.index;
          stick.wall_t = encodeT(foot.t, foot.len);
        } else stick.stick_wall = false;
      } else {
        const p = Number.isFinite(lamp.wall_t) && Number.isFinite(lamp.wall_offset)
          ? pointOnWall(vertices, lamp.wall_index ?? -1, lamp.wall_t!, lamp.wall_offset!)
          : null;
        if (!p) stick.stick_wall = false;
        else {
          aimx = round9(aimx + p[0] - x);
          aimy = round9(aimy + p[1] - y);
          [x, y] = p;
        }
      }
    }
    const moved = [x - lamp.x, y - lamp.y, z - lamp.z, aimx - lamp.aimx, aimy - lamp.aimy, aimz - lamp.aimz].some((d) => Math.abs(d) > EPS);
    if (moved || Object.keys(stick).length > 0) out.push({ id: lamp.id, x, y, z, aimx, aimy, aimz, ...stick });
  }
  return out;
}

/** The flags a manual move clears: a new height leaves the ceiling, a new X or Y leaves the wall. */
export function unstickFor(lamp: LampInstance, partial: Partial<LampInstance>): Partial<LampStick> {
  const out: Partial<LampStick> = {};
  const changed = (k: 'x' | 'y' | 'z') => partial[k] !== undefined && Math.abs(partial[k]! - lamp[k]) > EPS;
  if (lamp.stick_ceiling && !('stick_ceiling' in partial) && changed('z')) out.stick_ceiling = false;
  if (lamp.stick_wall && !('stick_wall' in partial) && (changed('x') || changed('y'))) out.stick_wall = false;
  return out;
}

/** The lamp with its stick lengths converted by `factor` (a units switch). */
export function scaleLampSticking<T extends LampStick>(lamp: T, factor: number): T {
  if (lamp.ceiling_offset === undefined && lamp.wall_t === undefined && lamp.wall_offset === undefined) return lamp;
  return {
    ...lamp,
    ...(lamp.ceiling_offset !== undefined ? { ceiling_offset: lamp.ceiling_offset * factor } : {}),
    ...(lamp.wall_t !== undefined ? { wall_t: lamp.wall_t * factor } : {}),
    ...(lamp.wall_offset !== undefined ? { wall_offset: lamp.wall_offset * factor } : {}),
  };
}

/** Validated stick state; null when malformed. */
export function parseLampSticking(value: unknown): LampStick | null {
  const result = LampStickSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The lamp's stick state, or null when it has none to save. */
export function stickStateOf(lamp: LampStick): LampStick | null {
  if (!lamp.stick_ceiling && !lamp.stick_wall) return null;
  const out: Record<string, unknown> = {};
  for (const k of STICK_KEYS) if (lamp[k] !== undefined) out[k] = lamp[k];
  return out as LampStick;
}

/** A stored lamp with its stick state kept when valid, and dropped (alone) when not. */
export function withValidSticking<T extends object>(lamp: T): T {
  const raw = lamp as Record<string, unknown>;
  if (!STICK_KEYS.some((k) => k in raw)) return lamp;
  const picked: Record<string, unknown> = {};
  for (const k of STICK_KEYS) if (raw[k] !== undefined) picked[k] = raw[k];
  if (parseLampSticking(picked)) return lamp;
  const rest = { ...raw };
  for (const k of STICK_KEYS) delete rest[k];
  return rest as T;
}
