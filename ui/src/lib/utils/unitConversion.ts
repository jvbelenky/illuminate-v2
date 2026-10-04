import { roomFloorArea, type RoomOutline } from './roomGeometry';

/**
 * The single registry of length units the app can display and edit in.
 *
 * Every length the stores hold (room, lamps, zones, objects, reflectance
 * spacings) is in the *current* display unit, and `project.changeUnits` asks
 * the backend to rescale everything when the unit changes. Code that needs a
 * physical size (a 10 cm wall offset, a 3 cm lift above the floor) declares
 * it in meters and converts with `fromMeters(x, units)` at the point of use.
 */
export const LENGTH_UNITS = ['meters', 'centimeters', 'millimeters', 'feet', 'inches'] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const DEFAULT_UNITS: LengthUnit = 'meters';

export interface LengthUnitInfo {
  /** Short symbol used in labels: m, cm, mm, ft, in. */
  abbrev: string;
  /** Full name, as sent to the API. */
  label: LengthUnit;
  /** How many meters one unit is. */
  metersPerUnit: number;
  /** Metric vs imperial; picks lps vs cfm for CADR and similar derived units. */
  metric: boolean;
  /** Default room `precision` (display decimals) for lengths in this unit. */
  decimals: number;
  /** Decimals kept when a value is converted into this unit: one finer than display. */
  roundDecimals: number;
  /** Nudge step for positions and room/object dimensions. */
  step: number;
  /** Nudge step for small dimensions (lamp housing, emissive surface). */
  fineStep: number;
  /** Drawing snap on the plan canvas (10 cm / 3 in). */
  snap: number;
  /** 3D floor-grid cell in display units (always 1 m or 1 ft). */
  gridCell: number;
}

export const UNIT_INFO: Record<LengthUnit, LengthUnitInfo> = {
  meters: { abbrev: 'm', label: 'meters', metersPerUnit: 1, metric: true, decimals: 1, roundDecimals: 2, step: 0.1, fineStep: 0.01, snap: 0.1, gridCell: 1 },
  centimeters: { abbrev: 'cm', label: 'centimeters', metersPerUnit: 0.01, metric: true, decimals: 0, roundDecimals: 1, step: 1, fineStep: 0.1, snap: 10, gridCell: 100 },
  millimeters: { abbrev: 'mm', label: 'millimeters', metersPerUnit: 0.001, metric: true, decimals: 0, roundDecimals: 0, step: 10, fineStep: 1, snap: 100, gridCell: 1000 },
  feet: { abbrev: 'ft', label: 'feet', metersPerUnit: 0.3048, metric: false, decimals: 1, roundDecimals: 2, step: 0.1, fineStep: 0.01, snap: 0.25, gridCell: 1 },
  inches: { abbrev: 'in', label: 'inches', metersPerUnit: 0.0254, metric: false, decimals: 0, roundDecimals: 1, step: 1, fineStep: 0.1, snap: 3, gridCell: 12 },
};

// Legacy constants; new code should use metersPerUnit()/fromMeters()/convertLength().
export const METERS_PER_FOOT = UNIT_INFO.feet.metersPerUnit;
export const FEET_PER_METER = 1 / METERS_PER_FOOT; // ~3.28084

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === 'string' && (LENGTH_UNITS as readonly string[]).includes(value);
}

/** Coerce an untrusted unit string (localStorage, a .guv file) to a known unit. */
export function toLengthUnit(value: unknown, fallback: LengthUnit = DEFAULT_UNITS): LengthUnit {
  return isLengthUnit(value) ? value : fallback;
}

export function metersPerUnit(units: LengthUnit): number {
  return UNIT_INFO[units].metersPerUnit;
}

export function unitsPerMeter(units: LengthUnit): number {
  return 1 / UNIT_INFO[units].metersPerUnit;
}

/** Multiplicative factor taking a length in `from` to a length in `to`. */
export function lengthFactor(from: LengthUnit, to: LengthUnit): number {
  if (from === to) return 1;
  return UNIT_INFO[from].metersPerUnit / UNIT_INFO[to].metersPerUnit;
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return from === to ? value : value * lengthFactor(from, to);
}

/** A physical size declared in meters, expressed in the display unit. */
export function fromMeters(meters: number, units: LengthUnit): number {
  return convertLength(meters, 'meters', units);
}

export function toMeters(value: number, units: LengthUnit): number {
  return convertLength(value, units, 'meters');
}

/**
 * Get the abbreviation for a unit type.
 */
export function unitAbbrev(units: LengthUnit): string {
  return UNIT_INFO[units].abbrev;
}

/**
 * Get the full unit name.
 */
export function unitLabel(units: LengthUnit): string {
  return UNIT_INFO[units].label;
}

export function isMetric(units: LengthUnit): boolean {
  return UNIT_INFO[units].metric;
}

export function unitDecimals(units: LengthUnit): number {
  return UNIT_INFO[units].decimals;
}

export function unitStep(units: LengthUnit): number {
  return UNIT_INFO[units].step;
}

export function unitFineStep(units: LengthUnit): number {
  return UNIT_INFO[units].fineStep;
}

export function unitSnap(units: LengthUnit): number {
  return UNIT_INFO[units].snap;
}

export function gridCellSize(units: LengthUnit): number {
  return UNIT_INFO[units].gridCell;
}

/**
 * Round a converted length to its new unit's conversion precision (one digit
 * finer than the display default), so a unit switch produces values like
 * 266.7 cm rather than 266.69999999999996 without losing what the display
 * would show.
 */
export function roundToUnit(value: number, units: LengthUnit): number {
  const f = 10 ** UNIT_INFO[units].roundDecimals;
  return Math.round(value * f) / f;
}

/**
 * The room-level `precision` setting to use after switching units: if the
 * precision was still the old unit's default (1 decimal in meters or feet,
 * none in centimeters, millimeters or inches), move to the new unit's
 * default; a user-chosen precision is kept.
 */
export function precisionAfterUnitChange(precision: number, from: LengthUnit, to: LengthUnit): number {
  return precision === unitDecimals(from) ? unitDecimals(to) : precision;
}

/**
 * Compute a room's volume in cubic meters from a room outline expressed in the
 * current display units. Polygon rooms use their floor-plan area; rectangles
 * use x * y.
 *
 * Room dimensions are stored in display units (feet mode stores feet, via
 * `project.changeUnits`), so they must be converted before use in
 * unit-sensitive calculations such as CADR. Passing feet dimensions through as
 * meters inflates the volume — and any derived CADR — by FEET_PER_METER³ (~35.3x).
 */
export function roomVolumeM3(
  room: RoomOutline & { z: number },
  units: LengthUnit
): number {
  const volume = roomFloorArea(room) * room.z;
  return volume * metersPerUnit(units) ** 3;
}
