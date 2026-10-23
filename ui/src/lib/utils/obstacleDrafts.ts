/**
 * Obstacle footprints for the Plan editor's Obstacles step.
 *
 * A draft holds an obstacle's footprint in *world* coordinates (room units),
 * which is what the canvas edits, plus the few properties set while drawing.
 * Each finished edit goes straight to the store: a new draft becomes an
 * object via `objectFromDraft`, and a reshaped footprint is re-expressed in
 * guv_calcs' convention (vertices relative to the centroid, position =
 * centroid, yaw 0) by `footprintGeometry`, so an untouched rotated box keeps
 * its yaw.
 */
import type { SceneObject } from '$lib/types/project';
import { ROOM_DEFAULTS } from '$lib/types/project';
import { objectFootprint, polygonCentroid, type Vertex } from '$lib/utils/objectGeometry';
import { polygonBoundingBox, normalizeCCW } from '$lib/utils/roomGeometry';

export interface ObstacleDraft {
  /** Stable key while editing (the object id, or a fresh one for new drafts). */
  key: string;
  /** Store id, or null until applied. */
  id: string | null;
  name: string;
  /** World-space footprint, CCW, room units. */
  vertices: Vertex[];
  z: number;
  height: number;
  reflectance: number;
  transmittance: number;
  enabled: boolean;
  sourceShape: 'box' | 'extrusion';
  sourceYaw: number;
}

let keyCounter = 0;
export function newDraftKey(): string {
  keyCounter += 1;
  return `draft-${Date.now().toString(36)}-${keyCounter}`;
}

export function draftFromObject(obj: SceneObject): ObstacleDraft {
  return {
    key: obj.id,
    id: obj.id,
    name: obj.name ?? obj.id,
    vertices: objectFootprint(obj),
    z: obj.z,
    height: obj.height,
    reflectance: obj.reflectance,
    transmittance: obj.transmittance,
    enabled: obj.enabled !== false,
    sourceShape: obj.shape,
    sourceYaw: obj.yaw,
  };
}

export function draftsFromObjects(objects: SceneObject[]): ObstacleDraft[] {
  return objects.map(draftFromObject);
}

/** A fresh draft from a drawn polygon: floor to ceiling (partitions are the common case), named "Structure N". */
export function draftFromPolygon(vertices: Vertex[], roomZ: number, existing: ObstacleDraft[]): ObstacleDraft {
  const n = existing.filter((d) => /^Structure \d+$/.test(d.name)).length;
  return {
    key: newDraftKey(),
    id: null,
    name: `Structure ${n + 1}`,
    vertices: normalizeCCW(vertices),
    z: 0,
    height: roomZ,
    reflectance: ROOM_DEFAULTS.reflectance,
    transmittance: 0,
    enabled: true,
    sourceShape: 'extrusion',
    sourceYaw: 0,
  };
}

/** A copy of a draft, offset so it does not sit exactly on the original. */
export function duplicateDraft(draft: ObstacleDraft, offset: number, existing: ObstacleDraft[]): ObstacleDraft {
  const base = draft.name.replace(/\s+\d+$/, '') || 'Structure';
  const n = existing.filter((d) => d.name.startsWith(base)).length;
  return {
    ...draft,
    key: newDraftKey(),
    id: null,
    name: `${base} ${n + 1}`,
    vertices: draft.vertices.map(([x, y]) => [x + offset, y + offset] as Vertex),
    sourceShape: 'extrusion',
    sourceYaw: 0,
  };
}

export function translateVertices(vertices: Vertex[], dx: number, dy: number): Vertex[] {
  return vertices.map(([x, y]) => [Math.round((x + dx) * 1e6) / 1e6, Math.round((y + dy) * 1e6) / 1e6] as Vertex);
}

/** guv_calcs geometry for a world footprint: local vertices about the centroid, centroid position, bounding size. */
export function footprintGeometry(world: Vertex[]): Pick<SceneObject, 'shape' | 'vertices' | 'x' | 'y' | 'yaw' | 'width' | 'length'> {
  const ccw = normalizeCCW(world);
  const [cx, cy] = polygonCentroid(ccw);
  const local = ccw.map(([x, y]) => [Math.round((x - cx) * 1e6) / 1e6, Math.round((y - cy) * 1e6) / 1e6] as Vertex);
  const bb = polygonBoundingBox(local);
  return {
    shape: 'extrusion',
    vertices: local,
    x: Math.round(cx * 1e6) / 1e6,
    y: Math.round(cy * 1e6) / 1e6,
    yaw: 0,
    width: bb.xMax - bb.xMin,
    length: bb.yMax - bb.yMin,
  };
}

/** The object a new draft becomes. */
export function objectFromDraft(d: ObstacleDraft): Omit<SceneObject, 'id'> {
  return {
    ...footprintGeometry(d.vertices),
    name: d.name,
    z: d.z,
    height: d.height,
    pitch: 0,
    roll: 0,
    reflectance: d.reflectance,
    transmittance: d.transmittance,
    enabled: d.enabled,
  };
}
