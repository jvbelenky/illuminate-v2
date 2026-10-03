/**
 * Pure helpers behind the Results summary: which pathogens can be shown, the
 * CADR formulas, hours of occupancy before a TLV is reached, and short time
 * formatting. Kept out of the components so they can be unit-tested directly.
 */

import { calculateHoursToTLV } from '$lib/utils/calculations';
import { formatValue } from '$lib/utils/formatting';

export interface TlvPair {
  skin: number;
  eye: number;
}

/** Cubic feet in a cubic metre (the value guv_calcs uses for CADR in cfm). */
export const CUBIC_FEET_PER_M3 = 35.3147;

/** CADR-UV in litres per second: eACH · m³ · 1000 / 3600 (guv_calcs CADR_LPS). */
export function cadrLps(eachUV: number, volumeM3: number): number {
  return (eachUV * volumeM3 * 1000) / 3600;
}

/** CADR-UV in cubic feet per minute: eACH · ft³ / 60 (guv_calcs CADR_CFM). */
export function cadrCfm(eachUV: number, volumeM3: number): number {
  return (eachUV * volumeM3 * CUBIC_FEET_PER_M3) / 60;
}

/**
 * Aerosol species that have inactivation data at every one of the given
 * wavelengths, alphabetical. A species missing data at any lamp wavelength
 * cannot be evaluated for a multi-wavelength installation.
 */
export function speciesWithDataAt(
  rows: { species: string; medium: string; wavelength: number }[],
  wavelengths: number[],
): string[] {
  if (wavelengths.length === 0) return [];
  const byWavelength = new Map<number, Set<string>>();
  for (const r of rows) {
    if (r.medium !== 'Aerosol') continue;
    const wv = Math.round(r.wavelength);
    if (!byWavelength.has(wv)) byWavelength.set(wv, new Set());
    byWavelength.get(wv)!.add(r.species);
  }
  const sets = wavelengths.map((wv) => byWavelength.get(Math.round(wv)) ?? new Set<string>());
  if (sets.some((s) => s.size === 0)) return [];
  return [...sets[0]].filter((sp) => sets.every((s) => s.has(sp))).sort((a, b) => a.localeCompare(b));
}

/**
 * Hours of occupancy before the limiting (skin or eye) TLV is reached:
 * 8 h × TLV / max 8‑h dose, taking the smaller of skin and eye. Null when
 * there is no limit or no dose.
 */
export function hoursToLimit(
  pair: TlvPair | null | undefined,
  skinMax: number | null | undefined,
  eyeMax: number | null | undefined,
): number | null {
  if (!pair) return null;
  const candidates = [calculateHoursToTLV(skinMax, pair.skin), calculateHoursToTLV(eyeMax, pair.eye)]
    .filter((h): h is number => h != null && Number.isFinite(h));
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/** "Indefinite (12.4 h)" at or above a full 8-hour day, "3.1 h" below it, "27 min" under an hour. */
export function describeHours(hours: number | null): string {
  if (hours == null) return '—';
  if (hours >= 8) return `Indefinite (${formatValue(hours, 1)} h)`;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${formatValue(hours, 1)} h`;
}

/** Seconds as "42 s", "3.5 min" or "1.2 h". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** Irradiance (µW/cm²) that delivers `doseMj` mJ/cm² over `hours`. */
export function irradianceFromDose(doseMj: number | null | undefined, hours = 8): number | null {
  if (doseMj == null || !Number.isFinite(doseMj) || hours <= 0) return null;
  return (doseMj * 1000) / (hours * 3600);
}
