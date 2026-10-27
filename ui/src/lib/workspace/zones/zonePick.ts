/**
 * The zone panel's picks: Place, Aim, View direction and Target ask the 3D
 * view for a point (the main view switches to 3D while one is active), and
 * the result comes back as the zone fields it sets.
 */
import { get } from 'svelte/store';
import { pickMode, pickResult, activeViewPreset, lockedAxisForView, type PickType, type PickResult } from '$lib/stores/pickMode';
import type { CalcZone } from '$lib/types/project';

export type ZonePick = 'point_position' | 'aim_point' | 'direction' | 'target';

/** Start a pick, or cancel it when it is the one running. On an axis view, `current` keeps that axis. */
export function togglePick(type: ZonePick, current?: [number, number, number]): void {
  if (get(pickMode)?.type === type) {
    pickMode.set(null);
    return;
  }
  const axis = lockedAxisForView(get(activeViewPreset));
  pickResult.set(null);
  pickMode.set({ type: type as PickType, lockedAxis: axis, lockedValue: axis && current ? current[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] : undefined });
}

const round = (v: number, k: number) => Math.round(v * k) / k;

/** The zone fields a pick result sets, or null when it is not a zone pick. */
export function pickPartial(result: PickResult): Partial<CalcZone> | null {
  if (!result) return null;
  const [x, y, z] = result.value;
  switch (result.type) {
    case 'point_position': return { x: round(x, 1e6), y: round(y, 1e6), z: round(z, 1e6) };
    case 'aim_point': return { aim_x: round(x, 1e6), aim_y: round(y, 1e6), aim_z: round(z, 1e6) };
    case 'direction': return { view_direction: [round(x, 1e3), round(y, 1e3), round(z, 1e3)] };
    case 'target': return { view_target: [round(x, 1e3), round(y, 1e3), round(z, 1e3)] };
    default: return null;
  }
}
