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
import { normalizeCCW } from '$lib/utils/roomGeometry';

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

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The object fields for a world footprint turned by `yaw` (the inverse of
 * `objectFootprint`): position = centroid, the polygon unrotated about it.
 * A box stays a box while the footprint is still a rectangle along its own
 * sides; otherwise it becomes an extrusion. Yaw is kept, so Width and Length
 * stay measured along the structure's own sides. Values within rounding of
 * the current ones keep the current ones, so turning or moving a structure
 * never drifts its size.
 */
export function footprintUpdate(
  obj: Pick<SceneObject, 'shape' | 'x' | 'y' | 'width' | 'length' | 'vertices'>,
  world: Vertex[],
  yaw: number,
): Pick<SceneObject, 'x' | 'y' | 'yaw' | 'width' | 'length'> & Partial<Pick<SceneObject, 'shape' | 'vertices'>> {
  // Counter-clockwise, as guv_calcs and footprintGeometry expect (a corner edit can flip it)
  world = normalizeCCW(world);
  const [cx, cy] = polygonCentroid(world);
  const rad = (-yaw * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const local = world.map(([x, y]) => [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c] as Vertex);
  const xs = local.map((v) => v[0]);
  const ys = local.map((v) => v[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const span = Math.max(1, xMax - xMin, yMax - yMin, Math.abs(cx), Math.abs(cy));
  const keep = (next: number, current: number) => (Math.abs(next - current) <= 1e-5 * span ? current : r6(next));
  const base = { x: keep(cx, obj.x), y: keep(cy, obj.y), yaw, width: keep(xMax - xMin, obj.width), length: keep(yMax - yMin, obj.length) };
  const eps = 1e-5 * span;
  const near = (a: number, b: number) => Math.abs(a - b) <= eps;
  const corners = new Set(local.map(([x, y]) => `${near(x, xMin) ? 0 : near(x, xMax) ? 1 : 'x'}${near(y, yMin) ? 0 : near(y, yMax) ? 1 : 'y'}`));
  const isRectangle = local.length === 4 && corners.size === 4 && [...corners].every((k) => /^[01][01]$/.test(k));
  if (obj.shape === 'box' && isRectangle) return base;
  // An extrusion only moved or turned keeps its own polygon
  const own = obj.shape === 'extrusion' && obj.vertices && obj.vertices.length === local.length ? localFootprint(obj) : null;
  if (own && own.every(([x, y], i) => near(x, local[i][0]) && near(y, local[i][1]))) return base;
  return { ...base, shape: 'extrusion', vertices: local.map(([x, y]) => [r6(x), r6(y)] as Vertex) };
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
