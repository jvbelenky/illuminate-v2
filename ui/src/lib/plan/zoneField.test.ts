import { describe, it, expect } from 'vitest';
import type { CalcZone, RoomConfig, ZoneResult } from '$lib/types/project';
import { planeGrid } from '$lib/utils/planePlot';
import { valueToColor } from '$lib/utils/colormaps';
import { snapshotDimensions } from '$lib/utils/zoneSnapshot';
import {
  axisPoints, cellRect, columnMax, fieldGrid, fieldKind, fieldZones, freshValues, globalPlaneRange, gridPoints,
  gridSpacing, heatmapPixels, heatmapScale, markerPath, markerRadius, markerStep, planeValuesUp, fitAffine, svgMatrix,
} from './zoneField';

const room = { x: 6, y: 4, z: 3, colormap: 'plasma' } as RoomConfig;
const plane = (over: Partial<CalcZone> = {}): CalcZone =>
  ({ id: 'p', type: 'plane', name: 'P', enabled: true, x1: 0, x2: 6, y1: 0, y2: 4, height: 1, num_x: 3, num_y: 2, offset: true, ...over }) as CalcZone;
const volume = (over: Partial<CalcZone> = {}): CalcZone =>
  ({ id: 'v', type: 'volume', name: 'V', enabled: true, x_min: 0, x_max: 6, y_min: 0, y_max: 4, z_min: 0, z_max: 3, num_x: 3, num_y: 2, num_z: 5, offset: true, ...over }) as CalcZone;

describe('axisPoints', () => {
  it('insets half a step from each end, or runs end to end', () => {
    expect(axisPoints(3, 0, 6, true)).toEqual([1, 3, 5]);
    expect(axisPoints(3, 0, 6, false)).toEqual([0, 3, 6]);
    expect(axisPoints(1, 0, 6, false)).toEqual([3]);
  });
});

describe('fieldGrid: points on the plan', () => {
  it('lays a floor plane out at world x, y (Inset)', () => {
    const g = fieldGrid(plane(), room)!;
    expect(gridPoints(g)).toEqual([[1, 1], [1, 3], [3, 1], [3, 3], [5, 1], [5, 3]]);
    expect(gridSpacing(g)).toBe(2);
  });

  it('puts the points on the boundary when On edge', () => {
    const g = fieldGrid(plane({ offset: false }), room)!;
    expect(gridPoints(g)).toEqual([[0, 0], [0, 4], [3, 0], [3, 4], [6, 0], [6, 4]]);
  });

  it('lays a ceiling plane out the same way, at world x, y', () => {
    const g = fieldGrid(plane({ height: 3, direction: -1, surface: 'ceiling' }), room)!;
    expect(gridPoints(g)).toEqual([[1, 1], [1, 3], [3, 1], [3, 3], [5, 1], [5, 3]]);
  });

  it("keeps a drawn plane's points inside its outline", () => {
    // A triangle: the corner (5, 3) lies outside it
    const g = fieldGrid(plane({ vertices: [[0, 0], [6, 0], [0, 4]] }), room)!;
    expect(gridPoints(g)).not.toContainEqual([5, 3]);
    expect(gridPoints(g)).toContainEqual([1, 1]);
  });

  it("shows a volume's x-y grid once, not every z layer", () => {
    const g = fieldGrid(volume(), room)!;
    expect(gridPoints(g)).toHaveLength(6);
    expect(g.valuesUp).toBe(true);
  });

  it('lays a wall plane out seen from inside: x = wall length - along, y = up', () => {
    // Wall 0 runs (0, 0) -> (6, 0); 3 points along, 2 up
    const g = fieldGrid(plane({ surface: 'wall:0', fit_room: true, num_x: 3, num_y: 2 }), room)!;
    expect(g.mirrorU).toBe(true);
    expect(gridPoints(g)).toEqual([[5, 0.75], [5, 2.25], [3, 0.75], [3, 2.25], [1, 0.75], [1, 2.25]]);
    expect(g.clip).toEqual([[6, 0], [0, 0], [0, 3], [6, 3]]);
  });

  it('has no 2D grid for a point', () => {
    expect(fieldGrid({ id: 'pt', type: 'point', name: 'pt', x: 1, y: 1, z: 1 } as CalcZone, room)).toBeNull();
  });
});

describe('markers stay legible', () => {
  it('thins a grid whose points would sit closer than 7 px', () => {
    expect(markerStep(0.1, 0.01)).toBe(1); // 10 px apart
    expect(markerStep(0.1, 0.05)).toBe(4); // 2 px apart: every 4th
  });

  it('caps the dot between 1.2 and 3 px on screen', () => {
    expect(markerRadius(1, 0.01)).toBeCloseTo(0.03); // 30 px of spacing: capped at 3 px
    expect(markerRadius(0.001, 0.01)).toBeCloseTo(0.012);
    expect(markerRadius(0.1, 0.01)).toBeCloseTo(0.03 - 0); // 0.3 * 0.1 = 0.03
  });

  it('thinned points are every step-th, centred', () => {
    const g = fieldGrid(plane({ num_x: 5, num_y: 1 }), room)!;
    expect(gridPoints(g, 2).map((p) => p[0])).toEqual([0.6, 3, 5.4].map((x) => expect.closeTo(x, 9)) as unknown as number[]);
  });

  it('draws every marker as one path of dots, y flipped for the SVG', () => {
    expect(markerPath([[1, 2], [3.5, 0]])).toBe('M1 -2h0M3.5 0h0');
  });
});

describe('heatmap cells', () => {
  it("covers an Inset floor plane's extent, one cell per point", () => {
    expect(cellRect(fieldGrid(plane(), room)!)).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });

  it('reaches half a step past an On edge plane, so each cell centres on its point', () => {
    // Steps 3 along x, 4 along y
    expect(cellRect(fieldGrid(plane({ offset: false }), room)!)).toEqual({ x: -1.5, y: -2, w: 9, h: 8 });
  });

  it('covers a ceiling plane where it lies on the plan', () => {
    expect(cellRect(fieldGrid(plane({ x1: 1, x2: 3, y1: 2, y2: 4, height: 3, direction: -1, surface: 'ceiling' }), room)!)).toEqual({ x: 1, y: 2, w: 2, h: 2 });
  });

  it('covers a wall plane on its mirrored wall view', () => {
    // Along 1..3 on a 6 m wall: canvas x 3..5
    const g = fieldGrid(plane({ surface: 'wall:0', wall_vertices: [[1, 0.5], [3, 0.5], [3, 2.5], [1, 2.5]], num_x: 4, num_y: 4 }), room)!;
    expect(cellRect(g)).toEqual({ x: 3, y: 0.5, w: 2, h: 2 });
    const onEdge = fieldGrid(plane({ surface: 'wall:0', offset: false, wall_vertices: [[1, 0.5], [3, 0.5], [3, 2.5], [1, 2.5]], num_x: 3, num_y: 3 }), room)!;
    expect(cellRect(onEdge)).toEqual({ x: 2.5, y: 0, w: 3, h: 3 });
  });

  it("reads a wall plane's values down from the top unless flipped, a floor plane's by its v direction", () => {
    expect(planeValuesUp(plane({ surface: 'wall:0' }), true)).toBe(false);
    expect(planeValuesUp(plane({ surface: 'wall:0', flip: true }), true)).toBe(true);
    expect(planeValuesUp(plane({ v_positive_direction: false }), false)).toBe(false);
    expect(planeValuesUp(plane({ direction: -1 }), false)).toBe(false);
    expect(planeValuesUp(plane(), false)).toBe(true);
  });

  it('colours each cell by the colormap over the range, holes transparent', () => {
    // values[i][j]: 2 along u, 1 along v
    const grid = planeGrid([[0], [10]], true);
    const px = heatmapPixels(grid, { min: 0, max: 10 }, 'plasma');
    const top = valueToColor(1, 'plasma');
    expect(Array.from(px.slice(4, 8))).toEqual([Math.round(top.r * 255), Math.round(top.g * 255), Math.round(top.b * 255), 255]);
    const holes = heatmapPixels(planeGrid([[NaN], [1]], true), { min: 0, max: 1 }, 'plasma');
    expect(holes[3]).toBe(0);
    expect(holes[7]).toBe(255);
  });

  it('blends between the points when drawn several pixels per cell, as the 3D surface does', () => {
    const grid = planeGrid([[0, 0], [10, 10]], true);
    const px = heatmapPixels(grid, { min: 0, max: 10 }, 'plasma', 2);
    expect(px.length).toBe(4 * 4 * 4);
    // Row 0: the outer pixels keep their cell's colour, the inner two blend a quarter of the way in
    const at = (i: number) => Array.from(px.slice(i * 4, i * 4 + 3));
    const c = (t: number) => { const v = valueToColor(t, 'plasma'); return [v.r, v.g, v.b].map((x) => Math.round(x * 255)); };
    expect(at(0)).toEqual(c(0));
    expect(at(1)).toEqual(c(0.25));
    expect(at(2)).toEqual(c(0.75));
    expect(at(3)).toEqual(c(1));
    expect(heatmapScale({ nU: 25, nV: 17 })).toBe(16);
    expect(heatmapScale({ nU: 100, nV: 100 })).toBe(5);
    expect(heatmapScale({ nU: 1000, nV: 2 })).toBe(1);
  });

  it("puts a wall plane's along-axis right to left in the image (mirrored)", () => {
    const g = fieldGrid(plane({ surface: 'wall:0', fit_room: true, num_x: 2, num_y: 1 }), room)!;
    const grid = planeGrid([[1], [2]], g.valuesUp, 1, g.mirrorU);
    expect(Array.from(grid.data)).toEqual([2, 1]);
  });

  it("takes a volume's highest value in each column", () => {
    expect(columnMax([[[1, 5, 2], [NaN, NaN, NaN]]])).toEqual([[5, NaN]]);
  });
});

describe('what the 2D view draws', () => {
  it('follows the 2D display mode, falling back to markers as 3D does', () => {
    expect(fieldKind(plane({ display_mode: 'heatmap' }), true)).toBe('heatmap');
    expect(fieldKind(plane({ display_mode: 'heatmap', display_mode_2d: 'contours' }), true)).toBe('contours');
    expect(fieldKind(plane({ display_mode_2d: 'contours' }), true, { levels: false })).toBe('markers');
    expect(fieldKind(plane({ display_mode_2d: 'heatmap' }), false)).toBe('markers');
    expect(fieldKind(plane({ display_mode_2d: 'markers' }), true)).toBe('markers');
    expect(fieldKind(plane({ display_mode_2d: 'none' }), true)).toBeNull();
    expect(fieldKind(plane({ display_mode_2d: 'heatmap', enabled: false }), true)).toBe('markers');
    expect(fieldKind(plane({ display_mode_2d: 'numeric', num_x: 100, num_y: 100 }), true)).toBe('markers');
  });

  it('shows a volume only in Markers, or its results', () => {
    expect(fieldKind(volume({ display_mode_2d: 'heatmap' }), false)).toBeNull();
    expect(fieldKind(volume({ display_mode_2d: 'heatmap' }), true)).toBe('heatmap');
    expect(fieldKind(volume({ display_mode_2d: 'markers' }), false)).toBe('markers');
    expect(fieldKind(volume({ display_mode_2d: 'numeric' }), false)).toBe('markers');
    expect(fieldKind(volume({ display_mode_2d: 'markers', enabled: false }), true)).toBeNull();
  });

  it('hides results whose grid has moved since they were calculated', () => {
    const result = { values: [[1]], dimensionSnapshot: snapshotDimensions(plane()) } as unknown as ZoneResult;
    expect(freshValues(plane(), result)).toEqual([[1]]);
    expect(freshValues(plane({ x2: 5 }), result)).toBeNull();
    expect(freshValues(plane(), undefined)).toBeNull();
  });

  it('picks the zones each view shows, without the hidden ones', () => {
    const floor = plane({ id: 'f' });
    const ceiling = plane({ id: 'c', height: 3, direction: -1, surface: 'ceiling' });
    const wall = plane({ id: 'w', surface: 'wall:1' });
    const vol = volume({ id: 'v' });
    const point = { id: 'pt', type: 'point', name: 'pt' } as CalcZone;
    const all = [floor, ceiling, wall, vol, point];
    expect(fieldZones(all, 'floor', 3).map((z) => z.id)).toEqual(['f', 'c', 'v']);
    expect(fieldZones(all, 'ceiling', 3).map((z) => z.id)).toEqual(['c']);
    expect(fieldZones(all, 'wall:1', 3).map((z) => z.id)).toEqual(['w']);
    expect(fieldZones(all, 'floor', 3, new Set(['f'])).map((z) => z.id)).toEqual(['c', 'v']);
  });

  it("shares one range across the enabled planes' results", () => {
    const res = {
      a: { values: [[1]], statistics: { min: 1, max: 4 } },
      b: { values: [[1]], statistics: { min: 0.5, max: 2 } },
      c: { values: [[1]], statistics: { min: 0, max: 99 } },
    } as unknown as Record<string, ZoneResult>;
    expect(globalPlaneRange([plane({ id: 'a' }), plane({ id: 'b' }), plane({ id: 'c', enabled: false })], res)).toEqual({ min: 0.5, max: 4 });
    expect(globalPlaneRange([], undefined)).toBeNull();
  });
});

describe('a zone mid-edit: the results layer follows a move, resize or turn', () => {
  const sq: [number, number][] = [[1, 1], [3, 1], [3, 2], [1, 2]];
  const apply = (m: number[], [x, y]: [number, number]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  it('a move is a translation, a resize a scale, a turn a rotation', () => {
    const moved = fitAffine(sq, sq.map(([x, y]) => [x + 0.5, y - 2] as [number, number]))!;
    expect(moved.map((v) => +v.toFixed(9))).toEqual([1, 0, 0, 1, 0.5, -2]);
    const scaled = fitAffine(sq, sq.map(([x, y]) => [1 + (x - 1) * 2, y] as [number, number]))!;
    expect(scaled.map((v) => +v.toFixed(9))).toEqual([2, 0, 0, 1, -1, 0]);
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const turned = sq.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
    const m = fitAffine(sq, turned)!;
    for (let i = 0; i < 4; i++) {
      const [x, y] = apply(m, sq[i]);
      expect(x).toBeCloseTo(turned[i][0], 9);
      expect(y).toBeCloseTo(turned[i][1], 9);
    }
  });

  it('a corner dragged on its own, or a changed corner count, has no map', () => {
    const moved = sq.map((v) => [...v] as [number, number]);
    moved[2] = [4, 3];
    expect(fitAffine(sq, moved)).toBeNull();
    expect(fitAffine(sq, sq.slice(0, 3))).toBeNull();
    expect(fitAffine([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]])).toBeNull();
  });

  it('the SVG matrix flips y, as the canvas draws (x, -y)', () => {
    expect(svgMatrix([1, 0, 0, 1, 2, 3])).toBe('matrix(1 0 0 1 2 -3)');
    const c = Math.cos(0.3), s = Math.sin(0.3);
    const [a, b, cc, d, e, f] = [c, s, -s, c, 1, 2];
    const parts = svgMatrix([a, b, cc, d, e, f]).slice(7, -1).split(' ').map(Number);
    // A plan point (x, y) drawn at (x, -y) lands at (x', -y')
    const [x, y] = [2, 5];
    const X = parts[0] * x + parts[2] * -y + parts[4];
    const Y = parts[1] * x + parts[3] * -y + parts[5];
    expect(X).toBeCloseTo(a * x + cc * y + e, 9);
    expect(Y).toBeCloseTo(-(b * x + d * y + f), 9);
  });
});
