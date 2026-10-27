/**
 * Calc zone footprints on the floor plan.
 *
 * Horizontal planes and volumes cover an area of the floor plan: a plain
 * rectangle (x1..x2 × y1..y2, or x_min..x_max × y_min..y_max), or a drawn
 * polygon (`vertices`, world x/y, display units) with the bounds as its
 * bounding box. A "whole room" zone (`fit_room`) covers the room outline and
 * follows it when the outline changes.
 */
import type { CalcZone, RoomConfig } from '$lib/types/project';
import { isPolygonRoom, roomVertices, polygonBoundingBox, normalizeCCW, type Vertex } from '$lib/utils/roomGeometry';

const EPS = 1e-9;

/** Planes lying flat (xy) and volumes have a floor-plan footprint; points and wall planes do not. */
export function zoneHasFootprint(zone: Pick<CalcZone, 'type' | 'ref_surface'> & { surface?: string }): boolean {
  if (zone.type === 'volume') return true;
  if (zone.surface?.startsWith('wall:')) return false;
  return zone.type === 'plane' && (zone.ref_surface ?? 'xy') === 'xy';
}

export function rectangleCorners(xMin: number, xMax: number, yMin: number, yMax: number): Vertex[] {
  return [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]];
}

/** Four corners on the axes: a rectangle the bounds alone describe. */
export function isAxisRectangle(vs: Vertex[]): boolean {
  if (vs.length !== 4) return false;
  const bb = polygonBoundingBox(vs);
  return vs.every(([x, y]) =>
    (Math.abs(x - bb.xMin) < EPS || Math.abs(x - bb.xMax) < EPS)
    && (Math.abs(y - bb.yMin) < EPS || Math.abs(y - bb.yMax) < EPS))
    && bb.xMax - bb.xMin > EPS && bb.yMax - bb.yMin > EPS;
}

/** A zone's footprint as world corners (its drawn outline, or its bounds as a rectangle). */
export function zoneFootprint(zone: CalcZone): Vertex[] {
  if (zone.vertices && zone.vertices.length >= 3) return zone.vertices.map(([x, y]) => [x, y] as Vertex);
  if (zone.type === 'volume') {
    return rectangleCorners(zone.x_min ?? 0, zone.x_max ?? 0, zone.y_min ?? 0, zone.y_max ?? 0);
  }
  const x1 = Math.min(zone.x1 ?? 0, zone.x2 ?? 0), x2 = Math.max(zone.x1 ?? 0, zone.x2 ?? 0);
  const y1 = Math.min(zone.y1 ?? 0, zone.y2 ?? 0), y2 = Math.max(zone.y1 ?? 0, zone.y2 ?? 0);
  return rectangleCorners(x1, x2, y1, y2);
}

/**
 * The zone fields for a footprint: the bounds always, plus the outline unless
 * it is a plain axis rectangle. `vertices` is always present in the result
 * (undefined for a rectangle) so an update clears an old outline.
 */
export function footprintGeometry(type: 'plane' | 'volume', corners: Vertex[]): Partial<CalcZone> {
  const bb = polygonBoundingBox(corners);
  const vertices = isAxisRectangle(corners) ? undefined : normalizeCCW(corners).map(([x, y]) => [x, y] as [number, number]);
  if (type === 'volume') {
    return { x_min: bb.xMin, x_max: bb.xMax, y_min: bb.yMin, y_max: bb.yMax, vertices };
  }
  return { x1: bb.xMin, x2: bb.xMax, y1: bb.yMin, y2: bb.yMax, vertices };
}

/** The footprint that fills the room outline. */
export function roomFootprint(room: Pick<RoomConfig, 'x' | 'y' | 'shape' | 'vertices'>): Vertex[] {
  return isPolygonRoom(room as RoomConfig) ? roomVertices(room as RoomConfig) : rectangleCorners(0, room.x, 0, room.y);
}

function samePolygon(a: Vertex[], b: Vertex[]): boolean {
  const n = a.length;
  if (n !== b.length || n === 0) return false;
  const close = (p: Vertex, q: Vertex) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  for (let start = 0; start < n; start++) {
    for (const dir of [1, -1]) {
      if (a.every((p, i) => close(p, b[(((start + dir * i) % n) + n) % n]))) return true;
    }
  }
  return false;
}

/** True when the zone's footprint is exactly the room outline. */
export function fillsRoom(zone: CalcZone, room: Pick<RoomConfig, 'x' | 'y' | 'shape' | 'vertices'>): boolean {
  return zoneHasFootprint(zone) && samePolygon(zoneFootprint(zone), roomFootprint(room));
}

/** Zone fields that make a plane or volume fill the room outline. */
export function roomFillGeometry(type: 'plane' | 'volume', room: Pick<RoomConfig, 'x' | 'y' | 'shape' | 'vertices'>): Partial<CalcZone> {
  return footprintGeometry(type, roomFootprint(room));
}

/** A volume spanning floor to ceiling (its range follows the room height). */
export function isFloorToCeilingVolume(zone: CalcZone, roomZ: number): boolean {
  return zone.type === 'volume'
    && Math.abs(Math.min(zone.z_min ?? 0, zone.z_max ?? 0)) < 1e-6
    && Math.abs(Math.max(zone.z_min ?? 0, zone.z_max ?? 0) - roomZ) < 1e-6;
}
