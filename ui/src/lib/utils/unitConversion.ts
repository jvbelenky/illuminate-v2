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
