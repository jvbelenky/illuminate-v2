/**
 * Housing layout helpers, mirroring guv_calcs `Fixture` / `HousingFace`.
 *
 * Housing frame: x = housing length, y = width, z = height. `housingMatrix`
 * rotates housing-frame vectors into the aim frame (beam on -z, emitter at the
 * origin). Keep in step with guv_calcs/lamp/fixture.py; the shared cases in
 * housingGeometry.cases.json come from api/scripts/export_housing_cases.py.
 */
import type { EmitterOffset, HousingFaceToken, HousingRoll } from '$lib/api/contract';
import {
  applyMat3, axisMatrix, clean, mulMat3, rotY, rotZ, transposeMat3,
  type Extents, type Mat3, type PhotometricAxis, type Vec3
} from './photometricAxis';

export const HOUSING_FACES: readonly HousingFaceToken[] = ['bottom', 'top', 'front', 'back', 'left', 'right'];
export const HOUSING_ROLLS: readonly HousingRoll[] = [0, 90, 180, 270];

export const FACE_LABELS: Record<HousingFaceToken, string> = {
  bottom: 'Bottom', top: 'Top', front: 'Front', back: 'Back', left: 'Left', right: 'Right',
};

export interface HousingLayout {
  length: number;
  width: number;
  height: number;
  face: HousingFaceToken;
  roll: HousingRoll;
  offset: EmitterOffset;
}

/** Everything the fixture editor edits, in display units. */
export interface FixtureDraft {
  axis: PhotometricAxis;
  housingWidth?: number;
  housingLength?: number;
  housingHeight?: number;
  face: HousingFaceToken;
  roll: HousingRoll;
  offset: EmitterOffset;
}

export const DEFAULT_LAYOUT: Pick<FixtureDraft, 'face' | 'roll' | 'offset'> = { face: 'bottom', roll: 0, offset: [0, 0, 0] };

const NORMALS: Record<HousingFaceToken, Vec3> = {
  bottom: [0, 0, -1], top: [0, 0, 1], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0],
};

function rotX(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

const FACE_ROTATIONS: Record<HousingFaceToken, Mat3> = {
  bottom: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  top: clean(rotX(180)),
  front: clean(rotY(90)),
  back: clean(rotY(-90)),
  left: clean(rotX(-90)),
  right: clean(rotX(90)),
};

export function faceNormal(face: HousingFaceToken): Vec3 {
  return NORMALS[face];
}

export function housingMatrix(face: HousingFaceToken, roll: HousingRoll): Mat3 {
  return clean(mulMat3(rotZ(roll), FACE_ROTATIONS[face]));
}

export function emitterPosition(h: HousingLayout): Vec3 {
  const n = NORMALS[h.face];
  const half: Vec3 = [h.length / 2, h.width / 2, h.height / 2];
  return [0, 1, 2].map((i) => n[i] * half[i] + h.offset[i]) as Vec3;
}

export function housingAimBounds(h: HousingLayout, surfaceHeight = 0): { lo: Vec3; hi: Vec3 } {
  const m = housingMatrix(h.face, h.roll);
  const e = emitterPosition(h);
  const half: Vec3 = [h.length / 2, h.width / 2, h.height / 2];
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = applyMat3(m, [sx * half[0] - e[0], sy * half[1] - e[1], sz * half[2] - e[2]]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  if (surfaceHeight > 0) {
    lo[2] = Math.min(lo[2], -surfaceHeight / 2);
    hi[2] = Math.max(hi[2], surfaceHeight / 2);
  }
  // `+ 0` folds -0 into 0 so corners compare cleanly
  return { lo: lo.map((v) => v + 0) as Vec3, hi: hi.map((v) => v + 0) as Vec3 };
}

/** Eight corners in the aim frame, same order as guv_calcs `Fixture.aim_corners`. */
export function housingAimCorners(h: HousingLayout, surfaceHeight = 0): number[][] {
  const { lo: [x0, y0, z0], hi: [x1, y1, z1] } = housingAimBounds(h, surfaceHeight);
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
}

/** Map aim-frame extents onto housing (length, width, height). */
export function aimToHousingExtents(face: HousingFaceToken, roll: HousingRoll, e: Extents): Extents {
  const mt = transposeMat3(housingMatrix(face, roll)).map((r) => r.map(Math.abs)) as Mat3;
  const [length, width, height] = applyMat3(mt, [e.length, e.width, e.height]);
  return { length, width, height };
}

/** The layout whose housing frame is the IES file's own frame. */
export function matchFileFrame(axis: PhotometricAxis): { face: HousingFaceToken; roll: HousingRoll } {
  const target = axisMatrix(axis);
  for (const face of HOUSING_FACES) {
    for (const roll of HOUSING_ROLLS) {
      const m = housingMatrix(face, roll);
      if (m.every((row, i) => row.every((v, j) => Math.abs(v - target[i][j]) < 1e-9))) return { face, roll };
    }
  }
  return { face: 'bottom', roll: 0 };
}

/** Offset along the face's inward normal (negative = emitter protrudes). */
export function photometricDepthOf(face: HousingFaceToken, offset: EmitterOffset): number {
  const n = NORMALS[face];
  return -(n[0] * offset[0] + n[1] * offset[1] + n[2] * offset[2]) + 0;
}

/** Offset that puts the emitter at the center of the housing. */
export function centerOffset(h: HousingLayout): EmitterOffset {
  const n = NORMALS[h.face];
  return [-n[0] * h.length / 2 + 0, -n[1] * h.width / 2 + 0, -n[2] * h.height / 2 + 0];
}

export function nextRoll(roll: HousingRoll): HousingRoll {
  return HOUSING_ROLLS[(HOUSING_ROLLS.indexOf(roll) + 1) % HOUSING_ROLLS.length];
}
