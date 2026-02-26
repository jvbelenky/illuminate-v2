/**
 * Client-side survival math ported from guv_calcs/efficacy/math.py.
 *
 * Two-compartment inactivation model:
 *   S(t) = (1-f) * exp(-k1 * irrad/1000 * t) + f * exp(-k2 * irrad/1000 * t)
 *
 * Where:
 *   S     = surviving fraction (0 to 1)
 *   t     = time in seconds
 *   irrad = irradiance in µW/cm²
 *   k1    = primary susceptibility (cm²/mJ)
 *   k2    = secondary susceptibility (cm²/mJ), 0 if single-compartment
 *   f     = resistant fraction (0 to 1), 0 if single-compartment
 */

/**
 * Calculate survival fraction at time t.
 */
export function survivalFraction(
  t: number,
  irrad: number,
  k1: number,
  k2: number = 0,
  f: number = 0
): number {
  const k1Irrad = (k1 * irrad) / 1000;
  const k2Irrad = (k2 * irrad) / 1000;
  return (1 - f) * Math.exp(-k1Irrad * t) + f * Math.exp(-k2Irrad * t);
}

/**
 * Find time (seconds) to reach survival fraction S using bisection.
 * Returns Infinity if no solution found.
 */
export function secondsToS(
  S: number,
  irrad: number,
  k1: number,
  k2: number = 0,
  f: number = 0,
  tol: number = 1e-10,
  maxIter: number = 100
): number {
  if (S <= 0 || S >= 1) return Infinity;
  if (irrad <= 0 || k1 <= 0) return Infinity;

  // For single-compartment (f=0), analytical solution
  if (f === 0 || k2 === 0) {
    const k1Irrad = (k1 * irrad) / 1000;
    return -Math.log(S) / k1Irrad;
  }

  // Bisection method for two-compartment model
  let lo = 0;
  // Upper bound: use single-compartment estimate with the larger k as a starting guess
  const kMax = Math.max(k1, k2);
  let hi = (-Math.log(S * 0.01) / ((kMax * irrad) / 1000)); // overshoot

  // Ensure hi gives S(hi) < target S
  while (survivalFraction(hi, irrad, k1, k2, f) > S) {
    hi *= 2;
    if (hi > 1e12) return Infinity;
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const sMid = survivalFraction(mid, irrad, k1, k2, f);

    if (Math.abs(sMid - S) < tol) {
      return mid;
    }

    if (sMid > S) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

/**
 * Time (seconds) to reach a given log reduction level.
 * logLevel 1 = 90%, 2 = 99%, 3 = 99.9%, etc.
 */
export function logReductionTime(
  logLevel: number,
  irrad: number,
  k1: number,
  k2: number = 0,
  f: number = 0
): number {
  const S = Math.pow(10, -logLevel);
  return secondsToS(S, irrad, k1, k2, f);
}

/**
 * Calculate eACH-UV (equivalent air changes per hour from UV).
 * Formula: (k1*(1-f) + k2*f) * irrad * 3.6
 */
export function eachUV(
  irrad: number,
  k1: number,
  k2: number = 0,
  f: number = 0
): number {
  return (k1 * (1 - f) + k2 * f) * irrad * 3.6;
}

export interface SurvivalPoint {
  t: number;
  S: number;
}

/**
 * Generate survival curve points for plotting.
 * Returns an array of {t, S} points from t=0 to the time at maxLogLevel.
 */
export function survivalCurvePoints(
  irrad: number,
  k1: number,
  k2: number = 0,
  f: number = 0,
  numPoints: number = 200,
  maxLogLevel: number = 5
): SurvivalPoint[] {
  const tMax = logReductionTime(maxLogLevel, irrad, k1, k2, f);
  if (!isFinite(tMax) || tMax <= 0) {
    return [{ t: 0, S: 1 }];
  }

  const points: SurvivalPoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = (i / numPoints) * tMax;
    const S = survivalFraction(t, irrad, k1, k2, f);
    points.push({ t, S });
  }
  return points;
}

/** Log reduction labels for display */
export const LOG_LABELS: Record<number, string> = {
  1: '90%',
  2: '99%',
  3: '99.9%',
  4: '99.99%',
  5: '99.999%'
};

/** Default target species matching the backend's TARGET_SPECIES */
export const DEFAULT_TARGET_SPECIES = [
  'Human coronavirus',
  'Influenza virus',
  'Staphylococcus aureus'
];

export interface SpeciesKinetics {
  species: string;
  k1: number;
  k2: number;
  f: number;
}

/**
 * Average kinetics parameters by species from efficacy rows.
 * Matches the backend's _averaging.py:compute_average_single logic.
 *
 * Filters rows to medium=Aerosol and the given wavelength, then averages
 * k1, k2, resistant_fraction across strains for each species.
 */
export function averageKineticsBySpecies(
  rows: { species: string; k1: number; k2: number | null; resistant_fraction: number; medium: string; wavelength: number }[],
  speciesList: string[],
  wavelength: number
): SpeciesKinetics[] {
  // Filter to aerosol medium and matching wavelength
  const filtered = rows.filter(r =>
    r.medium === 'Aerosol' && r.wavelength === wavelength
  );

  return speciesList.map(sp => {
    const matching = filtered.filter(r => r.species === sp);
    if (matching.length === 0) return null;
    const k1 = matching.reduce((s, r) => s + r.k1, 0) / matching.length;
    const k2 = matching.reduce((s, r) => s + (r.k2 ?? 0), 0) / matching.length;
    const f = matching.reduce((s, r) => s + r.resistant_fraction, 0) / matching.length;
    return { species: sp, k1, k2, f };
  }).filter((x): x is SpeciesKinetics => x !== null);
}
