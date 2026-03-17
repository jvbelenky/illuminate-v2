/**
 * Pick Mode Store
 *
 * Allows editors (ZoneEditor, LampEditor) to request a 3D point pick
 * from the Scene, and the Scene to report the result back.
 *
 * When an axis-aligned view is active, the requester can supply a
 * `lockedAxis` and `lockedValue` so the Scene preserves that coordinate
 * instead of overwriting it with the pick surface intersection.
 */

import { writable } from 'svelte/store';

export type PickType =
  | 'target'        // eye_target view target (plane zone)
  | 'direction'     // eye_directional drag-to-set (plane zone)
  | 'aim_point'     // CalcPoint aim point
  | 'point_position' // CalcPoint position
  | 'lamp_position' // Lamp position
  | 'lamp_aim';     // Lamp aim point

export type LockedAxis = 'x' | 'y' | 'z';

export type PickRequest = {
  type: PickType;
  /** Axis to keep unchanged (perpendicular to view plane) */
  lockedAxis?: LockedAxis;
  /** Value to use for the locked axis */
  lockedValue?: number;
} | null;

export type PickResult = {
  type: PickType;
  value: [number, number, number];
} | null;

/** Active pick mode request (set by editors, read by Scene) */
export const pickMode = writable<PickRequest>(null);

/** Result from the Scene (set by Scene, read by editors) */
export const pickResult = writable<PickResult>(null);

/** Currently active view preset (set by RoomViewer, read by editors to determine locked axis) */
export const activeViewPreset = writable<string | null>(null);

/**
 * Given a view preset, return which room-space axis is perpendicular to
 * the screen (i.e. should be locked when picking).
 */
export function lockedAxisForView(view: string | null): LockedAxis | undefined {
  if (!view) return undefined;
  if (view === 'top') return 'z';
  if (view === 'front' || view === 'back') return 'y';
  if (view === 'left' || view === 'right') return 'x';
  return undefined; // iso views — no locking
}
