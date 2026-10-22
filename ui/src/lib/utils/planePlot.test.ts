import { describe, it, expect } from 'vitest';
import { contourShapes, holesFilled, levelFields, numbersFit, sampleGrid, planeGrid, planeLayout, readableNumbersSize, zoomForNumbers } from './planePlot';

// values[i][j]: i along u, j along v
const values = [
  [1, 2, 3],
  [4, 5, 6],
];

describe('planeGrid', () => {
  it('puts the last v column on the top row when the values run toward +v', () => {
    const g = planeGrid(values, true, 10);
    expect([g.nU, g.nV]).toEqual([2, 3]);
    // top row = j = 2
    expect(Array.from(g.data.slice(0, 2))).toEqual([30, 60]);
    expect(Array.from(g.data.slice(4, 6))).toEqual([10, 40]);
  });

  it('keeps the first column on top when the values run toward -v', () => {
    const g = planeGrid(values, false);
    expect(Array.from(g.data.slice(0, 2))).toEqual([1, 4]);
  });

  it('keeps holes as NaN', () => {
    const g = planeGrid([[NaN, 1], [1, 1]], true);
    expect(Number.isNaN(g.data[2])).toBe(true);
  });
});

describe('contourShapes', () => {
  // A peak in the middle of a 5x5 grid
  const peak = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => 10 - (i - 2) ** 2 - (j - 2) ** 2));

  it('traces one shape per level, nested around the peak', () => {
    const shapes = contourShapes(planeGrid(peak, true), [5, 8], ['#000000', '#ffffff']);
    expect(shapes.map((s) => s.level)).toEqual([5, 8]);
    const extent = (s: (typeof shapes)[number]) => {
      const xs = s.polygons.flat(2).map(([x]) => x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(shapes[0].polygons.length).toBe(1);
    expect(extent(shapes[0])).toBeGreaterThan(extent(shapes[1]));
  });

  it('runs a level straight off the edge of the plot rather than bending back along it', () => {
    // Values rise with u, so 1.5 crosses at u = 2 the whole way up
    const ramp = Array.from({ length: 4 }, (_, i) => Array.from({ length: 3 }, () => i));
    const [shape] = contourShapes(planeGrid(ramp, true), [1.5], ['#000000']);
    const onLine = shape.polygons.flat(2).filter(([u]) => Math.abs(u - 2) < 1e-9);
    // Reaching both edges at u = 2, not cutting the corners short of them
    expect(onLine.some(([, v]) => v <= 0)).toBe(true);
    expect(onLine.some(([, v]) => v >= 3)).toBe(true);
  });

  it('runs a level up to a hole rather than stopping half a cell short', () => {
    // Values rise toward a missing centre cell, so the top band is a one-cell ring around it
    const ring = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => 10 - (i - 2) ** 2 - (j - 2) ** 2));
    ring[2][2] = NaN;
    const [top] = contourShapes(planeGrid(ring, true), [8.5], ['#000000']);
    // The ring is traced whole around the hole: one polygon, not fragments
    expect(top.polygons.length).toBe(1);
  });

  it('traces unlit cells as holes, so no band crowds in beside an obstacle', () => {
    // A lit column beside an obstacle's zeros: the zeros take the lit values
    const g = planeGrid([[8, 9], [0, 0]], true);
    expect(Array.from(g.data)).toEqual([9, 0, 8, 0]);
    expect(holesFilled(g)).toEqual([9, 9, 8, 8]);
    // An unlit plane is traced as it is
    expect(holesFilled(planeGrid([[0, 0], [0, 0]], true))).toEqual([0, 0, 0, 0]);
  });

  it('fills holes from their nearest valid cell', () => {
    const g = planeGrid([[1, NaN, NaN], [2, NaN, 4]], true);
    const filled = holesFilled(g)!;
    expect(filled.every((v) => Number.isFinite(v))).toBe(true);
    expect(holesFilled(planeGrid([[NaN]], true))).toBeNull();
  });
});

describe('levelFields', () => {
  // The same dose everywhere, but a limit of 6 on one side and 24 on the other
  const dose = [[12, 12], [12, 12]];
  const limit = { key: 'icnirp', perPoint: { ref: 12, grid: [[6, 6], [24, 24]] } };

  it('scales each value by the weighed limit over its own, so a share of the limit is one level', () => {
    const grid = planeGrid(dose, true);
    const [field] = levelFields(grid, true, [limit])!;
    // Twice the limit where it is 6, half of it where it is 24
    expect(Array.from(field!).sort()).toEqual([24, 24, 6, 6]);
    // A level traced on it is crossed between the two sides; on the dose itself it never is
    const [onField] = contourShapes(grid, [12], ['#000000'], [field]);
    const [onDose] = contourShapes(grid, [12.5], ['#000000']);
    expect(onField.polygons.length).toBe(1);
    expect(onDose.polygons.length).toBe(0);
  });

  it('needs no field where the limit is the same everywhere or the level is not from one', () => {
    const grid = planeGrid(dose, true);
    expect(levelFields(grid, true, [{ key: 'icnirp', perPoint: null }, null])).toBeUndefined();
    expect(levelFields(grid, true, [limit, null])![1]).toBeNull();
  });
});

describe('sampleGrid', () => {
  // 2 x 2 cells: values at the cell centres (0.5, 0.5), (1.5, 0.5), (0.5, 1.5), (1.5, 1.5)
  const values = [0, 10, 20, 30];

  it('returns a cell centre value exactly and interpolates between them', () => {
    expect(sampleGrid(values, 2, 2, 0.5, 0.5)).toBe(0);
    expect(sampleGrid(values, 2, 2, 1.5, 1.5)).toBe(30);
    expect(sampleGrid(values, 2, 2, 1, 0.5)).toBe(5);
    expect(sampleGrid(values, 2, 2, 1, 1)).toBe(15);
  });

  it('holds the edge value beyond the outer cell centres', () => {
    expect(sampleGrid(values, 2, 2, 0, 0)).toBe(0);
    expect(sampleGrid(values, 2, 2, 2, 2)).toBe(30);
  });
});

describe('layout and numbers', () => {
  it('keeps the plane aspect and centres the plot', () => {
    const l = planeLayout(1000, 600, 2, { tlv: false, title: false });
    expect(l.plot.w / l.plot.h).toBeCloseTo(2);
    expect(l.tlvX).toBeNull();
    const tall = planeLayout(1000, 600, 0.5, { tlv: true, title: false });
    expect(tall.plot.w / tall.plot.h).toBeCloseTo(0.5);
    expect(tall.tlvX).not.toBeNull();
  });

  it('says when numbers fit and at what zoom they will', () => {
    expect(numbersFit(30, 20, 20)).toBe(false);
    expect(numbersFit(30, 40, 20)).toBe(true);
    const k = zoomForNumbers(30, 10, 10);
    expect(numbersFit(30, 10 * k, 10 * k)).toBe(true);
  });

  it('sizes a numbers export so each cell holds a number', () => {
    const grid = planeGrid(Array.from({ length: 61 }, () => Array(41).fill(1)), true);
    const size = readableNumbersSize(30, grid, 6 / 4, { tlv: false });
    expect(size.width).toBeGreaterThan(61 * 34);
  });
});
