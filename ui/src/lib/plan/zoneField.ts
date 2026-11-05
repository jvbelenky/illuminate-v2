/**
 * Calculation planes and volumes on the 2D view, as the 3D view draws them:
 * their grid points as markers, or their results as a heatmap, contours or
 * numbers (CalcPlane3D / CalcVol3D are the reference).
 *
 * Everything here is in the plan canvas's coordinates (display units, y up):
 * world x, y on the plan view; (length - along, up) on a wall view, as
 * `wallToCanvas` draws it. A zone's points are a (u, v) grid in its own plane:
 * x, y for a floor or ceiling plane and for a volume (its x-y grid once, not
 * every z layer), along and up for a wall plane.
 */
import type { CalcZone, RoomConfig, ZoneDisplayMode, ZoneResult } from '$lib/types/project';
import { isPolygonRoom, roomVertices, pointInPolygon, type Vertex } from '$lib/utils/roomGeometry';
import { planeFrame } from '$lib/utils/planeWorld';
import { zoneFootprint, roomFootprint, zoneHasFootprint } from '$lib/utils/zoneFootprint';
import { planSurface, wallIndex, zoneSurface, zoneWallIndex, type Surface } from '$lib/utils/surfaces';
import { dimensionsMatch } from '$lib/utils/zoneSnapshot';
import { MAX_NUMERIC_VOLUME_POINTS } from '$lib/utils/calculations';
import { valueToColor } from '$lib/utils/colormaps';
import { zoneDisplayMode } from '$lib/workspace/zones/zoneFields';
import { sampleGrid, type PlaneGrid } from '$lib/utils/planePlot';

/** A zone's points laid out on the 2D view. */
export interface FieldGrid {
  /** Points along u and v. */
  nU: number;
  nV: number;
  /** The plane's (u, v) extent the points spread over. */
  u1: number;
  u2: number;
  v1: number;
  v2: number;
  /** Points inset half a step from the boundary (Inset), or on it (On edge). */
  offset: boolean;
  /** Canvas x runs against u (a wall seen from inside): x = `length` - u. */
  mirrorU: boolean;
  length: number;
  /** The outline (u, v) the computed points lie inside; null for the whole rectangle. */
  mask: Vertex[] | null;
  /** The zone's outline on the canvas: the heatmap is clipped to it. */
  clip: Vertex[];
  /** The values run toward +v (`planeGrid`'s flipV). */
  valuesUp: boolean;
}

/** The plan canvas point for plane coordinates (u, v). */
export function gridToCanvas(g: Pick<FieldGrid, 'mirrorU' | 'length'>, u: number, v: number): Vertex {
  return [g.mirrorU ? g.length - u : u, v];
}

/** Where the points fall along one axis: half a step in from each end (Inset), or from end to end (On edge). */
export function axisPoints(n: number, a1: number, a2: number, offset: boolean): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(a1 + a2) / 2];
  return Array.from({ length: n }, (_, i) => (offset ? a1 + ((i + 0.5) / n) * (a2 - a1) : a1 + (i / (n - 1)) * (a2 - a1)));
}

/** The distance between neighbouring points along an axis. */
export function axisStep(n: number, a1: number, a2: number, offset: boolean): number {
  const span = Math.abs(a2 - a1);
  if (n <= 1) return span;
  return offset ? span / n : span / (n - 1);
}

function count(n: number | undefined, span: number, spacing: number | undefined): number {
  if (n && n > 0) return n;
  const s = spacing && spacing > 0 ? spacing : 0.5;
  return Math.max(2, Math.ceil(Math.abs(span) / s) + 1);
}

function rect(u1: number, u2: number, v1: number, v2: number): Vertex[] {
  return [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
}

/**
 * Whether a horizontal plane's values run toward +v, as CalcPlane3D reads
 * them: by the backend's `v_positive_direction` when it has one, else by the
 * plane's direction. A wall plane's run down from its top edge, or up from the
 * bottom one when flipped.
 */
export function planeValuesUp(zone: CalcZone, onWall: boolean): boolean {
  if (onWall) return !!zone.flip;
  if (zone.v_positive_direction != null) return !!zone.v_positive_direction;
  return (zone.direction ?? 1) >= 0;
}

/**
 * The zone's grid on the 2D view: a floor or ceiling plane or a volume on the
 * plan view, a wall plane on its wall's view. Null for points and for a
 * legacy vertical plane off the walls (the 2D view has nowhere to show it).
 */
export function fieldGrid(zone: CalcZone, room: RoomConfig): FieldGrid | null {
  const offset = zone.offset !== false;
  if (zone.type === 'volume') {
    let x1 = zone.x_min ?? 0, x2 = zone.x_max ?? room.x, y1 = zone.y_min ?? 0, y2 = zone.y_max ?? room.y;
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 > y2) [y1, y2] = [y2, y1];
    // A drawn volume, or a standard one in a polygon room, follows its outline (as the backend masks it)
    const drawn = (zone.vertices?.length ?? 0) >= 3;
    const mask = drawn ? zoneFootprint(zone) : isPolygonRoom(room) && zone.isStandard ? roomVertices(room) : null;
    const clip = drawn ? zoneFootprint(zone) : zone.x_min == null && zone.fit_room ? roomFootprint(room) : mask ?? rect(x1, x2, y1, y2);
    return {
      nU: count(zone.num_x, x2 - x1, zone.x_spacing), nV: count(zone.num_y, y2 - y1, zone.y_spacing),
      u1: x1, u2: x2, v1: y1, v2: y2, offset, mirrorU: false, length: 0, mask, clip,
      // values[ix][iy][iz]: y ascending
      valuesUp: true,
    };
  }
  if (zone.type !== 'plane') return null;
  const fr = planeFrame(zone, room);
  if (!fr) return null;
  const nU = count(zone.num_x, fr.u2 - fr.u1, zone.x_spacing);
  const nV = count(zone.num_y, fr.v2 - fr.v1, zone.y_spacing);
  if (fr.wall) {
    const g = { mirrorU: true, length: fr.wall.length };
    const outline = fr.outline ?? rect(fr.u1, fr.u2, fr.v1, fr.v2);
    return {
      nU, nV, u1: fr.u1, u2: fr.u2, v1: fr.v1, v2: fr.v2, offset, ...g,
      mask: fr.outline, clip: outline.map(([u, v]) => gridToCanvas(g, u, v)), valuesUp: planeValuesUp(zone, true),
    };
  }
  if (!zoneHasFootprint(zone)) return null;
  // Standard planes in a polygon room are masked to the floor outline; a drawn plane to its own
  const drawn = (zone.vertices?.length ?? 0) >= 3;
  const mask = drawn ? fr.outline : isPolygonRoom(room) && zone.isStandard ? roomVertices(room) : null;
  return {
    nU, nV, u1: fr.u1, u2: fr.u2, v1: fr.v1, v2: fr.v2, offset, mirrorU: false, length: 0,
    mask, clip: fr.outline ?? mask ?? rect(fr.u1, fr.u2, fr.v1, fr.v2), valuesUp: planeValuesUp(zone, false),
  };
}

/** The smaller distance between neighbouring points. */
export function gridSpacing(g: FieldGrid): number {
  return Math.min(axisStep(g.nU, g.u1, g.u2, g.offset), axisStep(g.nV, g.v1, g.v2, g.offset));
}

/**
 * The grid's points on the canvas, leaving out those outside its mask. With
 * `step` > 1 only every step-th point along each axis (thinned for the screen).
 */
export function gridPoints(g: FieldGrid, step = 1): Vertex[] {
  const us = axisPoints(g.nU, g.u1, g.u2, g.offset);
  const vs = axisPoints(g.nV, g.v1, g.v2, g.offset);
  const k = Math.max(1, Math.floor(step));
  // Centre the kept points in a thinned grid
  const iu = Math.floor(((g.nU - 1) % k) / 2), iv = Math.floor(((g.nV - 1) % k) / 2);
  const out: Vertex[] = [];
  for (let i = iu; i < us.length; i += k) {
    for (let j = iv; j < vs.length; j += k) {
      if (g.mask && !pointInPolygon(g.mask, us[i], vs[j])) continue;
      out.push(gridToCanvas(g, us[i], vs[j]));
    }
  }
  return out;
}

/** Markers never sit closer than this on screen: a denser grid is thinned. */
export const MARKER_MIN_GAP_PX = 7;
/** The largest and smallest marker radius on screen. */
export const MARKER_MAX_R_PX = 3;
export const MARKER_MIN_R_PX = 1.2;

/** How many points along each axis one marker stands for, so markers stay `MARKER_MIN_GAP_PX` apart on screen. */
export function markerStep(spacing: number, px: number): number {
  if (!(spacing > 0) || !(px > 0)) return 1;
  const gapPx = spacing / px;
  return gapPx >= MARKER_MIN_GAP_PX ? 1 : Math.ceil(MARKER_MIN_GAP_PX / gapPx);
}

/** A marker's radius (canvas units): 30% of the spacing as in 3D, kept between 1.2 and 3 screen pixels. */
export function markerRadius(spacing: number, px: number): number {
  return Math.min(MARKER_MAX_R_PX * px, Math.max(MARKER_MIN_R_PX * px, 0.3 * spacing));
}

/** One SVG path for every marker: a zero-length stroke at each point, drawn as a dot by round caps. */
export function markerPath(points: Vertex[]): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  let d = '';
  for (const [x, y] of points) d += `M${r(x)} ${r(-y)}h0`;
  return d;
}

/**
 * The rectangle (canvas units) a one-pixel-per-point image covers so each
 * pixel's centre lands on its point: the zone's extent when Inset, half a step
 * beyond it when On edge (the heatmap is then clipped to the outline).
 */
export function cellRect(g: FieldGrid): { x: number; y: number; w: number; h: number } {
  const du = g.offset || g.nU <= 1 ? 0 : axisStep(g.nU, g.u1, g.u2, false) / 2;
  const dv = g.offset || g.nV <= 1 ? 0 : axisStep(g.nV, g.v1, g.v2, false) / 2;
  const [xa] = gridToCanvas(g, g.u1 - du, 0);
  const [xb] = gridToCanvas(g, g.u2 + du, 0);
  const x = Math.min(xa, xb);
  return { x, y: g.v1 - dv, w: Math.abs(xb - xa), h: g.v2 - g.v1 + 2 * dv };
}

/** Each column's highest value (a volume seen from above), NaN where the column has none. */
export function columnMax(values: number[][][]): number[][] {
  return values.map((plane) => plane.map((col) => {
    let m = -Infinity;
    for (const v of col) if (Number.isFinite(v) && v > m) m = v;
    return m === -Infinity ? NaN : m;
  }));
}

/** Finite min and max of a grid's values; null when it has none. */
export function gridRange(data: ArrayLike<number>): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < data.length; k++) {
    const v = data[k];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/**
 * RGBA for a display grid: the colormap over `range` (as CalcPlane3D's
 * heatmap), transparent outside the room. `scale` pixels per cell each way,
 * the values interpolated between the points as the 3D surface blends its
 * vertex colours; 1 gives one flat pixel per cell.
 */
export function heatmapPixels(grid: PlaneGrid, range: { min: number; max: number }, colormap: string, scale = 1): Uint8ClampedArray {
  const s = Math.max(1, Math.floor(scale));
  const w = grid.nU * s, h = grid.nV * s;
  const out = new Uint8ClampedArray(w * h * 4);
  const span = range.max - range.min || 1;
  const data = grid.data as unknown as number[];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const cell = grid.data[Math.floor(py / s) * grid.nU + Math.floor(px / s)];
      if (!Number.isFinite(cell)) continue;
      // Next to a hole the blend has nothing to lean on: the cell's own value
      let v = s === 1 ? cell : sampleGrid(data, grid.nU, grid.nV, (px + 0.5) / s, (py + 0.5) / s);
      if (!Number.isFinite(v)) v = cell;
      const c = valueToColor((v - range.min) / span, colormap);
      const k = (py * w + px) * 4;
      out[k] = Math.round(c.r * 255);
      out[k + 1] = Math.round(c.g * 255);
      out[k + 2] = Math.round(c.b * 255);
      out[k + 3] = 255;
    }
  }
  return out;
}

/** Pixels per cell for a smooth heatmap image of about 512 px on its long side (one per cell for a fine grid). */
export function heatmapScale(grid: Pick<PlaneGrid, 'nU' | 'nV'>): number {
  return Math.max(1, Math.min(16, Math.floor(512 / Math.max(grid.nU, grid.nV, 1))));
}

/** The most numbers the 2D view prints for one zone; a finer grid shows its markers (as 3D does when they would not fit). */
export const MAX_NUMERIC_2D = 2500;

export type FieldKind = 'heatmap' | 'contours' | 'numeric' | 'markers';

/** The zone's results as the room view shows them: none when stale (its grid has moved since), as 3D hides them. */
export function freshValues(zone: CalcZone, result: ZoneResult | undefined): number[][] | number[][][] | null {
  const values = result?.values;
  if (!values || values.length === 0) return null;
  if (!dimensionsMatch(zone, result.dimensionSnapshot)) return null;
  return values;
}

/**
 * What the 2D view draws for the zone, by its 2D display mode, as 3D decides:
 * a plane shows its markers wherever its mode has nothing to draw (no results
 * yet, turned off), a volume only in Markers (or Numeric without results); a
 * volume's heatmap is its isosurfaces' bands seen from above. Null for None.
 */
export function fieldKind(zone: CalcZone, hasValues: boolean, opts: { levels?: boolean } = {}): FieldKind | null {
  const mode: ZoneDisplayMode = zoneDisplayMode(zone, '2d');
  const enabled = zone.enabled !== false;
  if (zone.type === 'volume') {
    if (!enabled || mode === 'none') return null;
    if (mode === 'markers') return 'markers';
    if (mode === 'numeric') {
      const n = (zone.num_x ?? 0) * (zone.num_y ?? 0) * (zone.num_z ?? 0);
      return hasValues && n <= MAX_NUMERIC_VOLUME_POINTS && (zone.num_x ?? 0) * (zone.num_y ?? 0) <= MAX_NUMERIC_2D ? 'numeric' : 'markers';
    }
    return hasValues && opts.levels !== false ? 'heatmap' : null;
  }
  if (enabled && mode === 'none') return null;
  if (!enabled || !hasValues) return 'markers';
  if (mode === 'heatmap') return 'heatmap';
  if (mode === 'contours') return opts.levels === false ? 'markers' : 'contours';
  if (mode === 'numeric') return (zone.num_x ?? 0) * (zone.num_y ?? 0) <= MAX_NUMERIC_2D ? 'numeric' : 'markers';
  return 'markers';
}

/**
 * The planes and volumes the 2D view shows a field for: on the plan view the
 * volumes and the floor's and the ceiling's planes; on the ceiling designer's
 * plan the ceiling's planes; on a wall view that wall's planes. Hidden zones
 * (their eye off) are left out, standard zones included as in 3D.
 */
export function fieldZones(zones: CalcZone[], surface: Surface, roomZ: number, hidden?: Set<string>): CalcZone[] {
  const wall = wallIndex(surface);
  return zones.filter((z) => {
    if (hidden?.has(z.id) || (z.type !== 'plane' && z.type !== 'volume')) return false;
    if (wall !== null) return z.type === 'plane' && zoneWallIndex(z) === wall;
    if (z.type === 'volume') return surface === 'floor';
    if (!zoneHasFootprint(z)) return false;
    const on = zoneSurface(z, roomZ);
    return surface === 'ceiling' ? on === 'ceiling' : planSurface(on) === 'floor';
  });
}

/**
 * The value range every plane shares when heatmaps are normalised globally:
 * the enabled planes' results (their stored units), as the room view uses it.
 */
export function globalPlaneRange(zones: CalcZone[], results: Record<string, ZoneResult> | undefined): { min: number; max: number } | null {
  if (!results) return null;
  let min = Infinity, max = -Infinity;
  for (const zone of zones) {
    if (zone.enabled === false || zone.type !== 'plane') continue;
    const result = results[zone.id];
    if (!result?.values) continue;
    if (result.statistics.min != null && result.statistics.min < min) min = result.statistics.min;
    if (result.statistics.max != null && result.statistics.max > max) max = result.statistics.max;
  }
  if (!isFinite(min) || !isFinite(max)) return null;
  return { min, max };
}
