/**
 * Housing layout helpers, mirroring guv_calcs `Fixture` / `HousingFace`.
 *
 * Housing frame: x = housing length, y = width, z = height. The mount face is
 * the one against the wall or ceiling; the beam points away from it.
 * `housingMatrix` rotates housing-frame vectors into the aim frame (beam on
 * -z, mount on +z, emitter at the origin). Keep in step with guv_calcs/lamp/fixture.py; the shared cases in
 * housingGeometry.cases.json come from api/scripts/export_housing_cases.py.
 */
import type { EmitterOffset, HousingFaceToken, HousingRoll } from '$lib/api/contract';
import {
  applyMat3, axisMatrix, clean, mountingOf, mulMat3, rotY, rotZ, transposeMat3,
  type Extents, type Mat3, type PhotometricAxis, type Vec3
} from './photometricAxis';
import { unitAbbrev, type LengthUnit } from './unitConversion';

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
  offset: EmitterOffset | null;  // from the mounting point; null = emitter on the front face
}

/** Everything the fixture editor edits, in display units. */
export interface FixtureDraft {
  axis: PhotometricAxis;
  housingWidth?: number;
  housingLength?: number;
  housingHeight?: number;
  face: HousingFaceToken;
  roll: HousingRoll;
  offset: EmitterOffset | null;
}

export const DEFAULT_LAYOUT: Pick<FixtureDraft, 'face' | 'roll' | 'offset'> = { face: 'top', roll: 0, offset: null };

const NORMALS: Record<HousingFaceToken, Vec3> = {
  bottom: [0, 0, -1], top: [0, 0, 1], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 1, 0], right: [0, -1, 0],
};

function rotX(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

// Each rotation sends the mount face's outward normal to the aim frame's +z
const MOUNT_ROTATIONS: Record<HousingFaceToken, Mat3> = {
  top: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  bottom: clean(rotX(180)),
  front: clean(rotY(-90)),
  back: clean(rotY(90)),
  left: clean(rotX(90)),
  right: clean(rotX(-90)),
};

export function faceNormal(face: HousingFaceToken): Vec3 {
  return NORMALS[face];
}

export function housingMatrix(face: HousingFaceToken, roll: HousingRoll): Mat3 {
  return clean(mulMat3(rotZ(roll), MOUNT_ROTATIONS[face]));
}

function mountCenter(h: HousingLayout): Vec3 {
  const n = NORMALS[h.face];
  return [n[0] * h.length / 2 + 0, n[1] * h.width / 2 + 0, n[2] * h.height / 2 + 0];
}

/**
 * Emitter position in the housing frame, relative to the box center. By
 * default the luminous opening (depth `luminousHeight` along the mount
 * normal) sits flush with the front face.
 */
export function emitterPosition(h: HousingLayout, luminousHeight = 0): Vec3 {
  const m = mountCenter(h);
  if (h.offset == null) {
    const n = NORMALS[h.face];
    const d = Math.abs(luminousHeight) / 2;
    return [-m[0] + n[0] * d + 0, -m[1] + n[1] * d + 0, -m[2] + n[2] * d + 0];
  }
  const o = h.offset;
  return [m[0] + o[0], m[1] + o[1], m[2] + o[2]];
}

/** The explicit offset equal to the default spot (opening flush with the front face). */
export function frontOffset(h: HousingLayout, luminousHeight = 0): EmitterOffset {
  const m = mountCenter(h);
  const e = emitterPosition({ ...h, offset: null }, luminousHeight);
  return [e[0] - m[0] + 0, e[1] - m[1] + 0, e[2] - m[2] + 0];
}

/**
 * Housing box (lo, hi) in the aim frame, emitter at the origin, grown to
 * contain the luminous opening `luminous` = (length, width, height), aim frame.
 */
export function housingAimBounds(h: HousingLayout, luminous: Vec3 = [0, 0, 0]): { lo: Vec3; hi: Vec3 } {
  const lum = luminous.map((v) => Math.abs(v) / 2) as Vec3;
  const m = housingMatrix(h.face, h.roll);
  const e = emitterPosition(h, 2 * lum[2]);
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
  if (lum.some((v) => v > 0)) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], -lum[i]);
      hi[i] = Math.max(hi[i], lum[i]);
    }
  }
  // `+ 0` folds -0 into 0 so corners compare cleanly
  return { lo: lo.map((v) => v + 0) as Vec3, hi: hi.map((v) => v + 0) as Vec3 };
}

/** Eight corners in the aim frame, same order as guv_calcs `Fixture.aim_corners`. */
export function housingAimCorners(h: HousingLayout, luminous: Vec3 = [0, 0, 0]): number[][] {
  const { lo: [x0, y0, z0], hi: [x1, y1, z1] } = housingAimBounds(h, luminous);
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

/** The layout whose housing frame is the IES file's own frame (mount face opposite the beam). */
export function matchFileFrame(axis: PhotometricAxis): { face: HousingFaceToken; roll: HousingRoll } {
  const target = axisMatrix(axis);
  for (const face of HOUSING_FACES) {
    for (const roll of HOUSING_ROLLS) {
      const m = housingMatrix(face, roll);
      if (m.every((row, i) => row.every((v, j) => Math.abs(v - target[i][j]) < 1e-9))) return { face, roll };
    }
  }
  return { face: 'top', roll: 0 };
}

/** Distance from the front face back to the emitter (negative = emitter protrudes). */
export function photometricDepthOf(h: HousingLayout): number {
  const n = NORMALS[h.face];
  const e = emitterPosition(h);
  const m = mountCenter(h);
  return n[0] * (e[0] + m[0]) + n[1] * (e[1] + m[1]) + n[2] * (e[2] + m[2]) + 0;
}

/** Offset that puts the emitter at the center of the housing. */
export function centerOffset(h: HousingLayout): EmitterOffset {
  const m = mountCenter(h);
  return [-m[0] + 0, -m[1] + 0, -m[2] + 0];
}

export function nextRoll(roll: HousingRoll): HousingRoll {
  return HOUSING_ROLLS[(HOUSING_ROLLS.indexOf(roll) + 1) % HOUSING_ROLLS.length];
}

/** Light center's distance from the mounting surface (LM-63's D1 for a ceiling mount). */
export function mountDistance(h: HousingLayout, luminousHeight = 0): number {
  const n = NORMALS[h.face];
  const m = mountCenter(h);
  const e = emitterPosition(h, luminousHeight);
  return n[0] * (m[0] - e[0]) + n[1] * (m[1] - e[1]) + n[2] * (m[2] - e[2]) + 0;
}

/** Offset that puts the light center `distance` from the mount, keeping its sideways offset. */
export function offsetAtMountDistance(h: HousingLayout, luminousHeight: number, distance: number): EmitterOffset {
  const n = NORMALS[h.face];
  const shown = h.offset ?? frontOffset(h, luminousHeight);
  const along = shown[0] * n[0] + shown[1] * n[1] + shown[2] * n[2];
  return [0, 1, 2].map((i) => shown[i] - n[i] * along - n[i] * distance + 0) as EmitterOffset;
}

const fmtLength = (v: number) => String(parseFloat(v.toFixed(4)));

/** Plain-language summary of a fixture layout, for confirmations and collapsed views. */
export function fixtureSummary(
  h: HousingLayout, luminousHeight: number, axis: PhotometricAxis, units: LengthUnit
): { mounting: string; housing: string; lightCenter: string } {
  const where = mountingOf(axis);
  const u = unitAbbrev(units);
  const d = fmtLength(mountDistance(h, luminousHeight));
  const relation = where === 'ceiling' ? 'below the ceiling' : where === 'floor' ? 'above the floor' : 'from the wall';
  return {
    mounting: `Mounted on the ${where}`,
    housing: `${fmtLength(h.length)} × ${fmtLength(h.width)} × ${fmtLength(h.height)} ${u}`,
    lightCenter: `${d} ${u} ${relation}`,
  };
}
