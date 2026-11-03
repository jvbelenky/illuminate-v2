import { validatePolygon, type Vertex } from '$lib/utils/roomGeometry';
import { UNIT_INFO, convertLength, type LengthUnit } from '$lib/utils/unitConversion';

/**
 * Set the length of segment `index` (vertex i to vertex i+1, in stored order).
 * Vertex i+1 and vertex i+2 move by the change along the segment's direction,
 * so the following wall keeps its angle and length (a rectangle stays a
 * rectangle). In a triangle vertex i+2 is the start's own neighbour, so only
 * vertex i+1 moves.
 * Returns null when the length is not positive or the result is not a valid
 * polygon (crossing edges, coinciding corners, negative coordinates).
 */
export function setSegmentLength(vertices: Vertex[], index: number, length: number): Vertex[] | null {
  const n = vertices.length;
  if (n < 3 || index < 0 || index >= n || !Number.isFinite(length) || length <= 0) return null;
  const i1 = (index + 1) % n;
  const i2 = (index + 2) % n;
  const a = vertices[index];
  const b = vertices[i1];
  const old = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (old < 1e-12) return null;
  const delta = length - old;
  const dx = ((b[0] - a[0]) / old) * delta;
  const dy = ((b[1] - a[1]) / old) * delta;
  const next = vertices.map((v) => [v[0], v[1]] as Vertex);
  const move = (k: number) => {
    next[k] = [round(next[k][0] + dx), round(next[k][1] + dy)];
  };
  move(i1);
  // A triangle has no wall to carry along: vertex i+2 is the one before i
  if (n > 3) move(i2);
  return validatePolygon(next) === null ? next : null;
}

function round(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}

/** Typed suffixes and the unit each one means. */
const SUFFIXES: Record<string, LengthUnit> = {
  ...Object.fromEntries(Object.values(UNIT_INFO).map((u) => [u.abbrev, u.label])),
  "'": 'feet',
  '"': 'inches',
};

const NUM = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
const PLAIN = new RegExp(`^${NUM}\\s*([a-z'"]*)$`);
const FEET_INCHES = new RegExp(`^${NUM}\\s*'\\s*${NUM}\\s*"?$`);

/**
 * A typed length in `units`: a plain number is already in `units`; a number
 * with a suffix (m, cm, mm, ft, in, ' or ") is converted, and 5'6" is feet and
 * inches. Returns null for anything else, and for zero or negative lengths.
 */
export function parseLengthInput(text: string, units: LengthUnit): number | null {
  const value = parseCoordinateInput(text, units);
  return value !== null && value > 0 ? value : null;
}

/**
 * A typed coordinate in `units`, read like `parseLengthInput` but zero and
 * negative values are allowed (-5'6" is minus five and a half feet).
 */
export function parseCoordinateInput(text: string, units: LengthUnit): number | null {
  const s = text.trim().toLowerCase();
  let value: number;
  const fi = FEET_INCHES.exec(s);
  if (fi) {
    const sign = fi[1].startsWith('-') ? -1 : 1;
    value = convertLength(parseFloat(fi[1]), 'feet', units) + sign * convertLength(parseFloat(fi[2]), 'inches', units);
  } else {
    const m = PLAIN.exec(s);
    if (!m) return null;
    const from = m[2] ? SUFFIXES[m[2]] : units;
    if (!from) return null;
    value = convertLength(parseFloat(m[1]), from, units);
  }
  return Number.isFinite(value) ? value : null;
}
