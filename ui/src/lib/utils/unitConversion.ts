export const METERS_PER_FOOT = 0.3048;
export const FEET_PER_METER = 1 / 0.3048; // ~3.28084

/**
 * Get the abbreviation for a unit type.
 */
export function unitAbbrev(units: 'meters' | 'feet'): string {
  return units === 'meters' ? 'm' : 'ft';
}

/**
 * Get the full unit name.
 */
export function unitLabel(units: 'meters' | 'feet'): string {
  return units === 'meters' ? 'meters' : 'feet';
}

/**
 * Compute a room's volume in cubic meters from dimensions expressed in the
 * current display units.
 *
 * Room dimensions are stored in display units (feet mode stores feet, via
 * `project.changeUnits`), so they must be converted before use in
 * unit-sensitive calculations such as CADR. Passing feet dimensions through as
 * meters inflates the volume — and any derived CADR — by FEET_PER_METER³ (~35.3x).
 */
export function roomVolumeM3(
  x: number,
  y: number,
  z: number,
  units: 'meters' | 'feet'
): number {
  const volume = x * y * z;
  return units === 'feet' ? volume * METERS_PER_FOOT ** 3 : volume;
}
