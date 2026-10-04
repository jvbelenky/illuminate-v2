/**
 * Vertical extent of a scene object as the UI presents it.
 *
 * guv_calcs stores an object's base `z` and its `height`; the sidebar shows
 * that as a bottom and a top, and calls an object that spans the whole room
 * "floor to ceiling". That state is derived, never stored, so a `.guv`
 * round-trip needs no extra field and a room-height change can keep such
 * objects full height by re-sending their height (see the project store).
 */
import type { SceneObject } from '$lib/types/project';

/** Tolerance in room units for "touches the floor / ceiling". */
export const HEIGHT_EPS = 1e-6;

export type ObjectHeightFields = Pick<SceneObject, 'z' | 'height'>;

export function objectTop(obj: ObjectHeightFields): number {
  return obj.z + obj.height;
}

export function isFloorToCeiling(obj: ObjectHeightFields, roomZ: number): boolean {
  return Math.abs(obj.z) <= HEIGHT_EPS && Math.abs(objectTop(obj) - roomZ) <= HEIGHT_EPS;
}

/** The update that makes an object span the room's full height. */
export function floorToCeilingUpdate(roomZ: number): Pick<SceneObject, 'z' | 'height'> {
  return { z: 0, height: roomZ };
}

/** Move the bottom face, keeping the top where it is (never thinner than `minHeight`). */
export function bottomUpdate(obj: ObjectHeightFields, bottom: number, minHeight = 0.001): Pick<SceneObject, 'z' | 'height'> {
  const top = objectTop(obj);
  return { z: bottom, height: Math.max(minHeight, top - bottom) };
}

/** Move the top face, keeping the bottom where it is. */
export function topUpdate(obj: ObjectHeightFields, top: number, minHeight = 0.001): Pick<SceneObject, 'height'> {
  return { height: Math.max(minHeight, top - obj.z) };
}

/** "floor to ceiling", or "0.7 to 1.5 m". */
export function objectHeightText(obj: ObjectHeightFields, roomZ: number, precision: number, unit: string): string {
  if (isFloorToCeiling(obj, roomZ)) return 'floor to ceiling';
  return `${obj.z.toFixed(precision)} to ${objectTop(obj).toFixed(precision)} ${unit}`;
}
