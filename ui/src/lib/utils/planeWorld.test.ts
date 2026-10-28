import { describe, it, expect } from 'vitest';
import { planeWorldCorners, planeNormal, planeFrame, wallPlotAxes } from './planeWorld';
import { planeGrid } from './planePlot';
import { defaultProject, type CalcZone, type RoomConfig } from '$lib/types/project';

// An outline with one angled wall: wall 1 runs (4, 0) -> (6, 3)
const angled: RoomConfig = { ...defaultProject().room, shape: 'polygon', vertices: [[0, 0], [4, 0], [6, 3], [0, 3]], x: 6, y: 3, z: 2.7 };
const rectRoom: RoomConfig = { ...defaultProject().room, shape: 'rectangle', x: 6, y: 4, z: 2.7 };

const plane = (over: Partial<CalcZone>): CalcZone => ({ id: 'z', type: 'plane', ...over }) as CalcZone;

// Wall 1's direction and room-facing normal
const L = Math.hypot(2, 3);
const u = [2 / L, 3 / L];
const n = [-3 / L, 2 / L];

function closeTo(a: number[], b: number[]) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
}

describe('planeWorldCorners', () => {
  it('a whole wall plane on an angled wall gives 4 corners on the wall line, at z 0 and roomZ', () => {
    const cs = planeWorldCorners(plane({ surface: 'wall:1', fit_room: true }), angled);
    expect(cs).toHaveLength(4);
    for (const [x, y] of cs) {
      // On the line through (4, 0) along u: zero distance along the normal
      expect((x - 4) * n[0] + (y - 0) * n[1]).toBeCloseTo(0, 9);
    }
    const zs = cs.map((c) => c[2]).sort((a, b) => a - b);
    closeTo(zs, [0, 0, 2.7, 2.7]);
    const pts = cs.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6].join(','));
    expect(new Set(pts)).toEqual(new Set(['4,0', '6,3']));
  });

  it('normal_offset 0.5 shifts the corners by 0.5 n', () => {
    const base = planeWorldCorners(plane({ surface: 'wall:1', wall_vertices: [[0.5, 0.5], [2, 0.5], [2, 2]] }), angled);
    const off = planeWorldCorners(plane({ surface: 'wall:1', wall_vertices: [[0.5, 0.5], [2, 0.5], [2, 2]], normal_offset: 0.5 }), angled);
    expect(off).toHaveLength(3);
    off.forEach((c, i) => closeTo(c, [base[i][0] + 0.5 * n[0], base[i][1] + 0.5 * n[1], base[i][2]]));
    // The first corner sits 0.5 along the wall from vertex 1, 0.5 up
    closeTo(base[0], [4 + 0.5 * u[0], 0.5 * u[1], 0.5]);
  });

  it('flip keeps the corners and reverses planeNormal', () => {
    const z = plane({ surface: 'wall:1', fit_room: true });
    const f = plane({ surface: 'wall:1', fit_room: true, flip: true });
    expect(planeWorldCorners(f, angled)).toEqual(planeWorldCorners(z, angled));
    closeTo(planeNormal(z, angled), [n[0], n[1], 0]);
    closeTo(planeNormal(f, angled), [-n[0], -n[1], 0]);
  });

  it("a ceiling plane's corners sit at height", () => {
    const cs = planeWorldCorners(plane({ surface: 'ceiling', height: 2.7, direction: -1, x1: 0, x2: 6, y1: 0, y2: 4 }), rectRoom);
    expect(cs).toHaveLength(4);
    cs.forEach((c) => expect(c[2]).toBeCloseTo(2.7));
    closeTo(planeNormal(plane({ surface: 'ceiling', height: 2.7, direction: -1 }), rectRoom), [0, 0, -1]);
  });

  it('a drawn floor plane uses its vertices at height', () => {
    const cs = planeWorldCorners(plane({ surface: 'floor', height: 1, vertices: [[1, 1], [3, 1], [2, 3]] }), rectRoom);
    expect(cs).toEqual([[1, 1, 1], [3, 1, 1], [2, 3, 1]]);
  });

  it('a legacy XZ plane spans x and z at y = height', () => {
    const cs = planeWorldCorners(plane({ ref_surface: 'xz', height: 1, x1: 0, x2: 2, z_min: 0, z_max: 2.7 }), rectRoom);
    cs.forEach((c) => expect(c[1]).toBe(1));
    expect(new Set(cs.map((c) => c[0]))).toEqual(new Set([0, 2]));
  });

  it('a wall plane frame runs along the wall (u) and up (v)', () => {
    const fr = planeFrame(plane({ surface: 'wall:1', wall_vertices: [[0.5, 0.5], [2, 0.5], [2, 2]] }), angled)!;
    closeTo(fr.u, [u[0], u[1], 0]);
    closeTo(fr.v, [0, 0, 1]);
    expect([fr.u1, fr.u2, fr.v1, fr.v2]).toEqual([0.5, 2, 0.5, 2]);
  });
});

describe('wallPlotAxes', () => {
  // Wall 1 of the 6 x 4 room runs (6, 0) -> (6, 4): length 4, seen from inside x = 4 - along
  const drawn = plane({ surface: 'wall:1', wall_vertices: [[0.5, 0.5], [2, 0.5], [2, 2]], normal_offset: 0.25 });

  it('gives Along / Up extents, mirrored as seen from inside', () => {
    const ax = wallPlotAxes(drawn, rectRoom)!;
    expect([ax.u1, ax.u2, ax.v1, ax.v2]).toEqual([2, 3.5, 0.5, 2]);
    expect([ax.uLabel, ax.vLabel]).toEqual(['Along', 'Up']);
    expect(ax.fixed).toBe(0.25);
    // A lamp at along 1, up 2.5 on the plot
    expect(ax.toPlot(6, 1, 2.5)).toEqual([3, 2.5]);
  });

  it('orders rows top-down unless flipped, and mirrors the columns', () => {
    // values[along][up]: along 0..1, up from the top edge (unflipped)
    const values = [[1, 2], [3, 4]];
    const ax = wallPlotAxes(drawn, rectRoom)!;
    expect(ax.flipV).toBe(false);
    // Top row first; the left column is the far end of the wall (largest along)
    expect(Array.from(planeGrid(values, ax.flipV, 1, ax.mirrorU).data)).toEqual([3, 1, 4, 2]);
    const flipped = wallPlotAxes({ ...drawn, flip: true }, rectRoom)!;
    expect(flipped.flipV).toBe(true);
    expect(Array.from(planeGrid(values, flipped.flipV, 1, flipped.mirrorU).data)).toEqual([4, 2, 3, 1]);
  });

  it('a whole-wall plane spans the wall; floor and ceiling planes have none', () => {
    const ax = wallPlotAxes(plane({ surface: 'wall:0', fit_room: true }), rectRoom)!;
    expect([ax.u1, ax.u2, ax.v1, ax.v2]).toEqual([0, 6, 0, 2.7]);
    expect(wallPlotAxes(plane({ surface: 'floor', height: 1 }), rectRoom)).toBeNull();
    expect(wallPlotAxes(plane({ surface: 'ceiling', height: 2.7, direction: -1 }), rectRoom)).toBeNull();
    expect(wallPlotAxes(plane({ surface: 'wall:1', wall_orphan: true }), rectRoom)).toBeNull();
  });
});
