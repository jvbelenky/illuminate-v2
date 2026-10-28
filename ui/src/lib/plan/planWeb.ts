/**
 * The photometric web projected onto the 2D view: its silhouette as seen
 * from above (floor and ceiling) or face-on to a wall (seen from inside, so
 * mirrored through `wallToCanvas`, like everything else on a wall).
 *
 * The web's vertices are in the lamp's own frame, room axes (z up), as the
 * API sends them. They are placed with the same transform the 3D view uses
 * (Lamp3D.svelte): world = position + scale * Rz(heading) Ry(-bank) Rz(angle) v,
 * which is the room-coordinate form of Lamp3D's Three.js
 * Ry(heading) Rz(bank) Ry(angle) (Three's y up / z = -room y swap).
 */
import type { LampInstance } from '$lib/types/project';
import { toWall, type WallSegment } from '$lib/utils/surfaces';
import { wallToCanvas } from './wallProjection';

/** What placing a web needs from a lamp; `web_size_2d` multiplies the drawn size (default 1). */
export type WebLamp = Pick<LampInstance, 'x' | 'y' | 'z' | 'aimx' | 'aimy' | 'aimz'> & {
  angle?: number;
  web_size_2d?: number;
};

type Mat3 = [number, number, number, number, number, number, number, number, number];

/** The lamp-to-room rotation, row-major, matching Lamp3D's getRotation. */
export function lampRotation(lamp: WebLamp): Mat3 {
  const dx = lamp.aimx - lamp.x, dy = lamp.aimy - lamp.y, dz = lamp.aimz - lamp.z;
  const norm = Math.hypot(dx, dy, dz);
  if (norm === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const h = Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10 ? 0 : Math.atan2(dy, dx);
  const b = Math.acos(Math.max(-1, Math.min(1, -dz / norm)));
  const a = ((lamp.angle || 0) * Math.PI) / 180;
  const ch = Math.cos(h), sh = Math.sin(h);
  // Ry(-b): x' = x cb - z sb, z' = x sb + z cb
  const cb = Math.cos(b), sb = Math.sin(b);
  const ca = Math.cos(a), sa = Math.sin(a);
  const rz = (c: number, s: number): Mat3 => [c, -s, 0, s, c, 0, 0, 0, 1];
  const ry: Mat3 = [cb, 0, -sb, 0, 1, 0, sb, 0, cb];
  return mul(mul(rz(ch, sh), ry), rz(ca, sa));
}

function mul(p: Mat3, q: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j];
  return r;
}

/** Andrew's monotone chain; counter-clockwise, no repeated end point. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The web's silhouette on the view, as closed polylines in the view's
 * coordinates: plan (x, y) with `seg` null, else the wall's canvas (x, y).
 * `displayScale` is the room view's oversize factor (`webDisplayScale`);
 * the lamp's `web_size_2d` multiplies it. A lamp behind the wall gives none.
 */
export function webOutline2d(
  lamp: WebLamp,
  vertices: number[][],
  seg: WallSegment | null,
  displayScale = 1,
): [number, number][][] {
  if (vertices.length === 0) return [];
  if (seg && toWall(lamp.x, lamp.y, lamp.z, seg).depth < -1e-9) return [];
  const s = displayScale * (lamp.web_size_2d ?? 1);
  const m = lampRotation(lamp);
  const pts: [number, number][] = vertices.map(([vx, vy, vz]) => {
    const x = lamp.x + s * (m[0] * vx + m[1] * vy + m[2] * vz);
    const y = lamp.y + s * (m[3] * vx + m[4] * vy + m[5] * vz);
    if (!seg) return [x, y];
    const z = lamp.z + s * (m[6] * vx + m[7] * vy + m[8] * vz);
    const w = toWall(x, y, z, seg);
    return wallToCanvas(w.along, w.up, seg);
  });
  const hull = convexHull(pts);
  return hull.length >= 3 ? [hull] : [];
}
