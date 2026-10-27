import { describe, it, expect } from 'vitest';
import { wallSegment } from '$lib/utils/surfaces';
import { wallOutline, projectLamps, projectStructures, neighbourLabels, wallDepth, wallToCanvas, canvasToWall } from './wallProjection';

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
