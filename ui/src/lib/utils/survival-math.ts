/**
 * Client-side survival math ported from guv_calcs/efficacy/math.py.
 *
 * Two-compartment inactivation model:
 *   S(t) = (1-f) * exp(-k1 * irrad/1000 * t) + f * exp(-k2 * irrad/1000 * t)
 *
 * Multi-wavelength mode (arrays):
 *   k1_irrad = sum(k1[i] * irrad[i] / 1000)
 *   k2_irrad = sum(k2[i] * irrad[i] / 1000)
 *   f_eff = mean(f[i])
 *   S(t) = (1-f_eff) * exp(-k1_irrad * t) + f_eff * exp(-k2_irrad * t)
 *
 * Where:
 *   S     = surviving fraction (0 to 1)
 *   t     = time in seconds
 *   irrad = irradiance in µW/cm² (scalar or array)
 *   k1    = primary susceptibility (cm²/mJ) (scalar or array)
 *   k2    = secondary susceptibility (cm²/mJ) (scalar or array)
 *   f     = resistant fraction (0 to 1) (scalar or array)
 */

/** Irradiance input: scalar for single-wavelength, array for multi-wavelength */
type Irrad = number | number[];
type K = number | number[];
type F = number | number[];

/**
 * Calculate survival fraction at time t.
 * Supports both single-wavelength (scalar) and multi-wavelength (array) inputs.
 */
export function survivalFraction(
  t: number,
  irrad: Irrad,
  k1: K,
  k2: K = 0,
  f: F = 0
): number {
  let k1Irrad: number;
  let k2Irrad: number;
  let fEff: number;

  if (Array.isArray(irrad)) {
    if (irrad.length === 0) return 1;
    const k1Arr = k1 as number[];
    const k2Arr = k2 as number[];
    const fArr = f as number[];
    k1Irrad = 0;
    k2Irrad = 0;
    for (let i = 0; i < irrad.length; i++) {
      k1Irrad += k1Arr[i] * irrad[i] / 1000;
      k2Irrad += k2Arr[i] * irrad[i] / 1000;
    }
    fEff = fArr.reduce((s, v) => s + v, 0) / fArr.length;
  } else {
    k1Irrad = (k1 as number) * irrad / 1000;
    k2Irrad = (k2 as number) * irrad / 1000;
    fEff = f as number;
  }

  return (1 - fEff) * Math.exp(-k1Irrad * t) + fEff * Math.exp(-k2Irrad * t);
}

/**
 * Find time (seconds) to reach survival fraction S using bisection.
 * Returns Infinity if no solution found.
 * Supports both single-wavelength (scalar) and multi-wavelength (array) inputs.
 */
export function secondsToS(
  S: number,
  irrad: Irrad,
  k1: K,
  k2: K = 0,
  f: F = 0,
  tol: number = 1e-10,
  maxIter: number = 100
): number {
  if (S <= 0 || S >= 1) return Infinity;

  if (Array.isArray(irrad)) {
    if (irrad.length === 0) return Infinity;
    // Multi-wavelength: always use bisection
    let lo = 0;
    let hi = 1.0;
    while (survivalFraction(hi, irrad, k1, k2, f) > S) {
      hi *= 2;
      if (hi > 1e12) return Infinity;
    }
    for (let i = 0; i < maxIter; i++) {
      const mid = (lo + hi) / 2;
      const sMid = survivalFraction(mid, irrad, k1, k2, f);
      if (Math.abs(sMid - S) < tol) return mid;
      if (sMid > S) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Single-wavelength scalar path
  const irradS = irrad as number;
  const k1S = k1 as number;
  const k2S = k2 as number;
  const fS = f as number;

  if (irradS <= 0 || k1S <= 0) return Infinity;

  // For single-compartment (f=0), analytical solution
  if (fS === 0 || k2S === 0) {
    const k1Irrad = (k1S * irradS) / 1000;
    return -Math.log(S) / k1Irrad;
  }

  // Bisection method for two-compartment model
  let lo = 0;
  const kMax = Math.max(k1S, k2S);
  let hi = (-Math.log(S * 0.01) / ((kMax * irradS) / 1000));

  while (survivalFraction(hi, irradS, k1S, k2S, fS) > S) {
    hi *= 2;
    if (hi > 1e12) return Infinity;
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const sMid = survivalFraction(mid, irradS, k1S, k2S, fS);
    if (Math.abs(sMid - S) < tol) return mid;
    if (sMid > S) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}

/**
 * Time (seconds) to reach a given log reduction level.
 * logLevel 1 = 90%, 2 = 99%, 3 = 99.9%, etc.
 */
export function logReductionTime(
  logLevel: number,
  irrad: Irrad,
  k1: K,
  k2: K = 0,
  f: F = 0
): number {
  const S = Math.pow(10, -logLevel);
  return secondsToS(S, irrad, k1, k2, f);
}

/**
 * Calculate eACH-UV (equivalent air changes per hour from UV).
 * Single-wavelength: (k1*(1-f) + k2*f) * irrad * 3.6
 * Multi-wavelength: sum of per-wavelength eACH values (additive).
 */
export function eachUV(
  irrad: Irrad,
  k1: K,
  k2: K = 0,
  f: F = 0
): number {
  if (Array.isArray(irrad)) {
    const k1Arr = k1 as number[];
    const k2Arr = k2 as number[];
    const fArr = f as number[];
    let total = 0;
    for (let i = 0; i < irrad.length; i++) {
      total += (k1Arr[i] * (1 - fArr[i]) + k2Arr[i] * fArr[i]) * irrad[i] * 3.6;
    }
    return total;
  }
  return ((k1 as number) * (1 - (f as number)) + (k2 as number) * (f as number)) * (irrad as number) * 3.6;
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
  irrad: Irrad,
  k1: K,
  k2: K = 0,
  f: F = 0,
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
  /** Per-wavelength irradiance values (µW/cm²) */
  irradList: number[];
  /** Per-wavelength mean k1 values */
  k1List: number[];
  /** Per-wavelength mean k2 values */
  k2List: number[];
  /** Per-wavelength mean resistant fraction values */
  fList: number[];
  /** Per-wavelength SEM of k1 (0 if n < 2 for that wavelength) */
  k1SemList: number[];
  /** Per-wavelength sample counts */
  nList: number[];
}

type EfficacyRow = {
  species: string;
  k1: number;
  k2: number | null;
  resistant_fraction: number;
  medium: string;
  wavelength: number;
};

/**
 * Average kinetics parameters by species from efficacy rows.
 * Matches the backend's plotting.py multi-wavelength species_data logic.
 *
 * fluenceDict maps wavelength (nm) → irradiance (µW/cm²).
 * For each species, filters to medium=Aerosol, computes mean k1/k2/f per wavelength.
 * Species missing data for ANY wavelength are skipped.
 */
export function averageKineticsBySpecies(
  rows: EfficacyRow[],
  speciesList: string[],
  fluenceDict: Record<number, number>
): SpeciesKinetics[] {
  const wavelengths = Object.keys(fluenceDict).map(Number);
  const aerosolRows = rows.filter(r => r.medium === 'Aerosol');

  return speciesList.map(sp => {
    const speciesRows = aerosolRows.filter(r => r.species === sp);
    if (speciesRows.length === 0) return null;

    const irradList: number[] = [];
    const k1List: number[] = [];
    const k2List: number[] = [];
    const fList: number[] = [];
    const k1SemList: number[] = [];
    const nList: number[] = [];

    for (const wv of wavelengths) {
      const wvRows = speciesRows.filter(r => r.wavelength === wv);
      if (wvRows.length === 0) return null; // skip species if missing any wavelength

      const k1Values = wvRows.map(r => r.k1).filter(k => k > 0);
      if (k1Values.length === 0) return null;

      const n = k1Values.length;
      const meanK1 = k1Values.reduce((s, v) => s + v, 0) / n;
      const meanK2 = wvRows.reduce((s, r) => s + (r.k2 ?? 0), 0) / wvRows.length;
      const meanF = wvRows.reduce((s, r) => s + r.resistant_fraction, 0) / wvRows.length;

      let k1Sem = 0;
      if (n >= 2) {
        const variance = k1Values.reduce((s, v) => s + (v - meanK1) ** 2, 0) / (n - 1);
        k1Sem = Math.sqrt(variance / n);
      }

      irradList.push(fluenceDict[wv]);
      k1List.push(meanK1);
      k2List.push(meanK2);
      fList.push(meanF);
      k1SemList.push(k1Sem);
      nList.push(n);
    }

    return { species: sp, irradList, k1List, k2List, fList, k1SemList, nList };
  }).filter((x): x is SpeciesKinetics => x !== null);
}
