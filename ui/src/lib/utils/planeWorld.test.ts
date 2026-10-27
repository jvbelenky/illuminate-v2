import { describe, it, expect } from 'vitest';
import { planeWorldCorners, planeNormal, planeFrame } from './planeWorld';
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
