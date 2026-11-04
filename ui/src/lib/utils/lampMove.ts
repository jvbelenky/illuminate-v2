/**
 * Moving a lamp: only the lamp moves. Its aim point stays where it is in the
 * room, so the lamp turns to keep aiming at it (the Aim tool and the aim
 * fields move the aim point).
 */
import type { LampInstance } from '$lib/types/project';

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
