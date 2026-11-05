/**
 * Geometry of the floor plan import window. Points are stored in IMAGE pixels
 * (top-left origin, y down), so rotating the image never moves them on the
 * drawing. The ALIGNED frame is the image turned by `rotation` degrees
 * clockwise on screen about its centre: where the walls follow the axes and
 * where origin, scale and outline are shown.
 *
 * Room coordinates are metres from the chosen origin, x right and y UP in the
 * aligned frame. The placement this produces (`placementFromFrame`) gives the
 * same mapping through `pixelToRoom` in `$lib/utils/floorplanImage`.
 */
import type { FloorPlanPlacement } from '$lib/types/project';

export type Pt = [number, number];

export interface ImportFrame {
  widthPx: number;
  heightPx: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  /** Image pixel of room (0, 0), or null before step 2. */
  origin: Pt | null;
  /** Image pixels per metre, or null before step 3. */
  pxPerM: number | null;
}

/** An angle in (-180, 180]. */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d === 0 ? 0 : d;
}

/** Turn `p` by `deg` clockwise on screen (y down) about `c`. */
export function rotateAbout(p: Pt, deg: number, c: Pt): Pt {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

export function imageCentre(f: Pick<ImportFrame, 'widthPx' | 'heightPx'>): Pt {
  return [f.widthPx / 2, f.heightPx / 2];
}

/** Image pixel -> aligned frame. */
export function toAligned(f: ImportFrame, p: Pt): Pt {
  return rotateAbout(p, f.rotation, imageCentre(f));
}

/** Aligned frame -> image pixel. */
export function fromAligned(f: ImportFrame, q: Pt): Pt {
  return rotateAbout(q, -f.rotation, imageCentre(f));
}

/** The rotated image's bounding box in the aligned frame. */
export function alignedBounds(f: ImportFrame): { x: number; y: number; width: number; height: number } {
  const pts: Pt[] = [[0, 0], [f.widthPx, 0], [f.widthPx, f.heightPx], [0, f.heightPx]].map((p) => toAligned(f, p as Pt));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Straighten: the rotation, nearest `current`, that makes the line through image
 * pixels `a` and `b` horizontal or vertical (the smallest turn, at most 45°).
 */
export function straightenRotation(a: Pt, b: Pt, current: number): number {
  const g = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  let c = -(g + current);
  c = ((c % 90) + 90) % 90;
  if (c > 45) c -= 90;
  return normalizeDeg(current + c);
}

/** Free rotation snaps to a quarter turn within `tol` degrees. */
export function snapRotation(deg: number, tol = 1.5): number {
  const q = Math.round(deg / 90) * 90;
  return Math.abs(deg - q) < tol ? normalizeDeg(q) : normalizeDeg(deg);
}

/** Image pixels per metre from two points `distanceM` metres apart; null when degenerate. */
export function pxPerMeter(a: Pt, b: Pt, distanceM: number): number | null {
  if (!(distanceM > 0)) return null;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return d > 1e-9 ? d / distanceM : null;
}

/** Image pixel -> room metres (needs origin and scale). */
export function pixelToMeters(f: ImportFrame, p: Pt): Pt {
  if (!f.origin || !f.pxPerM) throw new Error('origin and scale are needed');
  const a = toAligned(f, p), o = toAligned(f, f.origin);
  return [(a[0] - o[0]) / f.pxPerM, (o[1] - a[1]) / f.pxPerM];
}

/** Room metres -> image pixel (needs origin and scale). */
export function metersToPixel(f: ImportFrame, m: Pt): Pt {
  if (!f.origin || !f.pxPerM) throw new Error('origin and scale are needed');
  const o = toAligned(f, f.origin);
  return fromAligned(f, [o[0] + m[0] * f.pxPerM, o[1] - m[1] * f.pxPerM]);
}

/** The image placement (metres, rotation about the image centre) that the frame implies. */
export function placementFromFrame(f: ImportFrame, imageId: string, opacity: number): FloorPlanPlacement {
  if (!f.origin || !f.pxPerM) throw new Error('origin and scale are needed');
  const s = 1 / f.pxPerM;
  const o = toAligned(f, f.origin);
  return {
    imageId,
    widthPx: f.widthPx,
    heightPx: f.heightPx,
    scale: s,
    offsetX: -s * o[0],
    offsetY: s * (o[1] - f.heightPx),
    opacity,
    ...(f.rotation ? { rotation: normalizeDeg(f.rotation) } : {}),
  };
}

/** The frame a placement came from (to reopen the window on an existing image). */
export function frameFromPlacement(p: FloorPlanPlacement): ImportFrame {
  const rotation = p.rotation ?? 0;
  const base: ImportFrame = { widthPx: p.widthPx, heightPx: p.heightPx, rotation, origin: null, pxPerM: 1 / p.scale };
  const aligned: Pt = [-p.offsetX / p.scale, p.heightPx + p.offsetY / p.scale];
  return { ...base, origin: fromAligned(base, aligned) };
}
