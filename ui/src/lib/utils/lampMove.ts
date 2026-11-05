/**
 * Moving a lamp, or a calc point: only it moves. Its aim point stays where it
 * is in the room, so it turns to keep aiming at it (the Aim tool and the aim
 * fields move the aim point).
 */
import type { CalcZone, LampInstance } from '$lib/types/project';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

type Placed = Pick<LampInstance, 'x' | 'y' | 'z' | 'aimx' | 'aimy' | 'aimz'>;

/**
 * The update that puts the lamp at (x, y, z), its aim point left in place. A
 * lamp landing on its own aim point would have no direction (the backend
 * refuses it): then the aim point travels with it, as it did before.
 */
export function moveLampKeepingAim(lamp: Placed, x: number, y: number, z: number = lamp.z): Partial<LampInstance> {
  const p = { x: r6(x), y: r6(y), z: r6(z) };
  const onAim = Math.abs(p.x - lamp.aimx) < 1e-9 && Math.abs(p.y - lamp.aimy) < 1e-9 && Math.abs(p.z - lamp.aimz) < 1e-9;
  if (!onAim) return p;
  return { ...p, aimx: r6(lamp.aimx + p.x - lamp.x), aimy: r6(lamp.aimy + p.y - lamp.y), aimz: r6(lamp.aimz + p.z - lamp.z) };
}

type PlacedPoint = Pick<CalcZone, 'x' | 'y' | 'z' | 'aim_x' | 'aim_y' | 'aim_z'>;

/** A calc point's position and aim point; unset ones as the backend fills them (aimed straight up). */
export function pointPlacement(p: PlacedPoint): { x: number; y: number; z: number; aimx: number; aimy: number; aimz: number } {
  const x = p.x ?? 0, y = p.y ?? 0, z = p.z ?? 1;
  return { x, y, z, aimx: p.aim_x ?? x, aimy: p.aim_y ?? y, aimz: p.aim_z ?? z + 1 };
}

/**
 * The update that puts a calc point at (x, y, z), as a lamp: its aim point
 * stays, so its direction turns to keep looking at it. Landing on its own aim
 * point (no direction) carries the aim point along instead.
 */
export function movePointKeepingAim(point: PlacedPoint, x: number, y: number, z?: number): Partial<CalcZone> {
  const at = pointPlacement(point);
  const u = moveLampKeepingAim(at, x, y, z ?? at.z);
  return {
    x: u.x, y: u.y, z: u.z,
    ...(u.aimx !== undefined ? { aim_x: u.aimx, aim_y: u.aimy, aim_z: u.aimz } : {}),
  };
}
