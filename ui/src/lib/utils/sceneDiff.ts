/**
 * Scene snapshots and the diffs undo/redo replays through the project store.
 *
 * A snapshot holds what a user edit can change: the room (minus view toggles),
 * lamps, user calc zones, obstacles and the floor-plan image. Standard zones are
 * left out: the backend regenerates them from the room and the standard.
 */
import type { CalcZone, LampInstance, RoomConfig, SceneObject } from '$lib/types/project';
import type { FloorPlanImage } from '$lib/stores/floorplanImage';
import { ceilingContent, type CeilingLayout } from '$lib/ceiling/ceilingLayout';

export interface SceneSnapshot {
  room: RoomConfig;
  lamps: LampInstance[];
  zones: CalcZone[];
  objects: SceneObject[];
  image: FloorPlanImage | null;
  /** The ceiling designer's layout; its eyes are view state, not compared. */
  ceiling?: CeilingLayout;
  /** Ids of the structures whose name label shows (frontend-only). */
  labels?: string[];
}

/** The same label ids, in any order. */
export function sameLabels(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Room fields that only change how things are shown; never undo steps. */
export const ROOM_VIEW_KEYS: readonly (keyof RoomConfig)[] = [
  'showDimensions', 'showPhotometricWebs', 'showGrid', 'showFloorPlanImage', 'showXYZMarker',
  'showLampLabels', 'showCalcPointLabels', 'globalHeatmapNormalization', 'colormap', 'precision',
];

/** Lamp fields owned by the upload pipeline or echoed by the backend, never replayed. */
export const LAMP_RUNTIME_KEYS: readonly string[] = [
  'has_ies_file', 'has_spectrum_file', 'ies_filename', 'spectrum_filename',
  'pending_ies_file', 'pending_spectrum_file', 'pending_spectrum_column_index',
  'pending_intensity_map_file', 'pending_advanced', 'pending_remove_ies', 'pending_remove_spectrum',
];

/** Deep equality for plain data; a key holding `undefined` counts as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  // Files and other class instances compare by identity (handled above)
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/** The fields of `target` that differ from `current`, skipping `ignore`; a field missing from target maps to undefined. */
export function changedFields<T extends object>(current: T, target: T, ignore: readonly string[] = []): Partial<T> {
  const out: Record<string, unknown> = {};
  const c = current as Record<string, unknown>;
  const t = target as Record<string, unknown>;
  const keys = new Set([...Object.keys(c), ...Object.keys(t)]);
  for (const k of keys) {
    if (ignore.includes(k) || k === 'id') continue;
    if (!deepEqual(c[k], t[k])) out[k] = t[k];
  }
  return out as Partial<T>;
}

/** True when applying `partial` to `current` would change something (ignoring `ignore`). */
export function partialChanges<T extends object>(current: T | undefined, partial: Partial<T>, ignore: readonly string[] = []): boolean {
  if (!current) return true;
  const c = current as Record<string, unknown>;
  for (const [k, v] of Object.entries(partial)) {
    if (ignore.includes(k)) continue;
    if (!deepEqual(c[k], v)) return true;
  }
  return false;
}

export interface EntityDiff<T extends { id: string }> {
  removes: string[];
  adds: T[];
  updates: { id: string; partial: Partial<T> }[];
}

/** What turns `current` into `target`, matched by id. */
export function diffEntities<T extends { id: string }>(current: T[], target: T[], ignore: readonly string[] = []): EntityDiff<T> {
  const currentById = new Map(current.map((e) => [e.id, e]));
  const targetIds = new Set(target.map((e) => e.id));
  const removes = current.filter((e) => !targetIds.has(e.id)).map((e) => e.id);
  const adds: T[] = [];
  const updates: EntityDiff<T>['updates'] = [];
  for (const t of target) {
    const c = currentById.get(t.id);
    if (!c) {
      adds.push(t);
      continue;
    }
    const partial = changedFields(c, t, ignore);
    if (Object.keys(partial).length > 0) updates.push({ id: t.id, partial });
  }
  return { removes, adds, updates };
}

export function userZones(zones: CalcZone[]): CalcZone[] {
  return zones.filter((z) => !z.isStandard);
}

export function roomPartialFor(current: RoomConfig, target: RoomConfig): Partial<RoomConfig> {
  return changedFields(current, target, ROOM_VIEW_KEYS as readonly string[]);
}

export function sceneEquals(a: SceneSnapshot, b: SceneSnapshot): boolean {
  if ((a.image?.id ?? null) !== (b.image?.id ?? null)) return false;
  if (Object.keys(roomPartialFor(a.room, b.room)).length > 0) return false;
  const same = <T extends { id: string }>(x: T[], y: T[], ignore: readonly string[] = []) => {
    const d = diffEntities(x, y, ignore);
    return d.removes.length === 0 && d.adds.length === 0 && d.updates.length === 0;
  };
  if (!deepEqual(a.ceiling ? ceilingContent(a.ceiling) : null, b.ceiling ? ceilingContent(b.ceiling) : null)) return false;
  if (!sameLabels(a.labels, b.labels)) return false;
  return same(a.lamps, b.lamps, LAMP_RUNTIME_KEYS)
    && same(userZones(a.zones), userZones(b.zones))
    && same(a.objects, b.objects);
}

/** Reorder `items` to follow `order` (by id); ids not in `order` keep their place at the end. */
export function orderLike<T extends { id: string }>(items: T[], order: { id: string }[]): T[] {
  const rank = new Map(order.map((e, i) => [e.id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
