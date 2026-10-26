import { describe, it, expect } from 'vitest';
import type { LampInstance } from '$lib/types/project';
import { applySticking, attachCeiling, attachWall, stickByPlacement, scaleLampSticking, unstickFor, parseLampSticking } from './lampSticking';

function lamp(over: Partial<LampInstance> = {}): LampInstance {
  return {
    id: 'L1', lamp_type: 'krcl_222', x: 2, y: 2, z: 2.9, aimx: 2, aimy: 2, aimz: 0,
    scaling_factor: 1, enabled: true, ...over,
  };
}

const rect = (x: number, y: number, z = 3) => ({ x, y, z, shape: 'rectangle' as const });

describe('applySticking', () => {
  it('ceiling-stuck lamp follows a Height change', () => {
    const l = lamp({ stick_ceiling: true, ceiling_offset: 0.1 });
    const moved = applySticking([l], rect(4, 4, 3.5));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: 'L1', x: 2, y: 2, z: 3.4, aimx: 2, aimy: 2, aimz: 0 });
  });

  it('a level aim moves with a ceiling-stuck lamp; a lamp not stuck stays', () => {
    const level = lamp({ id: 'A', z: 2.5, aimz: 2.5, aimx: 3, stick_ceiling: true, ceiling_offset: 0.5 });
    const free = lamp({ id: 'B', z: 2.5 });
    const moved = applySticking([level, free], rect(4, 4, 4));
    expect(moved.map((m) => m.id)).toEqual(['A']);
    expect(moved[0]).toMatchObject({ z: 3.5, aimz: 3.5, aimx: 3 });
  });

  it('corner lamp stays in its corner when the outline grows', () => {
    // Near the (4, 4) corner, on the east wall (index 1)
    const l = lamp({ x: 3.7, y: 3.6, aimx: 2, aimy: 2, aimz: 0 });
    const stuck = { ...l, ...attachWall(l, [[0, 0], [4, 0], [4, 4], [0, 4]]) };
    expect(stuck.wall_index).toBe(1);
    expect(stuck.wall_offset).toBeCloseTo(0.3);
    const moved = applySticking([stuck], rect(6, 5));
    expect(moved).toHaveLength(1);
    expect(moved[0].x).toBeCloseTo(5.7);
    expect(moved[0].y).toBeCloseTo(4.6);
    // The aim travels with the lamp, so it points the same way
    expect(moved[0].aimx).toBeCloseTo(4);
    expect(moved[0].aimy).toBeCloseTo(3);
  });

  it('a lamp near the start of its wall keeps its distance from that end', () => {
    // On the south wall, 0.5 from (0, 0)
    const l = lamp({ x: 0.5, y: 0.2, aimx: 0.5, aimy: 0.2 });
    const stuck = { ...l, ...attachWall(l, [[0, 0], [4, 0], [4, 4], [0, 4]]) };
    expect(stuck.wall_index).toBe(0);
    expect(applySticking([stuck], rect(8, 4))).toEqual([]);
  });

  it('follows a polygon wall whose vertices moved', () => {
    const verts: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    // On the inner wall from (4, 2) to (2, 2), 0.5 from (4, 2), 0.2 inside
    const l = lamp({ x: 3.5, y: 1.8, aimx: 3.5, aimy: 1.8 });
    const stuck = { ...l, ...attachWall(l, verts) };
    expect(stuck.wall_index).toBe(2);
    const moved = applySticking([stuck], { x: 4, y: 4, z: 3, shape: 'polygon', vertices: [[0, 0], [4, 0], [4, 3], [2, 3], [2, 4], [0, 4]] });
    expect(moved[0].x).toBeCloseTo(3.5);
    expect(moved[0].y).toBeCloseTo(2.8);
  });

  it('a resized rectangle keeps every wall, so a corner lamp follows its corner', () => {
    const l = lamp({ x: 3.7, y: 3.6, aimx: 2, aimy: 2 });
    const stuck = { ...l, ...attachWall(l, [[0, 0], [4, 0], [4, 4], [0, 4]]) };
    const moved = applySticking([stuck], rect(6, 5), rect(4, 4));
    expect(moved[0].x).toBeCloseTo(5.7);
    expect(moved[0].y).toBeCloseTo(4.6);
    expect(moved[0].stick_wall).toBeUndefined();
  });

  it('a wall that kept one corner is still its wall', () => {
    const verts: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    // On wall 1, (4,0)->(4,2), 0.5 from (4,0)
    const l = lamp({ x: 3.8, y: 0.5, aimx: 3.8, aimy: 0.5 });
    const stuck = { ...l, ...attachWall(l, verts) };
    expect(stuck.wall_index).toBe(1);
    const dragged = { x: 5, y: 4, z: 3, shape: 'polygon' as const, vertices: [[0, 0], [5, 0], [4, 2], [2, 2], [2, 4], [0, 4]] as [number, number][] };
    const moved = applySticking([stuck], dragged, { x: 4, y: 4, shape: 'polygon', vertices: verts });
    expect(moved).toHaveLength(1);
    expect(moved[0].stick_wall).toBeUndefined();
    expect(moved[0].x).not.toBeCloseTo(3.8);
  });

  describe('edge drags on an L-shaped outline', () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    const prev = { x: 4, y: 4, shape: 'polygon' as const, vertices: L };
    const outline = (vertices: [number, number][]) => ({ x: 5, y: 5, z: 3, shape: 'polygon' as const, vertices });
    // On wall 1, (4,0)->(4,2): 0.5 from (4,0), 0.2 in
    const l = lamp({ x: 3.8, y: 0.5, aimx: 2, aimy: 0.5 });
    const stuck = { ...l, ...attachWall(l, L) };

    it("dragging the lamp's wall out by 1 carries the lamp, at the same wall_t and wall_offset", () => {
      expect(stuck).toMatchObject({ wall_index: 1, wall_t: 0.5 });
      expect(stuck.wall_offset).toBeCloseTo(0.2);
      const moved = applySticking([stuck], outline([[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]]), prev);
      expect(moved).toHaveLength(1);
      expect(moved[0].x).toBeCloseTo(4.8);
      expect(moved[0].y).toBeCloseTo(0.5);
      expect(moved[0].aimx).toBeCloseTo(3);
      // Still stuck, its wall state unchanged
      expect(moved[0].stick_wall).toBeUndefined();
      expect(moved[0].wall_index).toBeUndefined();
      expect(moved[0].wall_t).toBeUndefined();
    });

    it('dragging a different wall leaves the lamp where it is', () => {
      // Wall 4, (2,4)->(0,4), pushed up by 1
      expect(applySticking([stuck], outline([[0, 0], [4, 0], [4, 2], [2, 2], [2, 5], [0, 5]]), prev)).toEqual([]);
      // Wall 5 (it wraps round to vertex 0) pushed left by 1
      expect(applySticking([stuck], outline([[-1, 0], [4, 0], [4, 2], [2, 2], [2, 4], [-1, 4]]), prev)).toEqual([]);
    });
  });

  it('a same-count outline starting at another corner keeps the lamp on its physical wall', () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const l = lamp({ x: 3.8, y: 3, aimx: 3.8, aimy: 3 });
    const stuck = { ...l, ...attachWall(l, square) };
    expect(stuck.wall_index).toBe(1);
    const rotated = { x: 4, y: 4, z: 3, shape: 'polygon' as const, vertices: [[4, 0], [4, 4], [0, 4], [0, 0]] as [number, number][] };
    const moved = applySticking([stuck], rotated, { x: 4, y: 4, shape: 'polygon', vertices: square });
    // The east wall is now wall 0; the lamp stays where it is
    expect(moved).toEqual([{ id: 'L1', x: 3.8, y: 3, z: 2.9, aimx: 3.8, aimy: 3, aimz: 0, wall_index: 0, wall_t: -1 }]);
  });

  it('rectangle and polygon numbering differ, and the lamp still keeps its wall', () => {
    const fromEast: [number, number][] = [[4, 0], [4, 4], [0, 4], [0, 0]];
    const l = lamp({ x: 3.8, y: 3, aimx: 3.8, aimy: 3 });
    const stuck = { ...l, ...attachWall(l, fromEast) };
    expect(stuck.wall_index).toBe(0);
    const moved = applySticking([stuck], rect(4, 4), { x: 4, y: 4, shape: 'polygon', vertices: fromEast });
    expect(moved).toEqual([{ id: 'L1', x: 3.8, y: 3, z: 2.9, aimx: 3.8, aimy: 3, aimz: 0, wall_index: 1, wall_t: -1 }]);
  });

  it('a redrawn outline of another shape never teleports a lamp onto an unrelated wall', () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const l = lamp({ x: 3.8, y: 3, aimx: 3.8, aimy: 3 });
    const stuck = { ...l, ...attachWall(l, square) };
    const redrawn = { x: 3, y: 2, z: 3, shape: 'polygon' as const, vertices: [[0.5, 0.5], [3, 0.2], [2.5, 2], [0.2, 1.8]] as [number, number][] };
    const moved = applySticking([stuck], redrawn, { x: 4, y: 4, shape: 'polygon', vertices: square });
    expect(moved).toEqual([{ id: 'L1', x: 3.8, y: 3, z: 2.9, aimx: 3.8, aimy: 3, aimz: 0, stick_wall: false }]);
  });

  it('matches offsets within the given tolerance', () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    // Rounded by the backend after a units switch: 0.2 became 0.20004
    const stuck = lamp({ x: 3.79996, y: 3, stick_wall: true, wall_index: 1, wall_t: -1, wall_offset: 0.2 });
    const rotated = { x: 4, y: 4, z: 3, shape: 'polygon' as const, vertices: [[4, 0], [4, 4], [0, 4], [0, 0]] as [number, number][] };
    const prev = { x: 4, y: 4, shape: 'polygon' as const, vertices: square };
    expect(applySticking([stuck], rotated, prev)[0].stick_wall).toBe(false);
    expect(applySticking([stuck], rotated, prev, 1e-4)[0]).toMatchObject({ wall_index: 0 });
  });

  it('wall removed unsticks', () => {
    const l = lamp({ x: 1, y: 3.8, stick_wall: true, wall_index: 5, wall_t: 1, wall_offset: 0.2 });
    const moved = applySticking([l], rect(4, 4));
    expect(moved).toEqual([{ id: 'L1', x: 1, y: 3.8, z: 2.9, aimx: 2, aimy: 2, aimz: 0, stick_wall: false }]);
  });

  it('when the outline gains a vertex, a lamp re-attaches by position, or unsticks if its wall is gone', () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const onNorth = lamp({ id: 'N', x: 1, y: 3.8, aimx: 1, aimy: 3.8 });
    const n = { ...onNorth, ...attachWall(onNorth, square) };
    const onEast = lamp({ id: 'E', x: 3.8, y: 3, aimx: 3.8, aimy: 3 });
    const e = { ...onEast, ...attachWall(onEast, square) };
    // A notch cut out of the east wall's upper half
    const notched = { x: 4, y: 4, z: 3, shape: 'polygon' as const, vertices: [[0, 0], [4, 0], [4, 2], [3, 2], [3, 4], [0, 4]] as [number, number][] };
    const moved = applySticking([n, e], notched, { x: 4, y: 4 });
    const north = moved.find((m) => m.id === 'N');
    // Still on the north wall, now index 4; position unchanged
    expect(north).toMatchObject({ x: 1, y: 3.8, wall_index: 4 });
    expect(moved.find((m) => m.id === 'E')).toMatchObject({ stick_wall: false });
  });
});

describe('attachCeiling', () => {
  it('places the lamp the default offset below the ceiling when it is far from it', () => {
    expect(attachCeiling(lamp({ z: 1, aimz: 0 }), 3, 0.1)).toEqual({ stick_ceiling: true, ceiling_offset: 0.1, z: 2.9, aimz: 0 });
  });
  it('keeps its current distance when it is already near', () => {
    expect(attachCeiling(lamp({ z: 2.75 }), 3, 0.1)).toMatchObject({ stick_ceiling: true, ceiling_offset: 0.25, z: 2.75 });
  });
  it('a level aim moves with it', () => {
    expect(attachCeiling(lamp({ z: 1, aimz: 1 }), 3, 0.1)).toMatchObject({ z: 2.9, aimz: 2.9 });
  });
  it('without a default it keeps the distance it has', () => {
    expect(attachCeiling(lamp({ z: 1.5 }), 3)).toMatchObject({ ceiling_offset: 1.5, z: 1.5 });
  });
  it('a lamp above the ceiling (a rounded placement) sits on it, never NaN', () => {
    const out = attachCeiling(lamp({ z: 3.04, aimz: 0 }), 3);
    expect(out).toEqual({ stick_ceiling: true, ceiling_offset: 0, z: 3, aimz: 0 });
    expect(attachCeiling(lamp({ z: 3.04 }), 3, 0.1)).toMatchObject({ ceiling_offset: 0.1, z: 2.9 });
  });
});

describe('attachWall', () => {
  it('attaches to the nearest wall at a given offset', () => {
    const out = attachWall(lamp({ x: 2, y: 0.5, aimx: 2, aimy: 2 }), [[0, 0], [4, 0], [4, 4], [0, 4]], 0.1);
    expect(out).toMatchObject({ stick_wall: true, wall_index: 0, wall_t: 2, wall_offset: 0.1, x: 2, y: 0.1, aimx: 2 });
    expect(out.aimy).toBeCloseTo(1.6);
  });
  it('a lamp exactly in a corner keeps that corner', () => {
    const l = lamp({ x: 4, y: 3, aimx: 4, aimy: 3 });
    const stuck = { ...l, ...attachWall(l, [[0, 0], [4, 0], [4, 3], [0, 3]], 0) };
    const moved = applySticking([stuck], rect(5, 4));
    // The east wall runs (5,0)->(5,4); the lamp stays at its far end
    expect(moved[0].x).toBeCloseTo(5);
    expect(moved[0].y).toBeCloseTo(4);
  });
});

describe('stickByPlacement', () => {
  it('maps each placement to its surfaces', () => {
    expect(stickByPlacement('downlight')).toEqual({ stick_ceiling: true, stick_wall: false });
    expect(stickByPlacement('corner')).toEqual({ stick_ceiling: true, stick_wall: true });
    expect(stickByPlacement('edge')).toEqual({ stick_ceiling: true, stick_wall: true });
    expect(stickByPlacement('horizontal')).toEqual({ stick_ceiling: false, stick_wall: true });
  });
});

describe('unstickFor', () => {
  const stuck = lamp({ stick_ceiling: true, ceiling_offset: 0.1, stick_wall: true, wall_index: 0, wall_t: 1, wall_offset: 0.2 });
  it('a new height clears the ceiling, a new X or Y clears the wall', () => {
    expect(unstickFor(stuck, { z: 2 })).toEqual({ stick_ceiling: false });
    expect(unstickFor(stuck, { x: 1 })).toEqual({ stick_wall: false });
    expect(unstickFor(stuck, { x: 1, y: 2, z: 1 })).toEqual({ stick_ceiling: false, stick_wall: false });
  });
  it('leaves the flags alone for unchanged positions, aim edits, or explicit flags', () => {
    expect(unstickFor(stuck, { z: 2.9, x: 2 })).toEqual({});
    expect(unstickFor(stuck, { aimz: 1 })).toEqual({});
    expect(unstickFor(stuck, { z: 1, stick_ceiling: true })).toEqual({});
  });
});

describe('scaleLampSticking and parseLampSticking', () => {
  it('scales the lengths and keeps the rest', () => {
    const l = lamp({ stick_ceiling: true, ceiling_offset: 0.1, stick_wall: true, wall_index: 2, wall_t: -0.5, wall_offset: 0.2 });
    const s = scaleLampSticking(l, 100);
    expect(s).toMatchObject({ ceiling_offset: 10, wall_index: 2, wall_t: -50, wall_offset: 20 });
    expect(scaleLampSticking(lamp(), 100)).toEqual(lamp());
  });
  it('keeps valid stick state and drops crafted values', () => {
    expect(parseLampSticking({ stick_ceiling: true, ceiling_offset: 0.1 })).toEqual({ stick_ceiling: true, ceiling_offset: 0.1 });
    expect(parseLampSticking({ stick_wall: true, wall_index: 1e9 })).toBeNull();
    expect(parseLampSticking({ ceiling_offset: Infinity })).toBeNull();
    expect(parseLampSticking('x')).toBeNull();
    expect(parseLampSticking({ ceiling_offset: -0.5 })).toBeNull();
    expect(parseLampSticking({ wall_offset: -1 })).toBeNull();
    expect(parseLampSticking({ wall_t: -1 })).toEqual({ wall_t: -1 });
  });
});
