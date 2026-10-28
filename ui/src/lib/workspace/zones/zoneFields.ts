/**
 * Pure helpers for the zone panel: a plane's one distance from its surface
 * (Height on the floor, Below ceiling on the ceiling, From wall on a wall),
 * its Flip, the calculation modes, and the grid-points summary and spacing text.
 */
import type { CalcZone, PlaneCalcMode, RoomConfig } from '$lib/types/project';
import { wallIndex, zoneSurface, type Surface } from '$lib/utils/surfaces';
import { formatFloat } from '$lib/utils/formatting';
import { fromMeters, roundToUnit, type LengthUnit } from '$lib/utils/unitConversion';
import { footprintGeometry, rectangleCorners, roomFillGeometry, roomFootprint, zoneFootprint } from '$lib/utils/zoneFootprint';
import { planeWall, wallPlaneOutline } from '$lib/utils/planeWorld';
import type { Vertex } from '$lib/utils/roomGeometry';

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
export const CALC_MODES: { value: PlaneCalcMode; title: string }[] = [
  { value: 'fluence_rate', title: 'Fluence Rate' },
  { value: 'planar_normal', title: 'Planar Normal' },
  { value: 'planar_max', title: 'Planar Maximum' },
  { value: 'eye_worst_case', title: 'Eye (Worst Case)' },
  { value: 'eye_directional', title: 'Eye (Directional)' },
  { value: 'eye_target', title: 'Eye (Target)' },
  { value: 'custom', title: 'Custom' },
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

/** The footprint a flat plane or volume shows: its outline, the room when fit with no bounds, else its bounds. */
export function shownFootprint(zone: CalcZone, room: RoomConfig): Vertex[] {
  const drawn = zone.vertices && zone.vertices.length >= 3;
  const noBounds = zone.type === 'volume' ? zone.x_min == null : zone.x1 == null;
  return !drawn && noBounds && zone.fit_room ? roomFootprint(room) : zoneFootprint(zone);
}

/**
 * Fit to room switched on (refit to the surface: the room outline, the whole wall, or for
 * a volume floor to ceiling) or off (what it shows becomes explicit, so nothing moves).
 */
export function fitPartial(zone: CalcZone, room: RoomConfig, on: boolean): Partial<CalcZone> {
  if (zone.type === 'volume') {
    if (on) return { fit_room: true, ...roomFillGeometry('volume', room), z_min: 0, z_max: room.z };
    return { fit_room: false, ...footprintGeometry('volume', shownFootprint(zone, room)) };
  }
  const wall = planeWall(zone, room);
  if (wall) {
    if (on) return { fit_room: true, wall_vertices: undefined };
    return { fit_room: false, wall_vertices: wallPlaneOutline(zone, wall, room.z).map(([a, u]) => [a, u] as [number, number]) };
  }
  if (on) return { fit_room: true, ...roomFillGeometry('plane', room) };
  return { fit_room: false, ...footprintGeometry('plane', shownFootprint(zone, room)) };
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
