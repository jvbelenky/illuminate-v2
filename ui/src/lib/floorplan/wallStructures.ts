/**
 * Interior walls read from a floor plan become structures: one box per wall,
 * along the segment with the measured thickness, from the floor to the
 * ceiling, named "Wall N".
 */
import type { SceneObject } from '$lib/types/project';
import type { Pt } from './importFrame';

/** A wall in room metres: its centre line's ends and its thickness. */
export interface WallMeters {
  a: Pt;
  b: Pt;
  thickness: number;
}

/** Thinner walls are built this thick (metres). */
export const MIN_WALL_THICKNESS_M = 0.05;

/** `count` names "Wall N", from 1, stepping past any name a structure already has. */
export function wallNames(existing: ReadonlyArray<{ name?: string | null }>, count: number): string[] {
  const taken = new Set(existing.map((o) => o.name ?? ''));
  const out: string[] = [];
  let n = 1;
  while (out.length < count) {
    while (taken.has(`Wall ${n}`)) n++;
    out.push(`Wall ${n}`);
    n++;
  }
  return out;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The structure for one wall. `k` converts metres to display units, `height`
 * is the room height (display units) and `base` supplies the defaults every
 * new structure gets (reflectance, transmittance, enabled).
 */
export function wallObject(wall: WallMeters, k: number, height: number, name: string, base: Omit<SceneObject, 'id'>): Omit<SceneObject, 'id'> {
  const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dy) * k;
  const thick = Math.max(wall.thickness, MIN_WALL_THICKNESS_M) * k;
  // Counter-clockwise from +x in the room, folded into (-90, 90]
  let yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (yaw > 90) yaw -= 180;
  if (yaw <= -90) yaw += 180;
  let width = len, length = thick;
  if (Math.abs(Math.abs(yaw) - 90) < 1e-6) {
    // Along y: no turn, the box is long in y
    width = thick;
    length = len;
    yaw = 0;
  } else if (Math.abs(yaw) < 1e-6) yaw = 0;
  return {
    ...base,
    shape: 'box',
    name,
    width: r6(width),
    length: r6(length),
    height,
    x: r6(((wall.a[0] + wall.b[0]) / 2) * k),
    y: r6(((wall.a[1] + wall.b[1]) / 2) * k),
    z: 0,
    yaw: r6(yaw),
    pitch: 0,
    roll: 0,
  };
}
