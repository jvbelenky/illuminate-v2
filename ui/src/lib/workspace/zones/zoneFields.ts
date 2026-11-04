/**
 * Pure helpers for the zone panel: a plane's one distance from its surface
 * (Height on the floor, Below ceiling on the ceiling, From wall on a wall),
 * its Flip, the calculation modes, and the grid-points summary and spacing text.
 */
import type { CalcZone, PlaneCalcMode, RoomConfig, ZoneDisplayMode, ZoneFitMemory } from '$lib/types/project';
import { wallIndex, zoneSurface, type Surface } from '$lib/utils/surfaces';
import { formatFloat } from '$lib/utils/formatting';
import { fromMeters, roundToUnit, type LengthUnit } from '$lib/utils/unitConversion';
import { footprintGeometry, isAxisRectangle, rectangleCorners, roomFillGeometry, roomFootprint, zoneFootprint } from '$lib/utils/zoneFootprint';
import { planeWall, wallPlaneOutline } from '$lib/utils/planeWorld';
import { polygonBoundingBox, roomVertices, validatePolygon, type Vertex } from '$lib/utils/roomGeometry';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

const onWall = (surface: Surface) => wallIndex(surface) !== null;

/** A vertical plane parallel to no wall: it keeps its old geometry, shown read-only. */
export function isLegacyPlane(zone: Pick<CalcZone, 'type' | 'surface' | 'ref_surface'>): boolean {
  if (zone.type !== 'plane') return false;
  if (zone.surface && onWall(zone.surface)) return false;
  return zone.ref_surface === 'xz' || zone.ref_surface === 'yz';
}

export function distanceLabel(surface: Surface): string {
  if (surface === 'ceiling') return 'Below ceiling';
  return onWall(surface) ? 'From wall' : 'Height';
}

/** The plane's distance from its surface. */
export function distanceOf(zone: CalcZone, surface: Surface, roomZ: number): number {
  if (onWall(surface)) return zone.normal_offset ?? 0;
  if (surface === 'ceiling') return r6(roomZ - (zone.height ?? roomZ));
  return zone.height ?? 0;
}

/**
 * A plane with no stored surface has one derived from its height and direction,
 * which an edit of either would change: it gets the one it is on.
 */
const keepSurface = (zone: CalcZone, surface: Surface): Partial<CalcZone> => (zone.surface ? {} : { surface });

/** The fields that put the plane `v` from its surface. A wall plane never writes height. */
export function distancePartial(zone: CalcZone, surface: Surface, roomZ: number, v: number): Partial<CalcZone> {
  if (onWall(surface)) return { normal_offset: v };
  if (surface === 'ceiling') return { height: r6(roomZ - v), ...keepSurface(zone, surface) };
  return { height: v, ...keepSurface(zone, surface) };
}

/** Turn the plane's normal round. */
export function flipPartial(zone: CalcZone, surface: Surface): Partial<CalcZone> {
  if (onWall(surface)) return { flip: !zone.flip };
  const current = zone.direction ?? (surface === 'ceiling' ? -1 : 1);
  return { direction: -current, ...keepSurface(zone, surface) };
}

const count = (n: number | undefined) => (n == null ? '–' : String(n));

/** The point counts: '10 × 12', or '10 × 12 × 8' for a volume. */
export function gridSummary(zone: CalcZone): string {
  const parts = [count(zone.num_x), count(zone.num_y)];
  if (zone.type === 'volume') parts.push(count(zone.num_z));
  return parts.join(' × ');
}

/** The value the other mode gives: the spacing under Points, the point counts under Spacing. */
export function spacingText(zone: CalcZone, unit: string, precision: number): string {
  if (zone.resolution_mode === 'spacing') return `${gridSummary(zone)} points`;
  const s = (v: number | undefined) => (v == null ? '–' : formatFloat(v, precision));
  const parts = [s(zone.x_spacing), s(zone.y_spacing)];
  if (zone.type === 'volume') parts.push(s(zone.z_spacing));
  return `${parts.join(' × ')} ${unit}`;
}

export type CustomFlags = Pick<Required<CalcZone>, 'horiz' | 'vert' | 'use_normal' | 'fov_vert' | 'fov_horiz'>;

export const DEFAULT_CUSTOM_FLAGS: CustomFlags = { horiz: false, vert: false, use_normal: false, fov_vert: 180, fov_horiz: 360 };

/** The Calculation select's options, in order. */
export const CALC_MODES: { value: PlaneCalcMode; title: string; description: string }[] = [
  { value: 'fluence_rate', title: 'Fluence Rate',
    description: 'Points have no normal. They collect flux from all directions and report the total.' },
  { value: 'planar_normal', title: 'Planar Normal',
    description: 'Normals are perpendicular to the calculation plane.' },
  { value: 'planar_max', title: 'Planar Maximum',
    description: 'Calculates the maximum irradiance from any direction at each point.' },
  { value: 'eye_worst_case', title: 'Eye (Worst Case)',
    description: 'Finds the worst-case eye exposure at each point by searching over all gaze directions within the FOV.' },
  { value: 'eye_directional', title: 'Eye (Directional)',
    description: 'Eye exposure with all gaze normals pointing in a user-defined direction.' },
  { value: 'eye_target', title: 'Eye (Target)',
    description: 'Eye exposure with all gaze normals facing toward a user-defined target point.' },
  { value: 'custom', title: 'Custom',
    description: 'Manually configure all calculation flags: weighting, directionality, and field of view.' },
];

/**
 * The flags a calculation mode sets, matching the backend's set_calc_mode;
 * Custom brings back the flags last used with it.
 */
export function calcModeFlags(mode: PlaneCalcMode, custom: CustomFlags = DEFAULT_CUSTOM_FLAGS): CustomFlags {
  const wide = { fov_vert: 180, fov_horiz: 360 };
  switch (mode) {
    case 'fluence_rate': return { horiz: false, vert: false, use_normal: false, ...wide };
    case 'planar_normal': return { horiz: true, vert: false, use_normal: true, ...wide };
    case 'planar_max': return { horiz: false, vert: false, use_normal: true, ...wide };
    case 'vertical': return { horiz: false, vert: true, use_normal: false, ...wide };
    case 'vertical_dir': return { horiz: false, vert: true, use_normal: true, ...wide };
    case 'eye_worst_case':
    case 'eye_directional':
    case 'eye_target': return { horiz: true, vert: false, use_normal: true, fov_vert: 80, fov_horiz: 120 };
    default: return { ...custom };
  }
}

/** Eye modes and Custom filter by field of view. */
export function showsFov(mode: PlaneCalcMode | undefined): boolean {
  return mode === 'eye_worst_case' || mode === 'eye_directional' || mode === 'eye_target' || mode === 'custom';
}

/** What the zone's values are: fluence rate, irradiance or dose. */
export function valueKind(zone: CalcZone): 'Fluence rate' | 'Irradiance' | 'Dose' {
  if (zone.dose) return 'Dose';
  const aimed = zone.calc_mode === 'eye_directional' || zone.calc_mode === 'eye_target';
  return zone.vert && zone.horiz && !zone.use_normal && !aimed ? 'Fluence rate' : 'Irradiance';
}

// --- Surface, Fit to room, ranges

/**
 * The fields that move a plane onto `target`, filling it: the floor at eye height facing
 * up, the ceiling facing down, or a whole wall. What belonged to the old surface is
 * cleared (present and undefined), as is an orphan's flag.
 */
export function surfacePartial(target: Surface, room: RoomConfig, units: LengthUnit): Partial<CalcZone> {
  if (onWall(target)) {
    return { surface: target, fit_room: true, normal_offset: 0, flip: false, wall_vertices: undefined, wall_orphan: undefined };
  }
  const ceiling = target === 'ceiling';
  return {
    surface: target,
    fit_room: true,
    height: ceiling ? room.z : roundToUnit(fromMeters(EYE_HEIGHT_M, units), units),
    direction: ceiling ? -1 : 1,
    ref_surface: 'xy',
    ...roomFillGeometry('plane', room),
    normal_offset: undefined,
    flip: undefined,
    wall_vertices: undefined,
    wall_orphan: undefined,
  };
}

const EYE_HEIGHT_M = 1.8;

/** The Surface select's value: none ('') for a plane whose wall is gone or a legacy vertical plane. */
export function surfaceChoice(zone: CalcZone, roomZ: number): Surface | '' {
  if (zone.wall_orphan || isLegacyPlane(zone)) return '';
  return zoneSurface(zone, roomZ);
}

/**
 * The heading of a zone's geometry fold: Vertices when it lists a drawn outline's
 * vertices, Geometry when it shows a rectangle (or a legacy plane) as X and Y ranges.
 */
export function geometryLabel(vertices: Vertex[], ranges = false): 'Vertices' | 'Geometry' {
  return ranges || isAxisRectangle(vertices) ? 'Geometry' : 'Vertices';
}

/** The footprint a flat plane or volume shows: its outline, the room when fit with no bounds, else its bounds. */
export function shownFootprint(zone: CalcZone, room: RoomConfig): Vertex[] {
  const drawn = zone.vertices && zone.vertices.length >= 3;
  const noBounds = zone.type === 'volume' ? zone.x_min == null : zone.x1 == null;
  return !drawn && noBounds && zone.fit_room ? roomFootprint(room) : zoneFootprint(zone);
}

/**
 * Fit to room switched on (refit to the surface: the room outline, the whole wall, or for
 * a volume floor to ceiling) or off. On remembers the geometry it had (`fit_memory`); off
 * brings that back, clamped into the room (or wall) if the room has changed since, when it
 * was remembered on the surface the plane is on now. Without a memory, off makes what it
 * shows explicit, so nothing moves. Each is one update, so one undo step.
 */
export function fitPartial(zone: CalcZone, room: RoomConfig, on: boolean): Partial<CalcZone> {
  if (on) return { ...fitOnPartial(zone, room), fit_memory: fitMemoryOf(zone, room) };
  return restoreFitPartial(zone, room) ?? fitOffPartial(zone, room);
}

function fitOnPartial(zone: CalcZone, room: RoomConfig): Partial<CalcZone> {
  if (zone.type === 'volume') return { fit_room: true, ...roomFillGeometry('volume', room), z_min: 0, z_max: room.z };
  if (planeWall(zone, room)) return { fit_room: true, wall_vertices: undefined };
  return { fit_room: true, ...roomFillGeometry('plane', room) };
}

function fitOffPartial(zone: CalcZone, room: RoomConfig): Partial<CalcZone> {
  if (zone.type === 'volume') return { fit_room: false, ...footprintGeometry('volume', shownFootprint(zone, room)) };
  const wall = planeWall(zone, room);
  if (wall) return { fit_room: false, wall_vertices: wallPlaneOutline(zone, wall, room.z).map(([a, u]) => [a, u] as [number, number]) };
  return { fit_room: false, ...footprintGeometry('plane', shownFootprint(zone, room)) };
}

const pairs = (vs: Vertex[]): [number, number][] => vs.map(([a, b]) => [a, b] as [number, number]);

/** The geometry the zone shows now, to bring back when Fit is switched off again. */
export function fitMemoryOf(zone: CalcZone, room: RoomConfig): ZoneFitMemory {
  if (zone.type === 'volume') {
    const z1 = zone.z_min ?? 0, z2 = zone.z_max ?? room.z;
    return { footprint: pairs(shownFootprint(zone, room)), z: [Math.min(z1, z2), Math.max(z1, z2)] };
  }
  const surface = zoneSurface(zone, room.z);
  const wall = planeWall(zone, room);
  if (wall) return { surface, wall: pairs(wallPlaneOutline(zone, wall, room.z)) };
  return { surface, footprint: pairs(shownFootprint(zone, room)) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** An outline with every corner moved into the box; null when what is left is no polygon. */
export function clampOutline(vs: Vertex[], [x1, x2, y1, y2]: Ranges): Vertex[] | null {
  const out: Vertex[] = [];
  for (const [x, y] of vs) {
    const p: Vertex = [r6(clamp(x, x1, x2)), r6(clamp(y, y1, y2))];
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return validatePolygon(out) === null ? out : null;
}

/** The remembered geometry, clamped into the room; null when there is none to bring back here. */
function restoreFitPartial(zone: CalcZone, room: RoomConfig): Partial<CalcZone> | null {
  const m = zone.fit_memory;
  if (!m) return null;
  if (zone.type === 'volume') {
    if (!m.footprint) return null;
    const bb = polygonBoundingBox(roomVertices(room));
    const fp = clampOutline(m.footprint, [bb.xMin, bb.xMax, bb.yMin, bb.yMax]);
    if (!fp) return null;
    let [z1, z2] = m.z ?? [0, room.z];
    z1 = clamp(z1, 0, room.z);
    z2 = clamp(z2, 0, room.z);
    if (z2 - z1 < 1e-9) [z1, z2] = [0, room.z];
    return { fit_room: false, ...footprintGeometry('volume', fp), z_min: z1, z_max: z2 };
  }
  if (m.surface !== zoneSurface(zone, room.z)) return null;
  const wall = planeWall(zone, room);
  if (wall) {
    if (!m.wall) return null;
    const outline = clampOutline(m.wall, [0, wall.length, 0, room.z]);
    return outline ? { fit_room: false, wall_vertices: pairs(outline) } : null;
  }
  if (!m.footprint) return null;
  const bb = polygonBoundingBox(roomVertices(room));
  const fp = clampOutline(m.footprint, [bb.xMin, bb.xMax, bb.yMin, bb.yMax]);
  return fp ? { fit_room: false, ...footprintGeometry('plane', fp) } : null;
}

/** A rectangle's ranges: [first1, first2, second1, second2]. */
export type Ranges = [number, number, number, number];

/** The ranges with one end set; the two ends swap rather than cross. Null for an empty range. */
export function editRange(ranges: Ranges, index: 0 | 1 | 2 | 3, v: number): Ranges | null {
  const next = [...ranges] as Ranges;
  next[index] = v;
  const pair = index < 2 ? 0 : 2;
  const [a, b] = [next[pair], next[pair + 1]];
  if (Math.abs(a - b) < 1e-9) return null;
  next[pair] = Math.min(a, b);
  next[pair + 1] = Math.max(a, b);
  return next;
}

/** The fields for a rectangle given by its ranges (X/Y, or Along/Up on a wall), with Fit off. */
export function rangePartial(kind: 'plane' | 'volume' | 'wall', [a1, a2, b1, b2]: Ranges): Partial<CalcZone> {
  const corners = rectangleCorners(a1, a2, b1, b2);
  if (kind === 'wall') return { wall_vertices: corners.map(([a, u]) => [a, u] as [number, number]), fit_room: false };
  return { ...footprintGeometry(kind, corners), fit_room: false };
}

/** The ranges of a rectangle outline. */
export function rangesOf(vs: Vertex[]): Ranges {
  const xs = vs.map((p) => p[0]), ys = vs.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

// --- Display, per view

export type ZoneView = '2d' | '3d';

/** How the zone is drawn in a view. The 3D mode is the stored one (legacy show_values migrated); 2D starts from it. */
export function zoneDisplayMode(zone: CalcZone, view: ZoneView): ZoneDisplayMode {
  const three: ZoneDisplayMode = zone.display_mode ?? (zone.show_values === false ? 'markers' : 'heatmap');
  const mode = view === '2d' ? (zone.display_mode_2d ?? three) : three;
  // Contours are a plane view
  return zone.type === 'volume' && mode === 'contours' ? 'heatmap' : mode;
}

/** Whether the zone's name shows in a view: on the 2D plan unless turned off, in 3D only when turned on. */
export function zoneLabelShown(zone: CalcZone, view: ZoneView): boolean {
  return view === '2d' ? zone.show_label_2d !== false : zone.show_label === true;
}

/** The display modes a plane or volume offers in a view, with their glyphs and titles (as on the single-page editor). */
export function displayModes(kind: 'plane' | 'volume', view: ZoneView = '3d'): { value: ZoneDisplayMode; label: string; title: string; glyph: 'display_heatmap' | 'display_numeric' | 'display_contours' | 'display_markers' | 'display_none' }[] {
  const volume = kind === 'volume';
  // A volume's heatmap is isosurfaces in 3D
  const iso = volume && view === '3d';
  return [
    { value: 'heatmap', label: iso ? 'Iso' : 'Heatmap', title: iso ? 'Isoirradiance' : 'Heatmap', glyph: 'display_heatmap' },
    { value: 'numeric', label: 'Numeric', title: 'Numeric', glyph: 'display_numeric' },
    ...(volume ? [] : [{ value: 'contours' as const, label: 'Contours', title: 'Contours', glyph: 'display_contours' as const }]),
    { value: 'markers', label: 'Markers', title: 'Markers Only', glyph: 'display_markers' },
    { value: 'none', label: 'None', title: 'Outline Only', glyph: 'display_none' },
  ];
}
