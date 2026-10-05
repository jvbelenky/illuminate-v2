/**
 * Photometric axis helpers, mirroring guv_calcs `PhotometricAxis`.
 *
 * Frames: the IES frame puts theta=0 on -z, theta=90/phi=0 on +x and the
 * zenith on +z. The aim frame has -z = aim, +z = behind the surface, +x =
 * fixture length. `axisMatrix` rotates IES-frame vectors into the aim frame.
 * Keep the matrices in step with guv_calcs/lamp/photometric_axis.py.
 */

export const PHOTOMETRIC_AXES = ['down', 'up', 'horizontal_0', 'horizontal_90', 'horizontal_180', 'horizontal_270'] as const;
export type PhotometricAxis = (typeof PHOTOMETRIC_AXES)[number];

export const AXIS_LABELS: Record<PhotometricAxis, string> = {
  down: 'Down',
  up: 'Up',
  horizontal_0: '0°',
  horizontal_90: '90°',
  horizontal_180: '180°',
  horizontal_270: '270°',
};

/** The three mounting choices the picker offers; the four horizontals share one. */
export type AxisGroup = 'down' | 'up' | 'sideways';

export const HORIZONTAL_AXES = ['horizontal_0', 'horizontal_90', 'horizontal_180', 'horizontal_270'] as const;

export function axisGroup(axis: PhotometricAxis): AxisGroup {
  return axis === 'down' || axis === 'up' ? axis : 'sideways';
}

/** Horizontal axis with the most power; ties and missing scores resolve to 0°. */
export function bestHorizontal(scores: Record<string, number>): PhotometricAxis {
  let best: PhotometricAxis = 'horizontal_0';
  let bestScore = -Infinity;
  for (const a of HORIZONTAL_AXES) {
    const s = scores[a] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export function isPhotometricAxis(v: unknown): v is PhotometricAxis {
  return typeof v === 'string' && (PHOTOMETRIC_AXES as readonly string[]).includes(v);
}

function phiOf(axis: PhotometricAxis): number {
  return Number(axis.split('_')[1]);
}

function rotY(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function rotZ(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r as Mat3;
}

function clean(m: Mat3): Mat3 {
  return m.map((row) => row.map((v) => (Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e12) / 1e12))) as Mat3;
}

export function transposeMat3(m: Mat3): Mat3 {
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Unit beam direction in the IES frame. */
export function axisDirection(axis: PhotometricAxis): Vec3 {
  if (axis === 'down') return [0, 0, -1];
  if (axis === 'up') return [0, 0, 1];
  const p = (phiOf(axis) * Math.PI) / 180;
  return [Math.cos(p), Math.sin(p), 0];
}

/** Rotation taking IES-frame vectors into the aim frame (beam -> -z). */
export function axisMatrix(axis: PhotometricAxis): Mat3 {
  if (axis === 'down') return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (axis === 'up') return clean(rotY(180));
  return clean(mulMat3(rotY(90), rotZ(-phiOf(axis))));
}

/** Nearest of the six axes to an IES-frame direction. */
export function snapToAxis(dir: Vec3): PhotometricAxis {
  let best: PhotometricAxis = 'down';
  let bestDot = -Infinity;
  const n = Math.hypot(...dir) || 1;
  for (const axis of PHOTOMETRIC_AXES) {
    const d = axisDirection(axis);
    const dot = (dir[0] * d[0] + dir[1] * d[1] + dir[2] * d[2]) / n;
    if (dot > bestDot) {
      bestDot = dot;
      best = axis;
    }
  }
  return best;
}

export interface Extents {
  length: number;
  width: number;
  height: number;
}

/** Map IES (x, y, z) extents onto aim-frame (length, width, height). */
export function permuteExtents(axis: PhotometricAxis, e: Extents): Extents {
  const m = axisMatrix(axis);
  const abs = m.map((r) => r.map(Math.abs)) as Mat3;
  const [length, width, height] = applyMat3(abs, [e.length, e.width, e.height]);
  return { length, width, height };
}

export interface FixtureBoundsInput {
  housingWidth: number;
  housingLength: number;
  housingHeight: number;
  surfaceHeight: number;
  depth: number;
}

/**
 * Eight housing-box corners in the guv_calcs local frame, same order and
 * formula as `LampGeometry.get_bounding_box_corners`: corners 0-3 at z_min,
 * 4-7 at z_max; z_min = min(-d, -s/2), z_max = max(h - d, s/2).
 */
export function fixtureBoundsLocal(i: FixtureBoundsInput): number[][] {
  const hl = i.housingLength / 2;
  const hw = i.housingWidth / 2;
  const s = i.surfaceHeight / 2;
  // `+ 0` folds -0 into 0 so corners compare cleanly
  const zMin = Math.min(-i.depth, -s) + 0;
  const zMax = Math.max(i.housingHeight - i.depth, s) + 0;
  return [
    [-hl, -hw, zMin], [hl, -hw, zMin], [hl, hw, zMin], [-hl, hw, zMin],
    [-hl, -hw, zMax], [hl, -hw, zMax], [hl, hw, zMax], [-hl, hw, zMax],
  ];
}

export function centeredDepth(housingHeight: number): number {
  return housingHeight / 2;
}

/**
 * Conjugate a guv_calcs-frame rotation by the guv -> Three axis swap
 * (x, y, z) -> (x, z, -y) so it can drive a Three.js group.
 */
export function guvToThreeMatrix(m: Mat3): Mat3 {
  const S: Mat3 = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const Sinv: Mat3 = transposeMat3(S);
  return clean(mulMat3(mulMat3(S, m), Sinv));
}
