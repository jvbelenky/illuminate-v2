import type { Vertex } from '$lib/utils/roomGeometry';

// Snapping shapes inside the room (structures, zones, ceiling items) to the
// room outline. Pure geometry in room units; the canvas converts its pixel
// tolerances to room units before calling.

/** A point pulled onto the outline: an outline corner, or the nearest point on an edge. */
export interface PointSnap {
  point: Vertex;
  /** Outline corner index when it landed on a corner. */
  corner: number | null;
  /** Outline edge index (edge i runs from corner i to corner i+1) when it landed on an edge. */
  edge: number | null;
}

/** A translation correction that puts a moved shape flush against outline walls. */
export interface TranslationSnap {
  /** Add this to the shape's translation. */
  offset: Vertex;
  /** The axes the outline snap decided (a grid snap on them is replaced). */
  x: boolean;
  y: boolean;
  /** Outline edges the shape now touches. */
  edges: number[];
}

const EPS = 1e-9;

function edgeOf(outline: Vertex[], i: number): [Vertex, Vertex] {
  return [outline[i], outline[(i + 1) % outline.length]];
}

/** Snap a point to the nearest outline corner within `tol`, else onto the nearest edge within `tol`. */
export function snapPointToOutline(p: Vertex, outline: Vertex[] | undefined, tol: number): PointSnap | null {
  if (!outline || outline.length < 3 || !(tol > 0)) return null;
  let best: PointSnap | null = null;
  let bestD = Infinity;
  outline.forEach((c, i) => {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d <= tol && d < bestD) {
      bestD = d;
      best = { point: [c[0], c[1]], corner: i, edge: null };
    }
  });
  if (best) return best;
  for (let i = 0; i < outline.length; i++) {
    const [a, b] = edgeOf(outline, i);
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey;
    if (len2 < EPS) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2));
    const q: Vertex = [a[0] + ex * t, a[1] + ey * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= tol && d < bestD) {
      bestD = d;
      best = { point: q, corner: null, edge: i };
    }
  }
  return best;
}

/** True when edge i of the outline is horizontal (y constant) or vertical (x constant). */
export function edgeAxis(outline: Vertex[], i: number): 'horizontal' | 'vertical' | null {
  const [a, b] = edgeOf(outline, i);
  if (Math.abs(a[1] - b[1]) < EPS) return 'horizontal';
  if (Math.abs(a[0] - b[0]) < EPS) return 'vertical';
  return null;
}

interface Constraint {
  /** Unit normal of the wall. */
  n: Vertex;
  /** Signed distance of the corner from the wall's line, along n. */
  d: number;
  edge: number;
}

/**
 * The correction that puts the moved `corners` flush against the outline: every
 * corner within `tol` of a wall (and alongside it) is a candidate. The closest
 * one wins; a second, non-parallel wall within `tol` is satisfied as well, so a
 * shape sits in a room corner flush to both walls. Parallel shape edges come
 * along for free (all their corners share the distance). Returns null when no
 * wall is within `tol`.
 */
export function snapTranslationToOutline(corners: Vertex[], outline: Vertex[] | undefined, tol: number): TranslationSnap | null {
  if (!outline || outline.length < 3 || corners.length === 0 || !(tol > 0)) return null;
  const found: Constraint[] = [];
  for (let i = 0; i < outline.length; i++) {
    const [a, b] = edgeOf(outline, i);
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < EPS) continue;
    const ux = ex / len, uy = ey / len;
    const n: Vertex = [-uy, ux];
    for (const c of corners) {
      const rx = c[0] - a[0], ry = c[1] - a[1];
      const along = rx * ux + ry * uy;
      // Only alongside the wall (a little past its ends still counts, for corners)
      if (along < -tol || along > len + tol) continue;
      const d = rx * n[0] + ry * n[1];
      if (Math.abs(d) <= tol) found.push({ n, d, edge: i });
    }
  }
  if (found.length === 0) return null;
  found.sort((p, q) => Math.abs(p.d) - Math.abs(q.d));
  const c1 = found[0];
  let offset: Vertex = [-c1.d * c1.n[0], -c1.d * c1.n[1]];
  const used = [c1];
  const c2 = found.find((c) => Math.abs(c.n[0] * c1.n[1] - c.n[1] * c1.n[0]) > 0.05);
  if (c2) {
    // Solve v·n1 = -d1 and v·n2 = -d2
    const det = c1.n[0] * c2.n[1] - c1.n[1] * c2.n[0];
    const vx = (-c1.d * c2.n[1] + c2.d * c1.n[1]) / det;
    const vy = (-c2.d * c1.n[0] + c1.d * c2.n[0]) / det;
    if (Math.hypot(vx, vy) <= tol * 2) {
      offset = [vx, vy];
      used.push(c2);
    }
  }
  const x = used.some((c) => Math.abs(c.n[0]) > 1e-6);
  const y = used.some((c) => Math.abs(c.n[1]) > 1e-6);
  // Every wall the corrected shape now touches, for the guides
  const edges = [...new Set(found.filter((c) => Math.abs(c.d + offset[0] * c.n[0] + offset[1] * c.n[1]) < 1e-6).map((c) => c.edge))];
  return { offset, x, y, edges };
}
