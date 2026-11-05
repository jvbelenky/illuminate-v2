/**
 * Pure placement math for the floor-plan reference image. Everything here is
 * in METERS; callers convert to display units with `imageRect(p, k)`.
 *
 * Image pixel (0,0) is its top-left corner. The placement anchors the image's
 * BOTTOM-left corner at (offsetX, offsetY), so, unrotated,
 *   room = (offsetX + px * scale, offsetY + (heightPx - py) * scale).
 * A `rotation` (degrees, clockwise seen from above) then turns that rectangle
 * about its centre.
 */
import type { FloorPlanPlacement } from '$lib/types/project';

export const DEFAULT_FLOORPLAN_OPACITY = 0.6;

/** The unrotated rectangle's centre, metres. */
function centre(p: FloorPlanPlacement): [number, number] {
  return [p.offsetX + (p.widthPx * p.scale) / 2, p.offsetY + (p.heightPx * p.scale) / 2];
}

/** Turn (x, y) clockwise (seen from above, y up) by `deg` about `c`. */
function turnCw(x: number, y: number, deg: number, c: [number, number]): [number, number] {
  if (!deg) return [x, y];
  const r = (-deg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = x - c[0], dy = y - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

export function pixelToRoom(p: FloorPlanPlacement, px: number, py: number): [number, number] {
  return turnCw(p.offsetX + px * p.scale, p.offsetY + (p.heightPx - py) * p.scale, p.rotation ?? 0, centre(p));
}

export function roomToPixel(p: FloorPlanPlacement, x: number, y: number): [number, number] {
  const [ux, uy] = turnCw(x, y, -(p.rotation ?? 0), centre(p));
  return [(ux - p.offsetX) / p.scale, p.heightPx - (uy - p.offsetY) / p.scale];
}

/** The image's four corners in display units (metres times `k`), rotation applied. */
export function imageCorners(p: FloorPlanPlacement, k: number): [number, number][] {
  return ([[0, 0], [p.widthPx, 0], [p.widthPx, p.heightPx], [0, p.heightPx]] as [number, number][])
    .map(([px, py]) => pixelToRoom(p, px, py))
    .map(([x, y]) => [x * k, y * k] as [number, number]);
}

/** First guess after upload: long edge matches the room's long edge, image at the origin. */
export function initialPlacement(
  imageId: string, widthPx: number, heightPx: number, roomXMeters: number, roomYMeters: number,
): FloorPlanPlacement {
  const longRoom = Math.max(roomXMeters, roomYMeters, 1e-6);
  const longImage = Math.max(widthPx, heightPx, 1);
  return {
    imageId, widthPx, heightPx,
    scale: longRoom / longImage,
    offsetX: 0, offsetY: 0,
    opacity: DEFAULT_FLOORPLAN_OPACITY,
  };
}

/** Change the scale while keeping `anchorMeters` on the same image pixel. */
export function rescaleAboutPoint(
  p: FloorPlanPlacement, anchorMeters: [number, number], newScale: number,
): FloorPlanPlacement {
  const r = newScale / p.scale;
  return {
    ...p,
    scale: newScale,
    offsetX: anchorMeters[0] - (anchorMeters[0] - p.offsetX) * r,
    offsetY: anchorMeters[1] - (anchorMeters[1] - p.offsetY) * r,
  };
}

/**
 * Meters per pixel implied by two room points that are `distanceMeters` apart
 * on the drawing. Null when the points coincide or the distance is not positive.
 */
export function scaleFromMeasurement(
  p: FloorPlanPlacement, aMeters: [number, number], bMeters: [number, number], distanceMeters: number,
): number | null {
  if (!(distanceMeters > 0)) return null;
  const [ax, ay] = roomToPixel(p, aMeters[0], aMeters[1]);
  const [bx, by] = roomToPixel(p, bMeters[0], bMeters[1]);
  const pixels = Math.hypot(bx - ax, by - ay);
  if (pixels < 1e-9) return null;
  return distanceMeters / pixels;
}

/** The image's rectangle in display units (multiply meters by `k`), bottom-left origin. */
export function imageRect(p: FloorPlanPlacement, k: number): { x: number; y: number; width: number; height: number } {
  return { x: p.offsetX * k, y: p.offsetY * k, width: p.widthPx * p.scale * k, height: p.heightPx * p.scale * k };
}
