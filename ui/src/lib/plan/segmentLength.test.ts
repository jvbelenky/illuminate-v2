import { describe, it, expect } from 'vitest';
import { setSegmentLength, parseLengthInput } from './segmentLength';
import { polygonEdgeLengths, type Vertex } from '$lib/utils/roomGeometry';

const rect: Vertex[] = [[0, 0], [6, 0], [6, 4], [0, 4]];

function close(a: Vertex[] | null, b: Vertex[]) {
  expect(a).not.toBeNull();
  expect(a!).toHaveLength(b.length);
  a!.forEach((v, i) => {
    expect(v[0]).toBeCloseTo(b[i][0], 9);
    expect(v[1]).toBeCloseTo(b[i][1], 9);
  });
}

describe('setSegmentLength', () => {
  it('rectangle: each side keeps the rectangle', () => {
    close(setSegmentLength(rect, 0, 8), [[0, 0], [8, 0], [8, 4], [0, 4]]);
    close(setSegmentLength(rect, 1, 5), [[0, 0], [6, 0], [6, 5], [0, 5]]);
    // The top runs right to left: lengthening it moves its end and the next corner left (wraps to vertex 0)
    close(setSegmentLength(rect, 2, 4), [[2, 0], [6, 0], [6, 4], [2, 4]]);
    close(setSegmentLength(rect, 3, 3), [[0, 1], [6, 1], [6, 4], [0, 4]]);
  });

  it('L-shape: the following wall keeps its angle and length', () => {
    const l: Vertex[] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 5], [0, 5]];
    const out = setSegmentLength(l, 1, 3)!;
    close(out, [[0, 0], [6, 0], [6, 3], [3, 3], [3, 5], [0, 5]]);
    const before = polygonEdgeLengths(l);
    const after = polygonEdgeLengths(out);
    expect(after[1]).toBeCloseTo(3, 9);
    expect(after[2]).toBeCloseTo(before[2], 9);
  });

  it('triangle: only the segment end moves', () => {
    const tri: Vertex[] = [[0, 0], [4, 0], [0, 3]];
    close(setSegmentLength(tri, 0, 2), [[0, 0], [2, 0], [0, 3]]);
    // Segment 2 runs from (0,3) to (0,0): its end is vertex 0
    close(setSegmentLength(tri, 2, 1), [[0, 2], [4, 0], [0, 3]]);
  });

  it('a rotated rectangle stays a rectangle', () => {
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const rot = (x: number, y: number): Vertex => [10 + x * c - y * s, 10 + x * s + y * c];
    const r: Vertex[] = [rot(0, 0), rot(4, 0), rot(4, 2), rot(0, 2)];
    close(setSegmentLength(r, 0, 5), [rot(0, 0), rot(5, 0), rot(5, 2), rot(0, 2)]);
    const lens = polygonEdgeLengths(setSegmentLength(r, 0, 5)!);
    expect(lens.map((v) => +v.toFixed(9))).toEqual([5, 2, 5, 2]);
  });

  it('refuses invalid results and lengths', () => {
    expect(setSegmentLength(rect, 0, 0)).toBeNull();
    expect(setSegmentLength(rect, 0, -1)).toBeNull();
    expect(setSegmentLength(rect, 0, NaN)).toBeNull();
    // Lengthening the top past the origin pushes corners below zero
    expect(setSegmentLength(rect, 2, 7)).toBeNull();
    // L-shape: a long inner wall crosses the outline
    const l: Vertex[] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 5], [0, 5]];
    expect(setSegmentLength(l, 2, 7)).toBeNull();
    // Collapsing a corner onto another
    const tri: Vertex[] = [[0, 0], [4, 0], [4, 3]];
    expect(setSegmentLength(tri, 1, 1e-13)).toBeNull();
  });
});

describe('parseLengthInput', () => {
  it('reads a plain number in the display unit', () => {
    expect(parseLengthInput('8', 'meters')).toBe(8);
    expect(parseLengthInput(' 2.5 ', 'feet')).toBe(2.5);
    expect(parseLengthInput('.5', 'meters')).toBe(0.5);
  });

  it('converts suffixed units', () => {
    expect(parseLengthInput('250cm', 'meters')).toBeCloseTo(2.5, 12);
    expect(parseLengthInput('250 mm', 'centimeters')).toBeCloseTo(25, 12);
    expect(parseLengthInput('2 m', 'millimeters')).toBeCloseTo(2000, 9);
    expect(parseLengthInput('10ft', 'meters')).toBeCloseTo(3.048, 12);
    expect(parseLengthInput('12 in', 'feet')).toBeCloseTo(1, 12);
    expect(parseLengthInput("10'", 'meters')).toBeCloseTo(3.048, 12);
    expect(parseLengthInput('6"', 'inches')).toBeCloseTo(6, 12);
    expect(parseLengthInput('3 FT', 'feet')).toBeCloseTo(3, 12);
    expect(parseLengthInput(`5'6"`, 'feet')).toBeCloseTo(5.5, 12);
    expect(parseLengthInput(`5' 6`, 'inches')).toBeCloseTo(66, 9);
  });

  it('rejects non-numbers, unknown units and lengths of zero or less', () => {
    expect(parseLengthInput('', 'meters')).toBeNull();
    expect(parseLengthInput('abc', 'meters')).toBeNull();
    expect(parseLengthInput('5 yd', 'meters')).toBeNull();
    expect(parseLengthInput('0', 'meters')).toBeNull();
    expect(parseLengthInput('-2', 'meters')).toBeNull();
    expect(parseLengthInput('1.2.3', 'meters')).toBeNull();
  });
});
