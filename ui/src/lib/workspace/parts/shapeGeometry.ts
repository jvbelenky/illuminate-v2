/**
 * A footprint polygon seen in its own frame: unrotated by its yaw, so Width and
 * Length run along the shape's own sides. The reference point (one of its
 * own bounding-box corners, or its middle) is what X/Y show and what a Width
 * or Length change keeps fixed. "Bottom-left" is the corner at the smallest
 * x and y, which the plan view (y up) shows bottom-left at yaw 0. Shared by ShapeGeometryFields (keep-out areas,
 * structures).
 */
import { polygonBoundingBox, type Vertex } from '$lib/utils/roomGeometry';

export type ReferenceMode = 'centre' | 'corner-bl' | 'corner-br' | 'corner-tl' | 'corner-tr';

/** The five points in picker order, each with its name. */
export const REFERENCE_MODES: { mode: ReferenceMode; label: string }[] = [
  { mode: 'corner-tl', label: 'Top-left corner' },
  { mode: 'corner-tr', label: 'Top-right corner' },
  { mode: 'centre', label: 'Centre' },
  { mode: 'corner-bl', label: 'Bottom-left corner' },
  { mode: 'corner-br', label: 'Bottom-right corner' },
];

/** A mode as stored or passed: the old 'corner' means the bottom-left one; anything unknown is the centre. */
export function normaliseReference(mode: ReferenceMode | 'corner' | string | null | undefined): ReferenceMode {
  if (mode === 'corner') return 'corner-bl';
  return REFERENCE_MODES.some((r) => r.mode === mode) ? (mode as ReferenceMode) : 'centre';
}

/** A mode, or the old 'corner' alias. */
type ReferenceInput = ReferenceMode | 'corner';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function rotate(points: Vertex[], c: Vertex, deg: number): Vertex[] {
  if (deg === 0) return points.map(([x, y]) => [x, y] as Vertex);
  const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return points.map(([x, y]) => [c[0] + (x - c[0]) * co - (y - c[1]) * si, c[1] + (x - c[0]) * si + (y - c[1]) * co] as Vertex);
}

/** The shape unrotated about its bounding box's middle (the pivot), and the bounds there. */
function frame(vertices: Vertex[], yaw: number) {
  const bb = polygonBoundingBox(vertices);
  const pivot: Vertex = [(bb.xMin + bb.xMax) / 2, (bb.yMin + bb.yMax) / 2];
  const local = rotate(vertices, pivot, -yaw);
  return { pivot, local, b: polygonBoundingBox(local) };
}

function localReference(b: ReturnType<typeof polygonBoundingBox>, mode: ReferenceInput): Vertex {
  switch (normaliseReference(mode)) {
    case 'corner-bl': return [b.xMin, b.yMin];
    case 'corner-br': return [b.xMax, b.yMin];
    case 'corner-tl': return [b.xMin, b.yMax];
    case 'corner-tr': return [b.xMax, b.yMax];
    default: return [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2];
  }
}

const round = (vs: Vertex[]) => vs.map(([x, y]) => [r6(x), r6(y)] as Vertex);

/** Where X/Y point: one of the shape's own corners, or its middle. */
export function referencePoint(vertices: Vertex[], yaw: number, mode: ReferenceInput): Vertex {
  const { pivot, b } = frame(vertices, yaw);
  const [p] = rotate([localReference(b, mode)], pivot, yaw);
  return [r6(p[0]), r6(p[1])];
}

/** Width (along its own x) and length (along its own y). */
export function shapeSize(vertices: Vertex[], yaw: number): { width: number; length: number } {
  const { b } = frame(vertices, yaw);
  return { width: r6(b.xMax - b.xMin), length: r6(b.yMax - b.yMin) };
}

/** Move the shape so its reference point's x or y is `value`. */
export function moveReference(vertices: Vertex[], yaw: number, mode: ReferenceInput, axis: 0 | 1, value: number): Vertex[] {
  const d = value - referencePoint(vertices, yaw, mode)[axis];
  return round(vertices.map((v) => (axis === 0 ? [v[0] + d, v[1]] : [v[0], v[1] + d]) as Vertex));
}

/** Stretch the shape along its own sides to a width or length, keeping the reference point fixed. */
export function resizeShape(vertices: Vertex[], yaw: number, mode: ReferenceInput, which: 'width' | 'length', value: number): Vertex[] {
  const { pivot, local, b } = frame(vertices, yaw);
  const span = which === 'width' ? b.xMax - b.xMin : b.yMax - b.yMin;
  if (!(span > 0) || !(value > 0)) return vertices;
  const k = value / span;
  const [fx, fy] = localReference(b, mode);
  const scaled = local.map(([x, y]) => (which === 'width' ? [fx + (x - fx) * k, y] : [x, fy + (y - fy) * k]) as Vertex);
  return round(rotate(scaled, pivot, yaw));
}

/** Turn the shape about its middle to a new yaw (degrees). */
export function rotateShape(vertices: Vertex[], yaw: number, nextYaw: number): Vertex[] {
  const c = referencePoint(vertices, yaw, 'centre');
  return round(rotate(vertices, c, nextYaw - yaw));
}
