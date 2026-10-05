import { describe, it, expect } from 'vitest';
import {
  PHOTOMETRIC_AXES, axisDirection, axisMatrix, applyMat3, transposeMat3, snapToAxis,
  permuteExtents, fixtureBoundsLocal, centeredDepth, axisReadout, guvToThreeMatrix,
} from './photometricAxis';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('axisMatrix', () => {
  it('sends each beam direction to -z', () => {
    for (const axis of PHOTOMETRIC_AXES) close(applyMat3(axisMatrix(axis), axisDirection(axis)), [0, 0, -1]);
  });
  it('sends the zenith to local +x for horizontal axes', () => {
    close(applyMat3(axisMatrix('horizontal_0'), [0, 0, 1]), [1, 0, 0]);
    close(applyMat3(axisMatrix('horizontal_270'), [0, 0, 1]), [1, 0, 0]);
  });
  it('transpose inverts', () => {
    const m = axisMatrix('horizontal_90');
    close(applyMat3(transposeMat3(m), applyMat3(m, [0.3, -0.2, 0.9])), [0.3, -0.2, 0.9]);
  });
});

describe('snapToAxis', () => {
  it('picks the nearest axis by angle', () => {
    expect(snapToAxis([0.1, 0.05, -1])).toBe('down');
    expect(snapToAxis([1, 0.2, 0.1])).toBe('horizontal_0');
    expect(snapToAxis([-0.2, -1, 0])).toBe('horizontal_270');
    expect(snapToAxis([0, 0, 1])).toBe('up');
  });
});

describe('permuteExtents', () => {
  it('matches guv_calcs for horizontal_0', () => {
    expect(permuteExtents('horizontal_0', { length: 1.26, width: 1.94, height: 0.42 })).toEqual({ length: 0.42, width: 1.94, height: 1.26 });
  });
  it('is identity for down', () => {
    expect(permuteExtents('down', { length: 1, width: 2, height: 3 })).toEqual({ length: 1, width: 2, height: 3 });
  });
});

describe('fixtureBoundsLocal', () => {
  const zs = (c: number[][]) => [Math.min(...c.map((p) => p[2])), Math.max(...c.map((p) => p[2]))];
  it('matches guv_calcs: face at point, housing behind', () => {
    const c = fixtureBoundsLocal({ housingWidth: 0.12, housingLength: 0.12, housingHeight: 0.08, surfaceHeight: 0, depth: 0 });
    expect(c).toHaveLength(8);
    expect(zs(c)).toEqual([0, 0.08]);
    expect(c[0]).toEqual([-0.06, -0.06, 0]);
  });
  it('centers a luminous volume', () => {
    expect(zs(fixtureBoundsLocal({ housingWidth: 0.58, housingLength: 0.58, housingHeight: 0, surfaceHeight: 0.12, depth: 0 }))).toEqual([-0.06, 0.06]);
  });
  it('slides with depth', () => {
    expect(zs(fixtureBoundsLocal({ housingWidth: 0.1, housingLength: 0.1, housingHeight: 0.12, surfaceHeight: 0, depth: 0.06 }))).toEqual([-0.06, 0.06]);
  });
});

describe('misc', () => {
  it('centeredDepth is half the housing height', () => expect(centeredDepth(0.12)).toBeCloseTo(0.06));
  it('readout names the direction', () => {
    expect(axisReadout('down')).toMatch(/straight down/i);
    expect(axisReadout('horizontal_0')).toMatch(/0°/);
    expect(axisReadout('horizontal_0')).toMatch(/wall/i);
  });
  it('guvToThreeMatrix maps the horizontal beam to Three -y', () => {
    // ies +x is Three +x; after rotation it must point down (Three -y)
    close(applyMat3(guvToThreeMatrix(axisMatrix('horizontal_0')), [1, 0, 0]), [0, -1, 0]);
    close(applyMat3(guvToThreeMatrix(axisMatrix('down')), [0.2, 0.3, 0.4]), [0.2, 0.3, 0.4]);
  });
});
