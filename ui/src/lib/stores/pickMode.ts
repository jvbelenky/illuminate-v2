/**
 * Pick Mode Store
 *
 * Allows ZoneEditor to request a 3D point pick from the Scene,
 * and the Scene to report the result back.
 */

import { writable } from 'svelte/store';

export type PickRequest = {
  type: 'target' | 'direction';
} | null;

export type PickResult = {
  type: 'target' | 'direction';
  value: [number, number, number];
} | null;

/** Active pick mode request (set by ZoneEditor, read by Scene) */
export const pickMode = writable<PickRequest>(null);

/** Result from the Scene (set by Scene, read by ZoneEditor) */
export const pickResult = writable<PickResult>(null);
