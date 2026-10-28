import { describe, it, expect } from 'vitest';
import { webOutline2d, convexHull } from './planWeb';
import { wallSegment } from '$lib/utils/surfaces';

// A lopsided web in the lamp's own frame (z down from the lamp): a lobe
// reaching 1 along +x, 0.25 the other ways.
const WEB: number[][] = [
  [0, 0, 0],
  [1, 0, -0.5],
  [0, 0.25, -0.5],
  [0, -0.25, -0.5],
  [-0.25, 0, -0.5],
  [0.2, 0.05, -0.3],
];

const downlight = { x: 3, y: 2, z: 2.5, aimx: 3, aimy: 2, aimz: 0, angle: 0 };
const room: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];

const extent = (pts: [number, number][]) => ({
  x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])),
});

describe('webOutline2d', () => {
  it('a downlight at the room centre gives a closed outline around its x/y', () => {
    const [outline] = webOutline2d(downlight, WEB, null);
    expect(outline.length).toBeGreaterThanOrEqual(3);
    const e = extent(outline);
    expect(e.x0).toBeCloseTo(2.75);
    expect(e.x1).toBeCloseTo(4);
    expect(e.y0).toBeCloseTo(1.75);
    expect(e.y1).toBeCloseTo(2.25);
  });

  it('rotating the lamp 90 degrees rotates the outline', () => {
    const [outline] = webOutline2d({ ...downlight, angle: 90 }, WEB, null);
    const e = extent(outline);
    expect(e.x0).toBeCloseTo(2.75);
    expect(e.x1).toBeCloseTo(3.25);
    expect(e.y0).toBeCloseTo(1.75);
    expect(e.y1).toBeCloseTo(3);
  });

  it('aims the web with the lamp: aimed along +x, the down lobe points +x', () => {
    const [outline] = webOutline2d({ ...downlight, aimx: 10, aimy: 2, aimz: 2.5 }, WEB, null);
    const e = extent(outline);
    expect(e.x1).toBeCloseTo(3.5);
    expect(e.x0).toBeCloseTo(3);
  });

  it('web_size_2d 2 doubles the extent; the display scale multiplies too', () => {
    const one = extent(webOutline2d(downlight, WEB, null)[0]);
    const two = extent(webOutline2d({ ...downlight, web_size_2d: 2 }, WEB, null)[0]);
    expect(two.x1 - two.x0).toBeCloseTo(2 * (one.x1 - one.x0));
    expect(two.y1 - two.y0).toBeCloseTo(2 * (one.y1 - one.y0));
    const half = extent(webOutline2d(downlight, WEB, null, 0.5)[0]);
    expect(half.x1 - half.x0).toBeCloseTo(0.5 * (one.x1 - one.x0));
  });

  it('on a wall view, a lamp in front of the wall projects to the mirrored along', () => {
    const seg = wallSegment(room, 0)!;
    const lamp = { ...downlight, x: 2, y: 1, aimx: 2, aimy: 1 };
    const [outline] = webOutline2d(lamp, WEB, seg);
    const e = extent(outline);
    // along runs 1.75..3 from x; seen from inside, canvas x = 6 - along
    expect(e.x0).toBeCloseTo(3);
    expect(e.x1).toBeCloseTo(4.25);
    // up: from the lamp at 2.5 down to 2.0
    expect(e.y0).toBeCloseTo(2);
    expect(e.y1).toBeCloseTo(2.5);
  });

  it('a lamp behind the wall gives nothing', () => {
    const seg = wallSegment(room, 0)!;
    expect(webOutline2d({ ...downlight, y: -0.5 }, WEB, seg)).toEqual([]);
  });

  it('no vertices give nothing', () => {
    expect(webOutline2d(downlight, [], null)).toEqual([]);
  });
});

describe('convexHull', () => {
  it('drops interior points and keeps the corners', () => {
    const h = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.7]]);
    expect(h).toHaveLength(4);
    expect(h).toEqual(expect.arrayContaining([[0, 0], [1, 0], [1, 1], [0, 1]]));
  });
});
