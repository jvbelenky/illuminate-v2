/**
 * Object (obstacle) faces as reflective planes.
 *
 * Face ids and order follow guv_calcs `Object`: "bottom", "top", then one
 * "wall_N" per footprint edge, N counting from the first vertex of the local
 * footprint (see `localFootprint`). Optics are an object-level R/T baseline
 * plus sparse per-face overrides; grid resolution is per face, like a room
 * surface.
 */

import type { SceneObject, FaceOptics, RoomConfig } from '$lib/types/project';
import { localFootprint } from '$lib/utils/objectGeometry';
import { polygonBoundingBox, polygonEdgeLengths } from '$lib/utils/roomGeometry';
import { ROOM_DEFAULTS } from '$lib/types/project';

/** guv_calcs builds object faces with a 5x5 grid by default. */
export const OBJECT_FACE_DEFAULT_NUM_POINTS = 5;

type FaceGeometry = Pick<SceneObject, 'shape' | 'width' | 'length' | 'height' | 'vertices'>;

/** Face ids in guv_calcs order: bottom, top, then one side per footprint edge. */
export function objectFaceIds(obj: FaceGeometry): string[] {
  const n = localFootprint(obj).length;
  return ['bottom', 'top', ...Array.from({ length: n }, (_, i) => `wall_${i}`)];
}

/** Human label for a face id ("Bottom", "Top", "Side 3"). */
export function faceLabel(id: string): string {
  const m = /^wall_(\d+)$/.exec(id);
  if (m) return `Side ${Number(m[1]) + 1}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Combined plane key used by the 3D preview and the surfaces endpoint. */
export function planeKey(objectId: string, faceId: string): string {
  return `${objectId}:${faceId}`;
}

/** Split a plane key back into object and face ids (null for a room surface). */
export function parsePlaneKey(key: string): { objectId: string; faceId: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  return { objectId: key.slice(0, i), faceId: key.slice(i + 1) };
}

/** The face's R/T: its override, or the object-level baseline. */
export function faceOptics(obj: SceneObject, faceId: string): FaceOptics {
  return obj.face_properties?.[faceId] ?? { R: obj.reflectance, T: obj.transmittance };
}

function sameOptics(a: FaceOptics, b: FaceOptics): boolean {
  return Math.abs(a.R - b.R) < 1e-9 && Math.abs(a.T - b.T) < 1e-9;
}

/**
 * The sparse override map after setting one face's optics against the given
 * baseline: an entry equal to the baseline is dropped.
 */
export function withFaceOptics(
  overrides: Record<string, FaceOptics> | undefined,
  baseline: FaceOptics,
  faceId: string,
  optics: FaceOptics,
): Record<string, FaceOptics> {
  const next = { ...(overrides ?? {}) };
  if (sameOptics(optics, baseline)) delete next[faceId];
  else next[faceId] = { R: optics.R, T: optics.T };
  return next;
}

/**
 * Rebase every override onto a new baseline reflectance, keeping each face's
 * own transmittance: the quickset "set R everywhere" semantics.
 */
export function overridesWithReflectance(
  obj: SceneObject,
  R: number,
): Record<string, FaceOptics> {
  const baseline = { R, T: obj.transmittance };
  let next: Record<string, FaceOptics> = {};
  for (const [faceId, optics] of Object.entries(obj.face_properties ?? {})) {
    next = withFaceOptics(next, baseline, faceId, { R, T: optics.T });
  }
  return next;
}

/** Physical x/y extents of a face, for spacing <-> point-count conversion. */
export function faceSpans(obj: FaceGeometry, faceId: string): { x: number; y: number } {
  const footprint = localFootprint(obj);
  if (faceId === 'bottom' || faceId === 'top') {
    const bb = polygonBoundingBox(footprint);
    return { x: bb.xMax - bb.xMin, y: bb.yMax - bb.yMin };
  }
  const m = /^wall_(\d+)$/.exec(faceId);
  const edge = m ? Number(m[1]) : -1;
  const lengths = polygonEdgeLengths(footprint);
  return { x: edge >= 0 && edge < lengths.length ? lengths[edge] : obj.width, y: obj.height };
}

/** The face's grid counts, falling back to guv_calcs' default. */
export function faceNumPoints(obj: SceneObject, faceId: string): { x: number; y: number } {
  const n = OBJECT_FACE_DEFAULT_NUM_POINTS;
  return obj.face_num_points?.[faceId] ?? { x: n, y: n };
}

/** The face's grid spacing, derived from its spans when the backend hasn't said. */
export function faceSpacing(obj: SceneObject, faceId: string): { x: number; y: number } {
  const existing = obj.face_spacings?.[faceId];
  if (existing) return existing;
  const spans = faceSpans(obj, faceId);
  const np = faceNumPoints(obj, faceId);
  return { x: spans.x / np.x, y: spans.y / np.y };
}

/**
 * The one reflectance shared by every room surface and every object face,
 * or null when they differ ("mixed"). Transmittance is ignored.
 */
export function commonReflectance(
  room: Pick<RoomConfig, 'reflectances'>,
  objects: SceneObject[],
): number | null {
  const values: number[] = Object.values(room.reflectances ?? {});
  for (const obj of objects) {
    values.push(obj.reflectance);
    for (const optics of Object.values(obj.face_properties ?? {})) values.push(optics.R);
  }
  if (values.length === 0) return ROOM_DEFAULTS.reflectance;
  const first = values[0];
  return values.every((v) => Math.abs(v - first) < 1e-9) ? first : null;
}
