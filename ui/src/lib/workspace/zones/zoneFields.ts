/**
 * Pure helpers for the zone panel: a plane's one distance from its surface
 * (Height on the floor, Below ceiling on the ceiling, From wall on a wall),
 * its Flip, the calculation modes, and the grid-points summary and spacing text.
 */
import type { CalcZone, PlaneCalcMode } from '$lib/types/project';
import { wallIndex, type Surface } from '$lib/utils/surfaces';
import { formatFloat } from '$lib/utils/formatting';

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

/** The fields that put the plane `v` from its surface. A wall plane never writes height. */
export function distancePartial(_zone: CalcZone, surface: Surface, roomZ: number, v: number): Partial<CalcZone> {
  if (onWall(surface)) return { normal_offset: v };
  if (surface === 'ceiling') return { height: r6(roomZ - v) };
  return { height: v };
}

/** Turn the plane's normal round. */
export function flipPartial(zone: CalcZone, surface: Surface): Partial<CalcZone> {
  if (onWall(surface)) return { flip: !zone.flip };
  const current = zone.direction ?? (surface === 'ceiling' ? -1 : 1);
  return { direction: -current };
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
