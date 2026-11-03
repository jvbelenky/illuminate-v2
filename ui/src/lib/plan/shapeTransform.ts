import type { Vertex } from '$lib/utils/roomGeometry';

// PowerPoint-style transforms of a shape on the plan (a structure's footprint,
// a zone's outline, a ceiling keep-out area): its box in its own frame (turned
// by its yaw), resizing from one of eight handles about the opposite one, and
// rotating about the box's centre. Pure geometry in room units, y up, yaw in
// degrees counter-clockwise; the canvas turns its pixel sizes into room units
// before calling.

/** A handle's side of the box along the shape's own x and y: -1 low, 0 middle, 1 high (y up: 1 is the top). */
export type Side = -1 | 0 | 1;
export interface Handle {
  sx: Side;
  sy: Side;
}

/** The eight resize handles, clockwise from the top-left corner (the top is +y). */
export const HANDLES: readonly Handle[] = [
  { sx: -1, sy: 1 },
  { sx: 0, sy: 1 },
  { sx: 1, sy: 1 },
  { sx: 1, sy: 0 },
  { sx: 1, sy: -1 },
  { sx: 0, sy: -1 },
  { sx: -1, sy: -1 },
  { sx: -1, sy: 0 },
];

/** Rotation snaps to multiples of this many degrees ... */
export const ROTATE_STEP = 15;
/** ... when within this many degrees of one (Alt rotates freely). */
export const ROTATE_TOLERANCE = 4;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Turn a point about the origin by `deg` degrees counter-clockwise. */
function turn([x, y]: Vertex, deg: number): Vertex {
  if (deg === 0) return [x, y];
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

/** A world point in the shape's own frame (unturned by its yaw, about the origin). */
export function toLocal(p: Vertex, yaw: number): Vertex {
  return turn(p, -yaw);
}

/** A point of the shape's own frame back in the world. */
export function toWorld(p: Vertex, yaw: number): Vertex {
  return turn(p, yaw);
}

/** The shape's box in its own frame: the bounds of its corners there, and the box's centre in the world. */
export interface ShapeBox {
  /** Lower-left and upper-right corners in the shape's own frame. */
  min: Vertex;
  max: Vertex;
  yaw: number;
  /** The box's centre, in the world. */
  centre: Vertex;
  width: number;
  height: number;
}

function bounds(points: Vertex[]): { min: Vertex; max: Vertex } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

export function shapeBox(vertices: Vertex[], yaw: number): ShapeBox {
  const { min, max } = bounds(vertices.map((v) => toLocal(v, yaw)));
  return { min, max, yaw, centre: toWorld([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], yaw), width: max[0] - min[0], height: max[1] - min[1] };
}

/** The box's four corners in the world, counter-clockwise from its own lower-left. */
export function boxCorners(box: ShapeBox): Vertex[] {
  const { min, max, yaw } = box;
  return ([[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]] as Vertex[]).map((p) => toWorld(p, yaw));
}

/** Where a handle sits, in the world. */
export function handlePoint(box: ShapeBox, h: Handle): Vertex {
  const x = h.sx < 0 ? box.min[0] : h.sx > 0 ? box.max[0] : (box.min[0] + box.max[0]) / 2;
  const y = h.sy < 0 ? box.min[1] : h.sy > 0 ? box.max[1] : (box.min[1] + box.max[1]) / 2;
  return toWorld([x, y], box.yaw);
}

/** The rotate handle: on a stem `stem` long above the middle of the top edge, in the world. */
export function rotateHandlePoint(box: ShapeBox, stem: number): Vertex {
  return toWorld([(box.min[0] + box.max[0]) / 2, box.max[1] + stem], box.yaw);
}

/** The direction (degrees, counter-clockwise from +x) a handle points out of the box, in the world. */
export function handleAngle(h: Handle, yaw: number): number {
  return (Math.atan2(h.sy, h.sx) * 180) / Math.PI + yaw;
}

/**
 * The world axis a local axis lies along, and which way, when the shape's yaw
 * is a multiple of 90° (null otherwise: its edges run at a slant and do not
 * snap to the grid or the walls).
 */
export function localAxisToWorld(yaw: number, axis: 0 | 1): { axis: 0 | 1; sign: 1 | -1 } | null {
  const a = (yaw * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  // Local x runs along (c, s) in the world, local y along (-s, c)
  const [dx, dy] = axis === 0 ? [c, s] : [-s, c];
  if (Math.abs(Math.abs(dx) - 1) < 1e-9) return { axis: 0, sign: dx > 0 ? 1 : -1 };
  if (Math.abs(Math.abs(dy) - 1) < 1e-9) return { axis: 1, sign: dy > 0 ? 1 : -1 };
  return null;
}

export interface ResizeOptions {
  /** Shift on a corner handle: both sides scale by the same factor. */
  keepRatio?: boolean;
  /** The smallest width and height (room units); also stops the box turning inside out. */
  minSize?: number;
  /** Snap the moving edge: its coordinate along a local axis (the shape's own frame) in, the snapped one out. */
  snap?: (axis: 0 | 1, value: number) => number;
}

/**
 * Drag a handle to `pointer`: the shape scales along its own sides about the
 * opposite handle (which stays put), with the moving edge under the pointer.
 */
export function resizeByHandle(vertices: Vertex[], yaw: number, h: Handle, pointer: Vertex, opts: ResizeOptions = {}): Vertex[] {
  const local = vertices.map((v) => toLocal(v, yaw));
  const { min, max } = bounds(local);
  const p = toLocal(pointer, yaw);
  const minSize = Math.max(opts.minSize ?? 0, 1e-9);
  const anchor: Vertex = [h.sx > 0 ? min[0] : max[0], h.sy > 0 ? min[1] : max[1]];
  const factor = (axis: 0 | 1, side: Side): number => {
    const from = side > 0 ? max[axis] : min[axis];
    const span = from - anchor[axis];
    if (side === 0 || Math.abs(span) < 1e-12) return 1;
    const to = opts.snap ? opts.snap(axis, p[axis]) : p[axis];
    // Never thinner than minSize, and never past the anchor (no turning inside out)
    return Math.max((to - anchor[axis]) / span, minSize / Math.abs(span));
  };
  let fx = factor(0, h.sx);
  let fy = factor(1, h.sy);
  if (opts.keepRatio && h.sx !== 0 && h.sy !== 0) fx = fy = Math.max(fx, fy);
  return local.map(([x, y]) => {
    const q: Vertex = [anchor[0] + (x - anchor[0]) * fx, anchor[1] + (y - anchor[1]) * fy];
    const [wx, wy] = toWorld([h.sx === 0 ? x : q[0], h.sy === 0 ? y : q[1]], yaw);
    return [r6(wx), r6(wy)] as Vertex;
  });
}

/** An angle in degrees within (-180, 180]. */
export function normalizeYaw(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return r6(a);
}

/** How far (degrees, counter-clockwise) the pointer has turned about `centre` since `start`. */
export function dragAngle(centre: Vertex, start: Vertex, pointer: Vertex): number {
  const a0 = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
  const a1 = Math.atan2(pointer[1] - centre[1], pointer[0] - centre[0]);
  return ((a1 - a0) * 180) / Math.PI;
}

/** A yaw pulled onto the nearest 15° step when within the tolerance (`free`: as is), within (-180, 180]. */
export function snapRotation(yaw: number, free = false): number {
  if (!free) {
    const step = Math.round(yaw / ROTATE_STEP) * ROTATE_STEP;
    if (Math.abs(yaw - step) <= ROTATE_TOLERANCE) return normalizeYaw(step);
  }
  return normalizeYaw(Math.round(yaw * 10) / 10);
}

/** Turn points about `centre` by `deg` degrees counter-clockwise. */
export function rotateAbout(vertices: Vertex[], centre: Vertex, deg: number): Vertex[] {
  return vertices.map(([x, y]) => {
    const [dx, dy] = turn([x - centre[0], y - centre[1]], deg);
    return [r6(centre[0] + dx), r6(centre[1] + dy)] as Vertex;
  });
}

/** The rotate handle dragged from `start` to `pointer`: the shape turned about its box's centre, and its new yaw. */
export function rotateByDrag(
  vertices: Vertex[],
  yaw: number,
  start: Vertex,
  pointer: Vertex,
  free = false,
): { vertices: Vertex[]; yaw: number } {
  const { centre } = shapeBox(vertices, yaw);
  const next = snapRotation(yaw + dragAngle(centre, start, pointer), free);
  let delta = next - yaw;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return { vertices: rotateAbout(vertices, centre, delta), yaw: next };
}

/** Turn the shape a further `deg` degrees about its box's centre. */
export function rotateShapeBy(vertices: Vertex[], yaw: number, deg: number): { vertices: Vertex[]; yaw: number } {
  const { centre } = shapeBox(vertices, yaw);
  return { vertices: rotateAbout(vertices, centre, deg), yaw: normalizeYaw(yaw + deg) };
}

/**
 * Snap a moving edge, a line where world coordinate `axis` is `value` running
 * from `lo` to `hi` along the other axis, onto a room wall along the same line
 * within `tol`: the wall's coordinate and its index, or null.
 */
export function snapLineToOutline(
  axis: 0 | 1,
  value: number,
  lo: number,
  hi: number,
  outline: Vertex[] | undefined,
  tol: number,
): { value: number; edge: number } | null {
  if (!outline || outline.length < 3 || !(tol > 0)) return null;
  const other = axis === 0 ? 1 : 0;
  let best: { value: number; edge: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if (Math.abs(a[axis] - b[axis]) > 1e-9) continue;
    const eLo = Math.min(a[other], b[other]), eHi = Math.max(a[other], b[other]);
    if (eHi < lo - tol || eLo > hi + tol) continue;
    const d = Math.abs(a[axis] - value);
    if (d <= tol && d < bestD) {
      bestD = d;
      best = { value: a[axis], edge: i };
    }
  }
  return best;
}

/** A footprint's shape in words: a rectangle in its own frame, or a polygon with its corner count. */
export function shapeKind(vertices: Vertex[], yaw: number): string {
  if (vertices.length === 4) {
    const local = vertices.map((v) => toLocal(v, yaw));
    const { min, max } = bounds(local);
    const span = Math.max(1, max[0] - min[0], max[1] - min[1]);
    const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * span;
    const onCorner = local.every(([x, y]) => (near(x, min[0]) || near(x, max[0])) && (near(y, min[1]) || near(y, max[1])));
    const distinct = new Set(local.map(([x, y]) => `${near(x, min[0]) ? 0 : 1}${near(y, min[1]) ? 0 : 1}`));
    if (onCorner && distinct.size === 4) return 'Rectangle';
  }
  return `Polygon, ${vertices.length} corners`;
}
