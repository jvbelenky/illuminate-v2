export const METERS_PER_FOOT = 0.3048;
export const FEET_PER_METER = 1 / 0.3048; // ~3.28084

/**
 * Convert a value in meters to the user's display unit.
 */
export function toDisplayUnit(meters: number, units: 'meters' | 'feet'): number {
  return units === 'feet' ? meters * FEET_PER_METER : meters;
}

/**
 * Convert a value from the user's display unit back to meters.
 */
export function fromDisplayUnit(displayValue: number, units: 'meters' | 'feet'): number {
  return units === 'feet' ? displayValue * METERS_PER_FOOT : displayValue;
}

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
