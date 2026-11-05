import { describe, it, expect } from 'vitest';
import { detectPlan, skeletonize, type WallSegment } from './interiorWalls';
import { straightenRotation } from './importFrame';
import type { Pt, RasterImage } from './autoDetect';

/** A white grey raster with drawing helpers (50 px per metre in every test). */
function canvas(w: number, h: number) {
  const data = new Uint8Array(w * h).fill(255);
  const img: RasterImage = { width: w, height: h, data, channels: 1 };
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) data[y * w + x] = v;
  };
  /** Exterior walls of thickness t whose INNER faces are the rectangle (x0,y0)-(x1,y1). */
  const room = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    rect(x0 - t, y0 - t, x1 + t, y0);
    rect(x0 - t, y1, x1 + t, y1 + t);
    rect(x0 - t, y0, x0, y1);
    rect(x1, y0, x1 + t, y1);
  };
  return { img, rect, room, data };
}

const PX = 50;

/** A segment with these ends (either way round) and thickness, within `tol` pixels. */
function expectWall(walls: WallSegment[], a: Pt, b: Pt, t: number, tol = 2) {
  const near = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
  const hit = walls.find((s) => (near(s.a, a) && near(s.b, b)) || (near(s.a, b) && near(s.b, a)));
  expect(hit, `wall ${JSON.stringify([a, b])} in ${JSON.stringify(walls)}`).toBeTruthy();
  expect(Math.abs(hit!.thickness - t)).toBeLessThanOrEqual(1);
}

describe('skeletonize', () => {
  it('thins a bar to a one-pixel line along its middle', () => {
    const w = 40, h = 12;
    const m = new Uint8Array(w * h);
    for (let y = 3; y < 9; y++) for (let x = 5; x < 35; x++) m[y * w + x] = 1;
    const sk = skeletonize(m, w, h);
    for (let x = 10; x < 30; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) n += sk[y * w + x];
      expect(n).toBe(1);
    }
  });
});

describe('interior walls', () => {
  it('a single partition, face to face, with its thickness; the exterior walls are skipped', () => {
    const { img, room, rect } = canvas(500, 300);
    room(50, 50, 450, 250, 10);
    rect(250, 50, 256, 250);
    const { outline, walls } = detectPlan(img, { mode: 'floor' }, { pxPerM: PX });
    expect(outline).not.toBeNull();
    expect(walls).toHaveLength(1);
    expectWall(walls, [253, 50], [253, 250], 6);
  });

  it('a T-junction: the through wall stays whole and the stem ends at its face', () => {
    const { img, room, rect } = canvas(500, 400);
    room(50, 50, 450, 350, 10);
    rect(50, 200, 450, 206);
    rect(250, 206, 256, 350);
    const { walls } = detectPlan(img, { mode: 'floor' }, { pxPerM: PX });
    expect(walls).toHaveLength(2);
    expectWall(walls, [50, 203], [450, 203], 6);
    expectWall(walls, [253, 206], [253, 350], 6);
  });

  it('a door gap leaves two walls and the doorway open', () => {
    const { img, room, rect } = canvas(500, 300);
    room(50, 50, 450, 250, 10);
    rect(250, 50, 256, 130);
    rect(250, 170, 256, 250); // a 0.8 m door
    const { walls } = detectPlan(img, { mode: 'floor' }, { pxPerM: PX });
    expect(walls).toHaveLength(2);
    expectWall(walls, [253, 50], [253, 130], 6);
    expectWall(walls, [253, 170], [253, 250], 6);
  });

  it('furniture lines and text are not walls', () => {
    const { img, room, rect } = canvas(600, 400);
    room(50, 50, 550, 350, 10);
    rect(300, 50, 306, 350);
    // A desk and a bed drawn in thin lines, a door swing, and some "text"
    const box = (x0: number, y0: number, x1: number, y1: number) => {
      rect(x0, y0, x1, y0 + 2); rect(x0, y1 - 2, x1, y1); rect(x0, y0, x0 + 2, y1); rect(x1 - 2, y0, x1, y1);
    };
    box(80, 80, 200, 130);
    box(360, 200, 500, 320);
    rect(380, 220, 480, 222);
    rect(120, 300, 122, 350);
    for (let i = 0; i < 8; i++) rect(100 + i * 10, 200, 102 + i * 10, 214);
    const { walls } = detectPlan(img, { mode: 'floor' }, { pxPerM: PX });
    expect(walls).toHaveLength(1);
    expectWall(walls, [303, 50], [303, 350], 6);
  });

  it('room mode: a stub into the clicked room is a wall from the face to its end', () => {
    const { img, room, rect } = canvas(500, 300);
    room(50, 50, 450, 250, 10);
    rect(150, 50, 158, 150);
    const { outline, walls } = detectPlan(img, { mode: 'room', seed: [300, 150] }, { pxPerM: PX });
    expect(outline).not.toBeNull();
    expect(walls).toHaveLength(1);
    expectWall(walls, [154, 50], [154, 150], 8);
  });

  it('room mode: the walls around the clicked room are not interior walls', () => {
    const { img, room, rect } = canvas(500, 300);
    room(50, 50, 450, 250, 10);
    rect(250, 50, 256, 130);
    rect(250, 170, 256, 250);
    const { outline, walls } = detectPlan(img, { mode: 'room', seed: [120, 150] }, { pxPerM: PX });
    expect(outline).not.toBeNull();
    expect(walls).toHaveLength(0);
  });

  it('a tilted plan, straightened, gives an axis-aligned partition of the right size', () => {
    const W = 500, H = 400, tilt = 5;
    const src = canvas(W, H);
    const c: Pt = [W / 2, H / 2];
    const rot = (p: Pt, deg: number): Pt => {
      const r = (deg * Math.PI) / 180, dx = p[0] - c[0], dy = p[1] - c[1];
      return [c[0] + dx * Math.cos(r) - dy * Math.sin(r), c[1] + dx * Math.sin(r) + dy * Math.cos(r)];
    };
    // Exterior walls 8 px around 100..400 x 100..300, a partition x 220..226
    const inWall = ([x, y]: Pt) => {
      const outer = x >= 92 && x < 408 && y >= 92 && y < 308;
      const inner = x >= 100 && x < 400 && y >= 100 && y < 300;
      return (outer && !inner) || (x >= 220 && x < 226 && y >= 100 && y < 300);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inWall(rot([x + 0.5, y + 0.5], -tilt))) src.data[y * W + x] = 0;
    const rotation = straightenRotation(rot([120, 100], tilt), rot([380, 100], tilt), 0);
    const out = canvas(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [sx, sy] = rot([x + 0.5, y + 0.5], -rotation);
      const ix = Math.floor(sx), iy = Math.floor(sy);
      out.data[y * W + x] = ix >= 0 && iy >= 0 && ix < W && iy < H ? src.data[iy * W + ix] : 255;
    }
    const { walls } = detectPlan(out.img, { mode: 'floor' }, { pxPerM: PX });
    expect(walls).toHaveLength(1);
    const s = walls[0];
    expect(Math.abs(s.a[0] - s.b[0])).toBeLessThan(1e-6);
    expect(Math.abs(s.b[1] - s.a[1])).toBeCloseTo(200, -1);
    expect(s.thickness).toBeGreaterThan(5);
    expect(s.thickness).toBeLessThan(8);
  });

  it('none on a plan without interior walls', () => {
    const { img, room } = canvas(400, 300);
    room(50, 50, 350, 250, 10);
    expect(detectPlan(img, { mode: 'floor' }, { pxPerM: PX }).walls).toHaveLength(0);
  });
});
