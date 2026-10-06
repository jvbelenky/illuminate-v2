import { describe, it, expect } from 'vitest';
import cases from './housingGeometry.cases.json';
import {
  housingMatrix, housingAimCorners, aimToHousingExtents, matchFileFrame,
  photometricDepthOf, centerOffset, emitterPosition, nextRoll, type HousingLayout
} from './housingGeometry';
import { axisMatrix, PHOTOMETRIC_AXES } from './photometricAxis';
import type { HousingFaceToken, HousingRoll, EmitterOffset } from '$lib/api/contract';

const close = (a: number[][], b: number[][]) =>
  a.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], 9)));

describe('housing geometry matches guv_calcs', () => {
  for (const c of cases) {
    const h: HousingLayout = {
      length: c.length, width: c.width, height: c.height,
      face: c.face as HousingFaceToken, roll: c.roll as HousingRoll, offset: c.offset as EmitterOffset,
    };
    it(`${c.face} roll ${c.roll} offset ${c.offset} s=${c.surface_height}`, () => {
      close(housingMatrix(h.face, h.roll), c.matrix);
      close(housingAimCorners(h, c.surface_height), c.corners);
      expect(photometricDepthOf(h.face, h.offset)).toBeCloseTo(c.depth, 9);
    });
  }
});

describe('matchFileFrame', () => {
  it.each(PHOTOMETRIC_AXES)('%s maps housing frame onto the file frame', (axis) => {
    const { face, roll } = matchFileFrame(axis);
    close(housingMatrix(face, roll), axisMatrix(axis));
  });
  it('down is the default layout', () => {
    expect(matchFileFrame('down')).toEqual({ face: 'bottom', roll: 0 });
  });
});

describe('helpers', () => {
  const h: HousingLayout = { length: 0.4, width: 0.2, height: 0.1, face: 'front', roll: 0, offset: [0, 0, 0] };
  it('centerOffset puts the emitter at the box center', () => {
    const p = emitterPosition({ ...h, offset: centerOffset(h) });
    p.forEach((v) => expect(v).toBeCloseTo(0, 12));
  });
  it('aimToHousingExtents inverts the rotation', () => {
    const e = aimToHousingExtents('front', 0, { length: 0.1, width: 0.2, height: 0.4 });
    expect(e).toEqual({ length: 0.4, width: 0.2, height: 0.1 });
  });
  it('nextRoll cycles', () => {
    expect([0, 90, 180, 270].map((r) => nextRoll(r as HousingRoll))).toEqual([90, 180, 270, 0]);
  });
});
