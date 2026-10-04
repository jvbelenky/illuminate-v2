/**
 * Transactional obstacle drafts for the Plan editor's Obstacles layer.
 *
 * A draft holds an obstacle's footprint in *world* coordinates (room units),
 * which is what the canvas edits, plus the few properties set while drawing.
 * On Apply the drafts are diffed against the store's objects and turned into
 * the add / update / remove calls the project store already offers. Geometry
 * is re-expressed in guv_calcs' convention (vertices relative to the centroid,
 * position = centroid, yaw 0) only when the footprint actually changed, so an
 * untouched rotated box keeps its yaw.
 */
import type { SceneObject } from '$lib/types/project';
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

const GEOM_EPS = 1e-6;

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

/** A fresh draft from a drawn polygon: floor to ceiling (partitions are the common case), named "Obstacle N". */
export function draftFromPolygon(vertices: Vertex[], roomZ: number, existing: ObstacleDraft[]): ObstacleDraft {
  const n = existing.filter((d) => /^Obstacle \d+$/.test(d.name)).length;
  return {
    key: newDraftKey(),
    id: null,
    name: `Obstacle ${n + 1}`,
    vertices: normalizeCCW(vertices),
    z: 0,
    height: roomZ,
    reflectance: 0,
    transmittance: 0,
    enabled: true,
    sourceShape: 'extrusion',
    sourceYaw: 0,
  };
}

/** A copy of a draft, offset so it does not sit exactly on the original. */
export function duplicateDraft(draft: ObstacleDraft, offset: number, existing: ObstacleDraft[]): ObstacleDraft {
  const base = draft.name.replace(/\s+\d+$/, '') || 'Obstacle';
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

function sameFootprint(a: Vertex[], b: Vertex[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(([x, y], i) => Math.abs(x - b[i][0]) <= GEOM_EPS && Math.abs(y - b[i][1]) <= GEOM_EPS);
}

export interface ObstacleDiff {
  adds: Omit<SceneObject, 'id'>[];
  updates: { id: string; partial: Partial<SceneObject> }[];
  removes: string[];
}

/** What Apply must do to turn `objects` into `drafts`. */
export function diffObstacleDrafts(drafts: ObstacleDraft[], objects: SceneObject[]): ObstacleDiff {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const adds: ObstacleDiff['adds'] = [];
  const updates: ObstacleDiff['updates'] = [];

  for (const d of drafts) {
    if (d.id === null || !byId.has(d.id)) {
      adds.push({
        ...footprintGeometry(d.vertices),
        name: d.name,
        z: d.z,
        height: d.height,
        pitch: 0,
        roll: 0,
        reflectance: d.reflectance,
        transmittance: d.transmittance,
        enabled: d.enabled,
      });
      continue;
    }
    seen.add(d.id);
    const o = byId.get(d.id)!;
    const partial: Partial<SceneObject> = {};
    if (!sameFootprint(d.vertices, objectFootprint(o))) Object.assign(partial, footprintGeometry(d.vertices));
    if (d.name !== (o.name ?? o.id)) partial.name = d.name;
    if (Math.abs(d.z - o.z) > GEOM_EPS) partial.z = d.z;
    if (Math.abs(d.height - o.height) > GEOM_EPS) partial.height = d.height;
    if (Math.abs(d.reflectance - o.reflectance) > GEOM_EPS || Math.abs(d.transmittance - o.transmittance) > GEOM_EPS) {
      // R and T are validated as a pair by guv_calcs, so they travel together
      partial.reflectance = d.reflectance;
      partial.transmittance = d.transmittance;
    }
    if (d.enabled !== (o.enabled !== false)) partial.enabled = d.enabled;
    if (Object.keys(partial).length > 0) updates.push({ id: d.id, partial });
  }

  const removes = objects.filter((o) => !seen.has(o.id)).map((o) => o.id);
  return { adds, updates, removes };
}
