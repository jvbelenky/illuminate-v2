/**
 * Tests for survival math utility.
 * Reference values validated against guv_calcs/efficacy/math.py.
 */

import { describe, it, expect } from 'vitest';
import {
  survivalFraction,
  secondsToS,
  logReductionTime,
  eachUV,
  survivalCurvePoints,
  averageKineticsBySpecies,
  LOG_LABELS
} from './survival-math';

// =============================================================================
// Single-wavelength (scalar) tests
// =============================================================================

describe('survivalFraction (single wavelength)', () => {
  it('returns 1 at t=0', () => {
    expect(survivalFraction(0, 5, 0.1, 0.01, 0.05)).toBe(1);
  });

  it('decays exponentially for single-compartment (f=0)', () => {
    // S(t) = exp(-k1 * irrad/1000 * t)
    // k1=0.1, irrad=10, t=100 → S = exp(-0.1 * 10/1000 * 100) = exp(-0.1) ≈ 0.9048
    const S = survivalFraction(100, 10, 0.1, 0, 0);
    expect(S).toBeCloseTo(Math.exp(-0.1), 6);
  });

  it('matches guv_calcs: single-compartment', () => {
    // guv_calcs: survival_fraction(100, 10, 0.1, 0, 0) = 0.904837418035960
    expect(survivalFraction(100, 10, 0.1, 0, 0)).toBeCloseTo(0.904837418035960, 10);
  });

  it('matches guv_calcs: two-compartment', () => {
    // guv_calcs: survival_fraction(200, 5, 0.5, 0.05, 0.1) = 0.641000536191441
    expect(survivalFraction(200, 5, 0.5, 0.05, 0.1)).toBeCloseTo(0.641000536191441, 10);
  });

  it('handles two-compartment model', () => {
    const irrad = 5;
    const k1 = 0.5;
    const k2 = 0.05;
    const f = 0.1;
    const t = 200;

    const k1Irrad = k1 * irrad / 1000;
    const k2Irrad = k2 * irrad / 1000;
    const expected = (1 - f) * Math.exp(-k1Irrad * t) + f * Math.exp(-k2Irrad * t);

    expect(survivalFraction(t, irrad, k1, k2, f)).toBeCloseTo(expected, 10);
  });

  it('approaches zero for large t', () => {
    const S = survivalFraction(100000, 10, 0.5, 0.01, 0.05);
    expect(S).toBeLessThan(1e-5);
  });
});

describe('secondsToS (single wavelength)', () => {
  it('matches guv_calcs: single-compartment', () => {
    // guv_calcs: seconds_to_S(0.01, 5, 0.1, 0, 0) = 9210.3403719762
    expect(secondsToS(0.01, 5, 0.1, 0, 0)).toBeCloseTo(9210.3403719762, 2);
  });

  it('matches guv_calcs: two-compartment', () => {
    // guv_calcs: seconds_to_S(0.01, 5, 0.5, 0.05, 0.1) = 9210.3404079762
    const t = secondsToS(0.01, 5, 0.5, 0.05, 0.1);
    expect(t).toBeCloseTo(9210.3404079762, 2);
  });

  it('computes analytical solution for single-compartment', () => {
    const irrad = 5;
    const k1 = 0.1;
    const S = 0.01;
    const expected = -Math.log(S) / (k1 * irrad / 1000);

    const result = secondsToS(S, irrad, k1, 0, 0);
    expect(result).toBeCloseTo(expected, 4);
  });

  it('returns Infinity for invalid inputs', () => {
    expect(secondsToS(0, 5, 0.1)).toBe(Infinity);
    expect(secondsToS(1, 5, 0.1)).toBe(Infinity);
    expect(secondsToS(0.5, 0, 0.1)).toBe(Infinity);
    expect(secondsToS(0.5, 5, 0)).toBe(Infinity);
  });

  it('handles two-compartment model via bisection', () => {
    const irrad = 5;
    const k1 = 0.5;
    const k2 = 0.05;
    const f = 0.1;
    const S = 0.01;

    const t = secondsToS(S, irrad, k1, k2, f);
    const actual = survivalFraction(t, irrad, k1, k2, f);
    expect(actual).toBeCloseTo(S, 6);
  });
});

describe('logReductionTime (single wavelength)', () => {
  it('log1 = time to 90% inactivation (S=0.1)', () => {
    const t = logReductionTime(1, 5, 0.1);
    const S = survivalFraction(t, 5, 0.1);
    expect(S).toBeCloseTo(0.1, 6);
  });

  it('log2 = time to 99% inactivation (S=0.01)', () => {
    const t = logReductionTime(2, 5, 0.1);
    const S = survivalFraction(t, 5, 0.1);
    expect(S).toBeCloseTo(0.01, 6);
  });

  it('log3 = time to 99.9% inactivation (S=0.001)', () => {
    const t = logReductionTime(3, 5, 0.1);
    const S = survivalFraction(t, 5, 0.1);
    expect(S).toBeCloseTo(0.001, 6);
  });

  it('two-compartment log reduction is correct', () => {
    const irrad = 5;
    const k1 = 0.5;
    const k2 = 0.05;
    const f = 0.1;

    for (const level of [1, 2, 3, 4, 5]) {
      const t = logReductionTime(level, irrad, k1, k2, f);
      const S = survivalFraction(t, irrad, k1, k2, f);
      expect(S).toBeCloseTo(Math.pow(10, -level), 5);
    }
  });
});

describe('eachUV (single wavelength)', () => {
  it('computes correctly for single-compartment', () => {
    expect(eachUV(5, 0.1)).toBeCloseTo(0.1 * 5 * 3.6, 6);
  });

  it('matches guv_calcs: two-compartment', () => {
    // guv_calcs: eACH_UV(5, 0.5, 0.05, 0.1) = 8.190000000000000
    expect(eachUV(5, 0.5, 0.05, 0.1)).toBeCloseTo(8.19, 6);
  });
});

describe('survivalCurvePoints (single wavelength)', () => {
  it('starts at S=1', () => {
    const points = survivalCurvePoints(5, 0.1);
    expect(points[0].t).toBe(0);
    expect(points[0].S).toBe(1);
  });

  it('generates requested number of points', () => {
    const points = survivalCurvePoints(5, 0.1, 0, 0, 50);
    expect(points).toHaveLength(51); // 0..50 inclusive
  });

  it('points are monotonically decreasing in S', () => {
    const points = survivalCurvePoints(5, 0.5, 0.05, 0.1);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].S).toBeLessThanOrEqual(points[i - 1].S);
    }
  });

  it('returns single point for zero irradiance', () => {
    const points = survivalCurvePoints(0, 0.1);
    expect(points).toHaveLength(1);
    expect(points[0].S).toBe(1);
  });

  it('ends near the target log reduction', () => {
    const points = survivalCurvePoints(5, 0.1, 0, 0, 200, 3);
    const lastS = points[points.length - 1].S;
    expect(lastS).toBeCloseTo(0.001, 3);
  });
});

// =============================================================================
// Multi-wavelength (array) tests — verified against guv_calcs
// =============================================================================

describe('survivalFraction (multi-wavelength)', () => {
  it('returns 1 at t=0', () => {
    // guv_calcs: survival_fraction(0, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]) = 1.0
    expect(survivalFraction(0, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02])).toBe(1);
  });

  it('returns 1 for empty arrays', () => {
    expect(survivalFraction(100, [], [], [], [])).toBe(1);
  });

  it('matches guv_calcs: two wavelengths', () => {
    // guv_calcs: survival_fraction(500, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]) = 0.937914267616294
    const S = survivalFraction(500, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]);
    expect(S).toBeCloseTo(0.937914267616294, 10);
  });

  it('matches guv_calcs: larger irradiances', () => {
    // guv_calcs: survival_fraction(60, [2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]) = 0.934580068347225
    const S = survivalFraction(60, [2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]);
    expect(S).toBeCloseTo(0.934580068347225, 10);
  });

  it('computes correct k1_irrad and f_eff', () => {
    // Manual: k1_irrad = 0.10*0.5/1000 + 0.08*1.0/1000 = 0.00013
    //         k2_irrad = 0.01*0.5/1000 + 0.008*1.0/1000 = 0.000013
    //         f_eff = (0.01 + 0.02) / 2 = 0.015
    //         S(500) = 0.985 * exp(-0.00013*500) + 0.015 * exp(-0.000013*500)
    const k1Irrad = 0.10 * 0.5 / 1000 + 0.08 * 1.0 / 1000;
    const k2Irrad = 0.01 * 0.5 / 1000 + 0.008 * 1.0 / 1000;
    const fEff = (0.01 + 0.02) / 2;
    const expected = (1 - fEff) * Math.exp(-k1Irrad * 500) + fEff * Math.exp(-k2Irrad * 500);
    expect(survivalFraction(500, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02])).toBeCloseTo(expected, 12);
  });

  it('single-element array matches scalar call', () => {
    const t = 200;
    const scalarS = survivalFraction(t, 5, 0.5, 0.05, 0.1);
    const arrayS = survivalFraction(t, [5], [0.5], [0.05], [0.1]);
    expect(arrayS).toBeCloseTo(scalarS, 10);
  });
});

describe('secondsToS (multi-wavelength)', () => {
  it('matches guv_calcs: two wavelengths to 99%', () => {
    // guv_calcs: seconds_to_S(0.01, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]) = 47880.8538784418
    const t = secondsToS(0.01, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]);
    expect(t).toBeCloseTo(47880.8538784418, 1);
  });

  it('survival at returned time equals target', () => {
    const t = secondsToS(0.01, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]);
    const S = survivalFraction(t, [0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]);
    expect(S).toBeCloseTo(0.01, 6);
  });

  it('matches guv_calcs: larger irradiances to 90%', () => {
    // guv_calcs: seconds_to_S(0.1, [2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]) = 2417.9082997471
    const t = secondsToS(0.1, [2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]);
    expect(t).toBeCloseTo(2417.9082997471, 1);
  });

  it('returns Infinity for empty arrays', () => {
    expect(secondsToS(0.01, [], [], [], [])).toBe(Infinity);
  });
});

describe('eachUV (multi-wavelength)', () => {
  it('matches guv_calcs: two wavelengths', () => {
    // guv_calcs: eACH_UV([0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]) = 0.461196
    const e = eachUV([0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]);
    expect(e).toBeCloseTo(0.461196, 6);
  });

  it('matches guv_calcs: larger irradiances', () => {
    // guv_calcs: eACH_UV([2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]) = 4.067280
    const e = eachUV([2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]);
    expect(e).toBeCloseTo(4.06728, 5);
  });

  it('is additive: sum of per-wavelength eACH values', () => {
    const e1 = eachUV(0.5, 0.10, 0.01, 0.01);
    const e2 = eachUV(1.0, 0.08, 0.008, 0.02);
    const eMulti = eachUV([0.5, 1.0], [0.10, 0.08], [0.01, 0.008], [0.01, 0.02]);
    expect(eMulti).toBeCloseTo(e1 + e2, 10);
  });
});

describe('logReductionTime (multi-wavelength)', () => {
  it('log reduction times are correct for multi-wavelength', () => {
    const irrad = [2.0, 3.0];
    const k1 = [0.3, 0.2];
    const k2 = [0.03, 0.02];
    const f = [0.05, 0.08];

    for (const level of [1, 2, 3]) {
      const t = logReductionTime(level, irrad, k1, k2, f);
      const S = survivalFraction(t, irrad, k1, k2, f);
      expect(S).toBeCloseTo(Math.pow(10, -level), 5);
    }
  });
});

describe('survivalCurvePoints (multi-wavelength)', () => {
  it('starts at S=1 for multi-wavelength', () => {
    const points = survivalCurvePoints([2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]);
    expect(points[0].t).toBe(0);
    expect(points[0].S).toBe(1);
  });

  it('points are monotonically decreasing', () => {
    const points = survivalCurvePoints([2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08]);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].S).toBeLessThanOrEqual(points[i - 1].S);
    }
  });

  it('ends near target log reduction', () => {
    const points = survivalCurvePoints([2.0, 3.0], [0.3, 0.2], [0.03, 0.02], [0.05, 0.08], 200, 2);
    const lastS = points[points.length - 1].S;
    expect(lastS).toBeCloseTo(0.01, 3);
  });
});

// =============================================================================
// averageKineticsBySpecies tests
// =============================================================================

describe('averageKineticsBySpecies', () => {
  const rows = [
    { species: 'Virus A', k1: 0.10, k2: 0.01, resistant_fraction: 0.02, medium: 'Aerosol', wavelength: 222 },
    { species: 'Virus A', k1: 0.12, k2: 0.015, resistant_fraction: 0.03, medium: 'Aerosol', wavelength: 222 },
    { species: 'Virus A', k1: 0.08, k2: 0.008, resistant_fraction: 0.01, medium: 'Aerosol', wavelength: 254 },
    { species: 'Virus A', k1: 0.09, k2: 0.009, resistant_fraction: 0.02, medium: 'Aerosol', wavelength: 254 },
    { species: 'Virus B', k1: 0.20, k2: 0.02, resistant_fraction: 0.05, medium: 'Aerosol', wavelength: 222 },
    { species: 'Virus B', k1: 0.05, k2: null, resistant_fraction: 0.0, medium: 'Aerosol', wavelength: 254 },
    { species: 'Virus C', k1: 0.15, k2: 0.01, resistant_fraction: 0.03, medium: 'Aerosol', wavelength: 222 },
    // Virus C has no 254nm data — should be skipped in multi-wavelength
    { species: 'Virus A', k1: 0.50, k2: 0.05, resistant_fraction: 0.10, medium: 'Surface', wavelength: 222 },
    // Surface rows should be filtered out
  ];

  it('single wavelength: averages k1, k2, f correctly', () => {
    const result = averageKineticsBySpecies(rows, ['Virus A'], { 222: 5.0 });
    expect(result).toHaveLength(1);
    const sp = result[0];
    expect(sp.species).toBe('Virus A');
    expect(sp.irradList).toEqual([5.0]);
    expect(sp.k1List[0]).toBeCloseTo((0.10 + 0.12) / 2, 10);
    expect(sp.k2List[0]).toBeCloseTo((0.01 + 0.015) / 2, 10);
    expect(sp.fList[0]).toBeCloseTo((0.02 + 0.03) / 2, 10);
  });

  it('single wavelength: computes SEM correctly', () => {
    const result = averageKineticsBySpecies(rows, ['Virus A'], { 222: 5.0 });
    const sp = result[0];
    const mean = (0.10 + 0.12) / 2;
    const variance = ((0.10 - mean) ** 2 + (0.12 - mean) ** 2) / 1;
    const sem = Math.sqrt(variance / 2);
    expect(sp.k1SemList[0]).toBeCloseTo(sem, 10);
    expect(sp.nList[0]).toBe(2);
  });

  it('multi-wavelength: returns per-wavelength data', () => {
    const result = averageKineticsBySpecies(rows, ['Virus A'], { 222: 2.0, 254: 3.0 });
    expect(result).toHaveLength(1);
    const sp = result[0];
    expect(sp.irradList).toEqual([2.0, 3.0]);
    expect(sp.k1List).toHaveLength(2);
    expect(sp.k1List[0]).toBeCloseTo((0.10 + 0.12) / 2, 10); // 222nm
    expect(sp.k1List[1]).toBeCloseTo((0.08 + 0.09) / 2, 10); // 254nm
  });

  it('multi-wavelength: skips species missing a wavelength', () => {
    const result = averageKineticsBySpecies(rows, ['Virus A', 'Virus C'], { 222: 2.0, 254: 3.0 });
    // Virus C has no 254nm data, should be skipped
    expect(result).toHaveLength(1);
    expect(result[0].species).toBe('Virus A');
  });

  it('filters out non-Aerosol rows', () => {
    // Virus A has a Surface row that should be excluded
    const result = averageKineticsBySpecies(rows, ['Virus A'], { 222: 5.0 });
    expect(result[0].k1List[0]).toBeCloseTo((0.10 + 0.12) / 2, 10);
    // Surface row k1=0.50 should NOT be included
  });

  it('handles null k2 as 0', () => {
    const result = averageKineticsBySpecies(rows, ['Virus B'], { 254: 5.0 });
    expect(result).toHaveLength(1);
    expect(result[0].k2List[0]).toBe(0); // null k2 treated as 0
  });
});

// =============================================================================
// Misc
// =============================================================================

describe('LOG_LABELS', () => {
  it('has correct labels', () => {
    expect(LOG_LABELS[1]).toBe('90%');
    expect(LOG_LABELS[2]).toBe('99%');
    expect(LOG_LABELS[3]).toBe('99.9%');
    expect(LOG_LABELS[4]).toBe('99.99%');
    expect(LOG_LABELS[5]).toBe('99.999%');
  });
});
