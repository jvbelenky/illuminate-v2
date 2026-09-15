import { describe, it, expect } from 'vitest';
import { outlineWireframePositions, outlineWireframe, outlineWalls, outlineCap, boxWireframe } from './outlineGeometry';
import type { Vertex } from './roomGeometry';

const L: Vertex[] = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]];

describe('outlineGeometry', () => {
  it('wireframe has 3 segments per wall in Three.js coordinates', () => {
    const pos = outlineWireframePositions(L, 0, 2.7);
    // 6 walls × 3 segments × 2 endpoints × 3 coords
    expect(pos.length).toBe(6 * 3 * 2 * 3);
    // First segment: floor edge (0,0)->(6,0) at z=0 → (0,0,0)->(6,0,-0)
    expect(Array.from(pos.slice(0, 6))).toEqual([0, 0, -0, 6, 0, -0]);
    // Second segment: ceiling edge at y=2.7
    expect(pos[7]).toBeCloseTo(2.7, 5); // Float32Array
    // Room y maps to -Z
    const geo = outlineWireframe([[0, 0], [1, 0], [1, 1], [0, 1]], 0, 1);
    const p = geo.getAttribute('position');
    expect(p.getZ(3 * 2 * 2 + 1)).toBe(-1); // second wall's floor segment end at (1,1) → z = -1
  });

  it('walls are one quad per edge', () => {
    const geo = outlineWalls(L, 0, 2.7);
    expect(geo.getAttribute('position').count).toBe(6 * 4);
    expect(geo.getIndex()!.count).toBe(6 * 6);
  });

  it('caps triangulate concave outlines', () => {
    const geo = outlineCap(L);
    // 6-vertex simple polygon → 4 triangles
    expect(geo.getIndex()!.count).toBe(4 * 3);
  });

  it('box wireframe is the 4-vertex special case', () => {
    const box = boxWireframe(0, 6, 0, 4, 0, 2.7);
    expect(box.getAttribute('position').count).toBe(4 * 3 * 2);
  });

  it('applies scale', () => {
    const pos = outlineWireframePositions([[0, 0], [2, 0], [2, 2]], 0, 1, 0.5);
    expect(pos[3]).toBe(1);
  });
});
