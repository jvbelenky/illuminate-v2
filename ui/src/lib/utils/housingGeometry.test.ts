import { describe, it, expect } from 'vitest';
import cases from './housingGeometry.cases.json';
import {
  housingMatrix, housingAimCorners, aimToHousingExtents, matchFileFrame,
  photometricDepthOf, centerOffset, frontOffset, emitterPosition, housingAimBounds, nextRoll, formatExtents,
  mountDistance, offsetAtMountDistance, fixtureSummary, aimAxisOf, type HousingLayout
} from './housingGeometry';
import { axisMatrix, PHOTOMETRIC_AXES, type Vec3 } from './photometricAxis';
import type { HousingFaceToken, HousingRoll, EmitterOffset } from '$lib/api/contract';

const close = (a: number[][], b: number[][]) =>
  a.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(b[i][j], 9)));

describe('housing geometry matches guv_calcs', () => {
  for (const c of cases) {
    const h: HousingLayout = {
      length: c.length, width: c.width, height: c.height,
      face: c.face as HousingFaceToken, roll: c.roll as HousingRoll, offset: c.offset as EmitterOffset | null,
    };
    it(`${c.face} roll ${c.roll} offset ${c.offset} luminous=${c.luminous}`, () => {
      close(housingMatrix(h.face, h.roll), c.matrix);
      close(housingAimCorners(h, c.luminous as Vec3), c.corners);
      close([emitterPosition(h, c.luminous[2])], [c.emitter]);
      expect(photometricDepthOf(h)).toBeCloseTo(c.depth, 9);
    });
  }
});

describe('matchFileFrame', () => {
  it.each(PHOTOMETRIC_AXES)('%s maps housing frame onto the file frame', (axis) => {
    const { face, roll } = matchFileFrame(axis);
    close(housingMatrix(face, roll), axisMatrix(axis));
  });
  it('a downlight mounts by its top, the default layout', () => {
    expect(matchFileFrame('down')).toEqual({ face: 'top', roll: 0 });
  });
  it('a wall sheet toward 0 deg mounts by its back', () => {
    expect(matchFileFrame('horizontal_0')).toEqual({ face: 'back', roll: 0 });
  });
});

describe('helpers', () => {
  const h: HousingLayout = { length: 0.4, width: 0.2, height: 0.1, face: 'back', roll: 0, offset: null };
  it('the default offset puts the emitter on the front face', () => {
    expect(emitterPosition(h)).toEqual([0.2, 0, 0]);
    expect(frontOffset(h)).toEqual([0.4, 0, 0]);
    expect(emitterPosition({ ...h, offset: frontOffset(h) })).toEqual([0.2, 0, 0]);
    expect(photometricDepthOf(h)).toBe(0);
  });
  it('an explicit offset is measured from the mounting point', () => {
    emitterPosition({ ...h, offset: [0.05, 0, 0] }).forEach((v, i) => expect(v).toBeCloseTo([-0.15, 0, 0][i], 12));
    expect(photometricDepthOf({ ...h, offset: [0.05, 0, 0] })).toBeCloseTo(0.35, 12);
  });
  it('a 3D luminous opening sits flush with the front face by default', () => {
    const box: HousingLayout = { length: 0.58, width: 0.58, height: 0.12, face: 'top', roll: 0, offset: null };
    emitterPosition(box, 0.12).forEach((v) => expect(v).toBeCloseTo(0, 12));
    expect(frontOffset(box, 0.12)[2]).toBeCloseTo(-0.06, 12);
  });
  it('the housing box grows to contain the luminous opening', () => {
    const small: HousingLayout = { length: 0.1, width: 0.1, height: 0.05, face: 'top', roll: 0, offset: null };
    const { lo, hi } = housingAimBounds(small, [0.4, 0.3, 0]);
    expect([lo[0], hi[0], lo[1], hi[1]]).toEqual([-0.2, 0.2, -0.15, 0.15]);
  });
  it('centerOffset puts the emitter at the box center', () => {
    const p = emitterPosition({ ...h, offset: centerOffset(h) });
    p.forEach((v) => expect(v).toBeCloseTo(0, 12));
  });
  it('aimToHousingExtents inverts the rotation', () => {
    const e = aimToHousingExtents('back', 0, { length: 0.1, width: 0.2, height: 0.4 });
    expect(e).toEqual({ length: 0.4, width: 0.2, height: 0.1 });
  });
  it('formatExtents writes L × W × H with the unit', () => {
    expect(formatExtents({ length: 0.58, width: 0.58, height: 0.12 }, 'meters')).toBe('0.58 × 0.58 × 0.12 m');
    expect(formatExtents({ length: 6, width: 4.5, height: 0 }, 'centimeters')).toBe('6 × 4.5 × 0 cm');
  });

  it('nextRoll cycles', () => {
    expect([0, 90, 180, 270].map((r) => nextRoll(r as HousingRoll))).toEqual([90, 180, 270, 0]);
  });
});

describe('mount distance and summary', () => {
  const uvflow: HousingLayout = { length: 0.58, width: 0.58, height: 0.12, face: 'top', roll: 0, offset: null };
  it('measures the light center from the mounting surface', () => {
    expect(mountDistance(uvflow, 0.12)).toBeCloseTo(0.06, 12);
    expect(mountDistance({ ...uvflow, offset: [0, 0, -0.02] }, 0.12)).toBeCloseTo(0.02, 12);
  });
  it('moving to a distance keeps the sideways offset', () => {
    const o = offsetAtMountDistance({ ...uvflow, offset: [0.03, -0.01, -0.02] }, 0.12, 0.05);
    [0.03, -0.01, -0.05].forEach((v, i) => expect(o[i]).toBeCloseTo(v, 12));
  });
  it('summarizes the fixture in words', () => {
    expect(fixtureSummary(uvflow, 0.12, 'down', 'meters')).toEqual({
      mounting: 'Mounted on the ceiling',
      housing: '0.58 × 0.58 × 0.12 m',
      lightCenter: '0.06 m from mounting point',
    });
    const wall: HousingLayout = { length: 0.0884, width: 0.3627, height: 0.1006, face: 'back', roll: 0, offset: null };
    expect(fixtureSummary(wall, 0.0884, 'horizontal_0', 'meters').lightCenter).toBe('0.0442 m from mounting point');
    expect(fixtureSummary(uvflow, 0, 'up', 'meters').mounting).toBe('Mounted on the floor');
  });
});

describe('aimAxisOf', () => {
  it('pairs each housing axis with the aim axis it lies along', () => {
    expect([0, 1, 2].map((i) => aimAxisOf('top', 0, i as 0 | 1 | 2))).toEqual([0, 1, 2]);
    // back face on the wall: housing L (x) runs along the beam (aim z)
    expect([0, 1, 2].map((i) => aimAxisOf('back', 0, i as 0 | 1 | 2))).toEqual([2, 1, 0]);
    expect([0, 1, 2].map((i) => aimAxisOf('top', 90, i as 0 | 1 | 2))).toEqual([1, 0, 2]);
  });
});
