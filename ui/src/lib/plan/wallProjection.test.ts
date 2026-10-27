import { describe, it, expect } from 'vitest';
import { wallSegment } from '$lib/utils/surfaces';
import { wallOutline, projectLamps, projectStructures, neighbourLabels, wallDepth, wallToCanvas, canvasToWall, unprojectLampMove, unprojectStructureMove } from './wallProjection';

const square: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];
const seg0 = wallSegment(square, 0)!;

describe('wallProjection', () => {
  it('outlines a 4 m wall in a 3 m room', () => {
    expect(wallOutline(seg0, 3)).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);
  });

  it('projects a lamp 1 m in front of wall 0 at x = 2, z = 2.5', () => {
    const [p] = projectLamps([{ id: 'a', x: 2, y: 1, z: 2.5 }], seg0, 3);
    expect(p.id).toBe('a');
    expect(p.along).toBeCloseTo(2);
    expect(p.up).toBeCloseTo(2.5);
    expect(p.depth).toBeCloseTo(1);
    expect(p.opacity).toBeCloseTo(1 - 1 / 3);
  });

  it('leaves out a lamp behind the wall', () => {
    expect(projectLamps([{ id: 'b', x: 2, y: -0.5, z: 2 }], seg0, 3)).toEqual([]);
  });

  it('never fades below 0.25', () => {
    const out = projectLamps([{ id: 'near', x: 1, y: 0, z: 1 }, { id: 'far', x: 1, y: 3, z: 1 }], seg0, 3);
    expect(out.find((p) => p.id === 'near')!.opacity).toBe(1);
    expect(out.find((p) => p.id === 'far')!.opacity).toBe(0.25);
  });

  it('draws the farthest first, so nearer ones sit on top', () => {
    const out = projectLamps([{ id: 'near', x: 1, y: 0.5, z: 1 }, { id: 'far', x: 1, y: 2.5, z: 1 }], seg0, 3);
    expect(out.map((p) => p.id)).toEqual(['far', 'near']);
  });

  it('defaults the depth scale to the room extent the items reach', () => {
    const out = projectLamps([{ id: 'a', x: 1, y: 2, z: 1 }], seg0);
    expect(out[0].opacity).toBe(0.25);
  });

  it('measures the room extent perpendicular to a wall', () => {
    expect(wallDepth(square, seg0)).toBeCloseTo(3);
    expect(wallDepth(square, wallSegment(square, 1)!)).toBeCloseTo(4);
  });

  it("spans a structure's along-range and its bottom and top", () => {
    const box = { id: 's1', vertices: [[1, 1], [2.5, 1], [2.5, 2], [1, 2]] as [number, number][], z: 0.5, height: 1.2 };
    const [s] = projectStructures([box], seg0, 3, 3);
    expect(s.id).toBe('s1');
    expect(s.depth).toBeCloseTo(1);
    expect(s.opacity).toBeCloseTo(1 - 1 / 3);
    const xs = s.rect.map((p) => p[0]);
    const ys = s.rect.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(1);
    expect(Math.max(...xs)).toBeCloseTo(2.5);
    expect(Math.min(...ys)).toBeCloseTo(0.5);
    expect(Math.max(...ys)).toBeCloseTo(1.7);
  });

  it('clips a structure to the room height and leaves out one wholly behind the wall', () => {
    const tall = { id: 't', vertices: [[1, 1], [2, 1], [2, 2], [1, 2]] as [number, number][], z: 0, height: 9 };
    const behind = { id: 'b', vertices: [[1, -2], [2, -2], [2, -1], [1, -1]] as [number, number][], z: 0, height: 1 };
    const out = projectStructures([tall, behind], seg0, 3, 3);
    expect(out.map((s) => s.id)).toEqual(['t']);
    expect(Math.max(...out[0].rect.map((p) => p[1]))).toBeCloseTo(3);
  });

  it('labels wall 0 of a 4-wall room, seen from inside, with Wall 2 on the left and Wall 4 on the right', () => {
    expect(neighbourLabels(square, 0)).toEqual({ left: 'Wall 2', right: 'Wall 4' });
    expect(neighbourLabels(square, 3)).toEqual({ left: 'Wall 1', right: 'Wall 3' });
  });

  it('draws the wall as seen from inside: along runs right to left on the canvas', () => {
    const room: [number, number][] = [[0, 0], [4, 0], [4, 6], [0, 6]];
    const seg = wallSegment(room, 0)!;
    const [p] = projectLamps([{ id: 'a', x: 1, y: 1, z: 2 }], seg, 6);
    expect(wallToCanvas(p.along, p.up, seg)).toEqual([3, 2]);
    expect(canvasToWall(3, 2, seg)).toEqual({ along: 1, up: 2 });
  });
});

describe('moving lamps and structures on a wall', () => {
  const base = { x: 1, y: 1, z: 2, aimx: 1, aimy: 1, aimz: 0 } as never;

  it('stuck lamp slides along its wall and changes height', () => {
    const lamp = { ...(base as object), stick_wall: true, wall_index: 0, wall_t: 1, wall_offset: 1 } as never;
    const m = unprojectLampMove(lamp, seg0, 3.5, 2.5, 0);
    // 3.5 is nearer the end (0.5 from vertex 1), so wall_t is negative
    expect(m.wall_t).toBeCloseTo(-0.5);
    expect(m.stick_wall).toBe(true);
    expect(m.x).toBeCloseTo(3.5);
    expect(m.y).toBeCloseTo(1);
    expect(m.z).toBeCloseTo(2.5);
  });

  it('stuck lamp stays on the wall: along is clamped to it', () => {
    const lamp = { ...(base as object), stick_wall: true, wall_index: 0, wall_t: 1, wall_offset: 1 } as never;
    expect(unprojectLampMove(lamp, seg0, -2, 2, 0).wall_t).toBe(0);
    expect(unprojectLampMove(lamp, seg0, 9, 2, 0).x).toBeCloseTo(4);
  });

  it('free lamp keeps its distance from the wall', () => {
    const lamp = { ...(base as object), x: 1, y: 1.5 } as never;
    const m = unprojectLampMove(lamp, seg0, 2.5, 1.8);
    expect(m.x).toBeCloseTo(2.5);
    expect(m.y).toBeCloseTo(1.5);
    expect(m.z).toBeCloseTo(1.8);
    expect(m.wall_t).toBeUndefined();
    expect(m.stick_wall).toBeUndefined();
  });

  it('a lamp stuck to another wall is moved as a free lamp', () => {
    const lamp = { ...(base as object), stick_wall: true, wall_index: 2, wall_t: 1, wall_offset: 1 } as never;
    expect(unprojectLampMove(lamp, seg0, 2.5, 2, 0).wall_t).toBeUndefined();
  });

  it('aim moves with the lamp', () => {
    const lamp = { ...(base as object), x: 1, y: 1, z: 2, aimx: 1, aimy: 1.5, aimz: 0 } as never;
    const m = unprojectLampMove(lamp, seg0, 2, 2.5);
    expect(m.aimx).toBeCloseTo(2);
    expect(m.aimy).toBeCloseTo(1.5);
    expect(m.aimz).toBeCloseTo(0.5);
  });

  it('structure slides along the wall and rises; bottom clamps at 0', () => {
    const o = { x: 2, y: 1, z: 0.5 };
    const moved = unprojectStructureMove(o, seg0, 1, 0.25);
    expect(moved.x).toBeCloseTo(3);
    expect(moved.y).toBeCloseTo(1);
    expect(moved.z).toBeCloseTo(0.75);
    expect(unprojectStructureMove(o, seg0, 0, -2).z).toBe(0);
  });
});
