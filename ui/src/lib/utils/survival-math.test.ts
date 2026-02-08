/**
 * Tests for survival math utility.
 * Values validated against guv_calcs/efficacy/math.py.
 */

import { describe, it, expect } from 'vitest';
import {
  survivalFraction,
  secondsToS,
  logReductionTime,
  eachUV,
  survivalCurvePoints,
  LOG_LABELS
} from './survival-math';

describe('survivalFraction', () => {
  it('returns 1 at t=0', () => {
    expect(survivalFraction(0, 5, 0.1, 0.01, 0.05)).toBe(1);
  });

  it('decays exponentially for single-compartment (f=0)', () => {
    // S(t) = exp(-k1 * irrad/1000 * t)
    // k1=0.1, irrad=10, t=100 → S = exp(-0.1 * 10/1000 * 100) = exp(-0.1) ≈ 0.9048
    const S = survivalFraction(100, 10, 0.1, 0, 0);
    expect(S).toBeCloseTo(Math.exp(-0.1), 6);
  });

  it('handles two-compartment model', () => {
    // S(t) = (1-f)*exp(-k1*irrad/1000*t) + f*exp(-k2*irrad/1000*t)
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

describe('secondsToS', () => {
  it('computes analytical solution for single-compartment', () => {
    // S = exp(-k1*irrad/1000*t) → t = -ln(S) / (k1*irrad/1000)
    const irrad = 5;
    const k1 = 0.1;
    const S = 0.01; // 99% inactivation
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

  it('bisection agrees with analytical for single-compartment', () => {
    const irrad = 5;
    const k1 = 0.3;
    const S = 0.001;
    const analytical = -Math.log(S) / (k1 * irrad / 1000);

    // Force bisection by providing k2 and f very close to 0
    const result = secondsToS(S, irrad, k1, 0, 0);
    expect(result).toBeCloseTo(analytical, 2);
  });

  it('handles two-compartment model via bisection', () => {
    const irrad = 5;
    const k1 = 0.5;
    const k2 = 0.05;
    const f = 0.1;
    const S = 0.01;

    const t = secondsToS(S, irrad, k1, k2, f);
    // Verify: survivalFraction at returned t should equal S
    const actual = survivalFraction(t, irrad, k1, k2, f);
    expect(actual).toBeCloseTo(S, 6);
  });
});

describe('logReductionTime', () => {
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

describe('eachUV', () => {
  it('computes correctly for single-compartment', () => {
    // eACH = k1 * irrad * 3.6 when f=0
    expect(eachUV(5, 0.1)).toBeCloseTo(0.1 * 5 * 3.6, 6);
  });

  it('computes correctly for two-compartment', () => {
    // eACH = (k1*(1-f) + k2*f) * irrad * 3.6
    const irrad = 5;
    const k1 = 0.5;
    const k2 = 0.05;
    const f = 0.1;
    const expected = (k1 * (1 - f) + k2 * f) * irrad * 3.6;
    expect(eachUV(irrad, k1, k2, f)).toBeCloseTo(expected, 6);
  });
});

describe('survivalCurvePoints', () => {
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

describe('LOG_LABELS', () => {
  it('has correct labels', () => {
    expect(LOG_LABELS[1]).toBe('90%');
    expect(LOG_LABELS[2]).toBe('99%');
    expect(LOG_LABELS[3]).toBe('99.9%');
    expect(LOG_LABELS[4]).toBe('99.99%');
    expect(LOG_LABELS[5]).toBe('99.999%');
  });
});
