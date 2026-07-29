import { describe, it, expect } from 'vitest';
import { lampLocalToThree, luminousOpeningPlaneArgs } from './fixturePreviewGeometry';

/**
 * Real Sterilray Germbuster Sabre dimensions, as reported by guv_calcs:
 *   surface length = 0.05 m (lamp-local X), surface width = 0.30 m (lamp-local Y)
 *   housing length = 0.10 m (lamp-local X), housing width = 0.60 m (lamp-local Y)
 */
const SOURCE_LENGTH = 0.05;
const SOURCE_WIDTH = 0.3;
const HOUSING_LENGTH = 0.1;
const HOUSING_WIDTH = 0.6;

/** `toEqual` distinguishes -0 from 0; the axis flip legitimately produces -0. */
const axes = (p: number[]) => lampLocalToThree(p).map((v) => v + 0);

describe('lampLocalToThree', () => {
  it('maps lamp-local +X (fixture length) to Three.js +X', () => {
    expect(axes([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it('maps lamp-local +Y (fixture width) to Three.js -Z', () => {
    expect(axes([0, 1, 0])).toEqual([0, 0, -1]);
  });

  it('maps lamp-local +Z (away from aim) to Three.js +Y', () => {
    expect(axes([0, 0, 1])).toEqual([0, 1, 0]);
  });
});

describe('luminousOpeningPlaneArgs', () => {
  it('spans the source length along the plane axis that becomes Three.js X', () => {
    const [alongThreeX] = luminousOpeningPlaneArgs(SOURCE_WIDTH, SOURCE_LENGTH);
    expect(alongThreeX).toBe(SOURCE_LENGTH);
  });

  it('spans the source width along the plane axis that becomes Three.js Z', () => {
    const [, alongThreeZ] = luminousOpeningPlaneArgs(SOURCE_WIDTH, SOURCE_LENGTH);
    expect(alongThreeZ).toBe(SOURCE_WIDTH);
  });

  it('stays aligned with the fixture housing wireframe rather than crossing it', () => {
    // Housing corners as guv_calcs emits them: ±length/2 on local X, ±width/2 on local Y.
    const corners = [
      [-HOUSING_LENGTH / 2, -HOUSING_WIDTH / 2, 0],
      [HOUSING_LENGTH / 2, HOUSING_WIDTH / 2, 0],
    ].map(lampLocalToThree);
    const housingExtentX = Math.abs(corners[1][0] - corners[0][0]);
    const housingExtentZ = Math.abs(corners[1][2] - corners[0][2]);

    const [planeExtentX, planeExtentZ] = luminousOpeningPlaneArgs(SOURCE_WIDTH, SOURCE_LENGTH);

    // The opening is smaller than its housing on both axes; a 90-degree
    // mismatch makes the plane overhang the housing on one of them.
    expect(planeExtentX).toBeLessThanOrEqual(housingExtentX);
    expect(planeExtentZ).toBeLessThanOrEqual(housingExtentZ);
  });
});
