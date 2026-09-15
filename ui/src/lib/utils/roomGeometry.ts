/**
 * Floor-plan geometry helpers for rectangular and polygon rooms.
 *
 * Mirrors the conventions of guv_calcs' Polygon2D / RoomDimensions:
 * - vertices are normalised to counter-clockwise (CCW) order
 * - edge i runs from vertex i to vertex (i + 1) % n
 * - a 4-vertex axis-aligned outline is a "rectangle" and its walls are named
 *   south, east, north, west by edge index; any other outline names its walls
 *   wall_0 .. wall_{n-1}
 * - the room's x/y extents are the bounding-box maxima
 *
 * Everything here is pure and unit-free: coordinates are whatever the room is
 * stored in (display units).
 */

export type Vertex = [number, number];
export type RoomShape = 'rectangle' | 'polygon';

/** The subset of RoomConfig these helpers need. */
export interface RoomOutline {
  x: number;
  y: number;
  shape?: RoomShape;
  vertices?: Vertex[];
}

export const CARDINAL_WALL_IDS: readonly string[] = ['south', 'east', 'north', 'west'];
export const FLOOR_CEILING_IDS: readonly string[] = ['floor', 'ceiling'];

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Outline access
// ---------------------------------------------------------------------------

/** True when the room is in polygon mode with a usable outline. */
export function isPolygonRoom(room: RoomOutline): boolean {
  return room.shape === 'polygon' && Array.isArray(room.vertices) && room.vertices.length >= 3;
}

/** Corners of an axis-aligned rectangle with origin (0, 0), CCW. */
export function rectangleVertices(x: number, y: number): Vertex[] {
  return [[0, 0], [x, 0], [x, y], [0, y]];
}

/** The room's floor outline (CCW). Rectangles are expanded to their 4 corners. */
export function roomVertices(room: RoomOutline): Vertex[] {
  if (isPolygonRoom(room)) return normalizeCCW(room.vertices!);
  return rectangleVertices(room.x, room.y);
}

// ---------------------------------------------------------------------------
// Basic measures
// ---------------------------------------------------------------------------

export function polygonSignedArea(vertices: Vertex[]): number {
  const n = vertices.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

export function polygonArea(vertices: Vertex[]): number {
  return Math.abs(polygonSignedArea(vertices));
}

/** Return the vertices in CCW order (reversed if they were CW). */
export function normalizeCCW(vertices: Vertex[]): Vertex[] {
  return polygonSignedArea(vertices) < 0 ? [...vertices].reverse() : [...vertices];
}

export function polygonBoundingBox(vertices: Vertex[]): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of vertices) {
    if (x < xMin) xMin = x;
    if (y < yMin) yMin = y;
    if (x > xMax) xMax = x;
    if (y > yMax) yMax = y;
  }
  return { xMin, yMin, xMax, yMax };
}

export function polygonCentroid(vertices: Vertex[]): Vertex {
  const n = vertices.length;
  const signed = polygonSignedArea(vertices);
  if (Math.abs(signed) < EPS) {
    // Degenerate: fall back to the vertex mean
    const sx = vertices.reduce((s, v) => s + v[0], 0);
    const sy = vertices.reduce((s, v) => s + v[1], 0);
    return [sx / n, sy / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const f = 1 / (6 * signed);
  return [cx * f, cy * f];
}

export function polygonEdgeLengths(vertices: Vertex[]): number[] {
  const n = vertices.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % n];
    out.push(Math.hypot(x1 - x0, y1 - y0));
  }
  return out;
}

export function edgeMidpoints(vertices: Vertex[]): Vertex[] {
  const n = vertices.length;
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % n];
    out.push([(x0 + x1) / 2, (y0 + y1) / 2]);
  }
  return out;
}

/** Unit normals pointing into the room for each edge (assumes CCW order). */
export function edgeInwardNormals(vertices: Vertex[]): Vertex[] {
  const n = vertices.length;
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = vertices[i];
    const [x1, y1] = vertices[(i + 1) % n];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    // For CCW winding the outward normal is (dy, -dx); inward is its negation.
    out.push([-dy / len, dx / len]);
  }
  return out;
}

/**
 * Unit direction pointing into the room at each vertex (the bisector of the
 * two inward edge normals; assumes CCW order). Used to offset lamps away from
 * a corner without leaving the room.
 */
export function vertexInwardDirections(vertices: Vertex[]): Vertex[] {
  const n = vertices.length;
  const normals = edgeInwardNormals(vertices);
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const prev = normals[(i - 1 + n) % n];
    const next = normals[i];
    let dx = prev[0] + next[0];
    let dy = prev[1] + next[1];
    let len = Math.hypot(dx, dy);
    if (len < EPS) {
      // Straight-through (collinear) vertex: use the edge normal itself
      dx = next[0]; dy = next[1]; len = 1;
    }
    out.push([dx / len, dy / len]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classification and naming
// ---------------------------------------------------------------------------

export function isAxisAlignedRectangle(vertices: Vertex[]): boolean {
  if (vertices.length !== 4) return false;
  const xs = new Set(vertices.map((v) => v[0]));
  const ys = new Set(vertices.map((v) => v[1]));
  return xs.size === 2 && ys.size === 2;
}

/** Wall ids in edge order, matching guv_calcs' RoomDimensions.faces. */
export function wallIdsFor(vertices: Vertex[]): string[] {
  if (isAxisAlignedRectangle(vertices)) return [...CARDINAL_WALL_IDS];
  return vertices.map((_, i) => `wall_${i}`);
}

/** All reflectance surface ids for a room: floor, ceiling, then walls in edge order. */
export function surfaceIdsFor(room: RoomOutline): string[] {
  return [...FLOOR_CEILING_IDS, ...wallIdsFor(roomVertices(room))];
}

/** Human label for a surface id ("Floor", "South", "Wall 3"). */
export function surfaceLabel(id: string): string {
  const m = /^wall_(\d+)$/.exec(id);
  if (m) return `Wall ${Number(m[1]) + 1}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Bounding-box extents (maxima) the room's x/y fields should carry. */
export function roomExtents(vertices: Vertex[]): { x: number; y: number } {
  const bb = polygonBoundingBox(vertices);
  return { x: bb.xMax, y: bb.yMax };
}

export function roomFloorArea(room: RoomOutline): number {
  return isPolygonRoom(room) ? polygonArea(room.vertices!) : room.x * room.y;
}

// ---------------------------------------------------------------------------
// Containment and distance
// ---------------------------------------------------------------------------

/** Ray-casting point-in-polygon (points on the boundary are not "inside"). */
export function pointInPolygon(vertices: Vertex[], x: number, y: number): boolean {
  const n = vertices.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on the outline to (px, py). */
export function nearestBoundaryPoint(vertices: Vertex[], px: number, py: number): Vertex {
  const n = vertices.length;
  let best: Vertex = [px, py];
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const qx = x1 + t * dx, qy = y1 + t * dy;
    const d = Math.hypot(px - qx, py - qy);
    if (d < bestDist) {
      bestDist = d;
      best = [qx, qy];
    }
  }
  return best;
}

export function distanceToBoundary(vertices: Vertex[], px: number, py: number): number {
  const [qx, qy] = nearestBoundaryPoint(vertices, px, py);
  return Math.hypot(px - qx, py - qy);
}

/** Point inside (or on) the outline, at least `margin` from every edge. */
export function isInsideWithMargin(vertices: Vertex[], x: number, y: number, margin: number): boolean {
  if (margin <= 0) return pointInPolygon(vertices, x, y) || distanceToBoundary(vertices, x, y) < EPS;
  return pointInPolygon(vertices, x, y) && distanceToBoundary(vertices, x, y) >= margin - EPS;
}

/**
 * First point where a ray from `origin` in direction `dir` leaves the outline.
 * Returns null when the ray never hits an edge (origin outside, or dir zero).
 */
export function rayToBoundary(vertices: Vertex[], origin: Vertex, dir: Vertex): Vertex | null {
  const n = vertices.length;
  const [ox, oy] = origin;
  const [dx, dy] = dir;
  if (Math.hypot(dx, dy) < EPS) return null;
  let bestT = Infinity;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    const ex = x2 - x1, ey = y2 - y1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < EPS) continue; // parallel
    const t = ((x1 - ox) * ey - (y1 - oy) * ex) / denom; // along the ray
    const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom; // along the edge
    if (t > 1e-6 && u >= -EPS && u <= 1 + EPS && t < bestT) bestT = t;
  }
  if (!isFinite(bestT)) return null;
  return [ox + dx * bestT, oy + dy * bestT];
}

// ---------------------------------------------------------------------------
// Validation (mirrors guv_calcs Polygon2D.__post_init__)
// ---------------------------------------------------------------------------

function ccw(a: Vertex, b: Vertex, c: Vertex): boolean {
  return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
}

/** Proper crossing of segments (p1,p2) and (p3,p4); touching endpoints don't count. */
export function segmentsIntersect(p1: Vertex, p2: Vertex, p3: Vertex, p4: Vertex): boolean {
  return ccw(p3, p4, p1) !== ccw(p3, p4, p2) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function isSimplePolygon(vertices: Vertex[]): boolean {
  const n = vertices.length;
  if (n < 4) return true;
  for (let i = 0; i < n; i++) {
    const p1 = vertices[i], p2 = vertices[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // closing edge is adjacent to edge 0
      const p3 = vertices[j], p4 = vertices[(j + 1) % n];
      if (segmentsIntersect(p1, p2, p3, p4)) return false;
    }
  }
  return true;
}

/**
 * Validate a floor-plan outline. Returns null when valid, otherwise a short
 * user-facing reason. Messages mirror the backend's so the two agree.
 */
export function validatePolygon(vertices: Vertex[]): string | null {
  if (!Array.isArray(vertices) || vertices.length < 3) return 'Polygon must have at least 3 vertices';
  for (const v of vertices) {
    if (!Array.isArray(v) || v.length !== 2) return 'Polygon vertices must be (x, y) pairs';
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return 'Polygon vertices must be finite numbers';
    if (v[0] < 0 || v[1] < 0) return 'Polygon vertex coordinates must be >= 0';
  }
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    if (Math.hypot(x2 - x1, y2 - y1) < EPS) {
      return `Vertices ${i + 1} and ${((i + 1) % n) + 1} coincide`;
    }
  }
  if (!isSimplePolygon(vertices)) return 'Polygon edges must not cross';
  if (polygonArea(vertices) < 1e-12) return 'Polygon must enclose a non-zero area';
  return null;
}
