/**
 * Pure helpers behind the Results summary: which pathogens can be shown, the
 * CADR formulas, hours of occupancy before a TLV is reached, and short time
 * formatting. Kept out of the components so they can be unit-tested directly.
 */

import { formatValue } from '$lib/utils/formatting';

export interface TlvPair {
  skin: number;
  eye: number;
}

/**
 * Exposure as a fraction of the skin and eye TLVs reached over the 8-hour
 * day, spectrum-weighted per lamp the way guv_calcs does it: each lamp's dose
 * over that lamp's own TLV, summed. 1.0 is the limit.
 */
export interface TlvFraction {
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
 * Fraction of one TLV pair reached by the given max 8-h doses. Only right for
 * a room whose lamps all share the spectrum the pair was derived for (the
 * monochromatic 222 nm fallback before check-lamps has run); with mixed
 * spectra use the backend's per-lamp weighted fractions instead.
 */
export function fractionOfLimit(
  pair: TlvPair | null | undefined,
  skinMax: number | null | undefined,
  eyeMax: number | null | undefined,
): TlvFraction | null {
  if (!pair || skinMax == null || eyeMax == null) return null;
  if (!Number.isFinite(skinMax) || !Number.isFinite(eyeMax)) return null;
  return { skin: skinMax / pair.skin, eye: eyeMax / pair.eye };
}

/** Hours of occupancy before a limit reached at `fraction` of it per 8 h: 8 / fraction. Null without exposure. */
export function hoursFromFraction(fraction: number | null | undefined): number | null {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) return null;
  return 8 / fraction;
}

/**
 * Hours of occupancy before the limiting (skin or eye) TLV is reached, taking
 * the smaller of the two. Null when there is no exposure.
 */
export function hoursToLimit(fraction: TlvFraction | null | undefined): number | null {
  if (!fraction) return null;
  const candidates = [hoursFromFraction(fraction.skin), hoursFromFraction(fraction.eye)]
    .filter((h): h is number => h != null);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/**
 * Raw dose (mJ/cm²) at which the limit is reached, given the spectral mix at
 * the hottest point: max dose / fraction of the limit it reaches. Equals the
 * TLV for a single-spectrum room. Drawn as the TLV line on dose plots.
 */
export function doseAtLimit(
  maxDose: number | null | undefined,
  fraction: number | null | undefined,
): number | undefined {
  if (maxDose == null || !Number.isFinite(maxDose) || maxDose <= 0) return undefined;
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) return undefined;
  return maxDose / fraction;
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
