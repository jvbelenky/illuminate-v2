import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { outlineWireframePositions } from '$lib/utils/outlineGeometry';
import { polygonBoundingBox, type Vertex } from '$lib/utils/roomGeometry';

const source = readFileSync(resolve(__dirname, 'Room3D.svelte'), 'utf8');

describe('Room3D wireframe', () => {
  // An L-shape redrawn away from the origin, inside the old 6 x 4 rectangle
  const lShape: Vertex[] = [[3, 2], [5, 2], [5, 2.6], [3.8, 2.6], [3.8, 3.5], [3, 3.5]];

  it('draws the outline alone: no box from the origin to the extents', () => {
    expect(source).not.toMatch(/boxWireframe/);
    expect(source).toMatch(/const edges = \$derived\(outlineWireframe\(outline, 0, height\)\)/);
  });

  it("an offset L-shape's wireframe stays within the outline's own extents", () => {
    const bb = polygonBoundingBox(lShape);
    const p = outlineWireframePositions(lShape, 0, 2.7);
    for (let i = 0; i < p.length; i += 3) {
      // Room (x, y, z) -> Three (x, z, -y)
      expect(p[i]).toBeGreaterThanOrEqual(bb.xMin);
      expect(p[i]).toBeLessThanOrEqual(bb.xMax);
      expect(-p[i + 2]).toBeGreaterThanOrEqual(bb.yMin);
      expect(-p[i + 2]).toBeLessThanOrEqual(bb.yMax);
    }
  });
});
