/**
 * Pure geometry helpers for scene objects (obstacles).
 *
 * Conventions follow guv_calcs `Object`: an object's (x, y) is the centre of
 * its footprint; a box footprint is centred on it and an extrusion's polygon is
 * translated so its centroid sits on it; yaw rotates the footprint about that
 * point, counter-clockwise in degrees. Pitch and roll are ignored here — the
 * plan view and the floor-plan editor only need the footprint.
 */

import type { SceneObject } from '$lib/types/project';

export type Vertex = [number, number];

/** Area-weighted centroid of a simple polygon (falls back to the vertex mean when degenerate). */
export function polygonCentroid(vertices: Vertex[]): Vertex {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    const sx = vertices.reduce((s, v) => s + v[0], 0);
    const sy = vertices.reduce((s, v) => s + v[1], 0);
    return [sx / n, sy / n];
  }
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
}

/**
 * The footprint in the object's local frame, centred on the origin: a box is
 * its rectangle, an extrusion its polygon minus the centroid.
 */
export function localFootprint(obj: Pick<SceneObject, 'shape' | 'width' | 'length' | 'vertices'>): Vertex[] {
  if (obj.shape === 'extrusion' && obj.vertices && obj.vertices.length >= 3) {
    const [cx, cy] = polygonCentroid(obj.vertices);
    return obj.vertices.map(([x, y]) => [x - cx, y - cy] as Vertex);
  }
  const hw = obj.width / 2;
  const hl = obj.length / 2;
  return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
}

/** World-space footprint corners (room units), rotated by yaw and placed at (x, y). */
export function objectFootprint(obj: Pick<SceneObject, 'shape' | 'width' | 'length' | 'vertices' | 'x' | 'y' | 'yaw'>): Vertex[] {
  const rad = (obj.yaw * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return localFootprint(obj).map(([lx, ly]) => [
    obj.x + lx * c - ly * s,
    obj.y + lx * s + ly * c,
  ] as Vertex);
}
