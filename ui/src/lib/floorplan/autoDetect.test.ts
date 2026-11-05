import { describe, it, expect } from 'vitest';
import { detectOutline, buildWallMask, otsuThreshold, simplifyClosed, squareCorners, traceBoundary, type Pt, type RasterImage } from './autoDetect';
import { straightenRotation } from './importFrame';

/** A white grey raster with drawing helpers. */
function canvas(w: number, h: number) {
  const data = new Uint8Array(w * h).fill(255);
  const img: RasterImage = { width: w, height: h, data, channels: 1 };
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) data[y * w + x] = v;
  };
  /** Walls of thickness t whose INNER faces are the rectangle (x0,y0)-(x1,y1). */
  const room = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    rect(x0 - t, y0 - t, x1 + t, y0);
    rect(x0 - t, y1, x1 + t, y1 + t);
    rect(x0 - t, y0, x0, y1);
    rect(x1, y0, x1 + t, y1);
  };
  return { img, rect, room, data };
}

/** Sorted corner set, rounded, for order-free comparison. */
function corners(outline: Pt[] | null): string[] {
  expect(outline).not.toBeNull();
  return outline!.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).sort();
}

function expectCorners(outline: Pt[] | null, expected: Pt[], tol = 1.5) {
  expect(outline).not.toBeNull();
  expect(outline!.length).toBe(expected.length);
  for (const [ex, ey] of expected) {
    const hit = outline!.some(([x, y]) => Math.abs(x - ex) <= tol && Math.abs(y - ey) <= tol);
    expect(hit, `corner ${ex},${ey} in ${JSON.stringify(outline)}`).toBe(true);
  }
}

describe('autoDetect building blocks', () => {
  it('Otsu splits ink from paper and is null on a blank page', () => {
    const { img, rect } = canvas(20, 20);
    expect(otsuThreshold(img.data as Uint8Array)).toBeNull();
    rect(0, 0, 10, 20, 40);
    const t = otsuThreshold(img.data as Uint8Array)!;
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThanOrEqual(255);
  });

  it('traces a region along pixel edges', () => {
    const w = 6, h = 5;
    const r = new Uint8Array(w * h);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 5; x++) r[y * w + x] = 1;
    expect(corners(traceBoundary(r, w, h))).toEqual(['1,1', '1,4', '5,1', '5,4'].sort());
  });

  it('simplify and square turn a staircase into a rectangle', () => {
    const ring: Pt[] = [[0, 0], [50, 0], [50, 1], [100, 1], [100, 60], [0, 60]];
    expectCorners(squareCorners(simplifyClosed(ring, 1.5)), [[0, 0.5], [100, 0.5], [100, 60], [0, 60]], 1);
  });
});

describe('detectOutline', () => {
  it('a rectangle room', () => {
    const { img, room } = canvas(400, 300);
    room(50, 50, 350, 250, 8);
    const { outline } = detectOutline(img, { mode: 'room', seed: [200, 150] }, { pxPerM: 50 });
    expectCorners(outline, [[50, 50], [350, 50], [350, 250], [50, 250]]);
  });

  it('an L-shaped room', () => {
    const { img, rect } = canvas(400, 400);
    // Outer L: 50..350 x 50..350 minus the top-right 200..350 x 50..200, walls 8 px outside it
    const t = 8;
    rect(50 - t, 50 - t, 200 + t, 50);          // top of the left arm
    rect(200, 50 - t, 200 + t, 200);            // inner vertical
    rect(200, 200 - t, 350 + t, 200);           // inner horizontal
    rect(350, 200, 350 + t, 350 + t);           // right
    rect(50 - t, 350, 350 + t, 350 + t);        // bottom
    rect(50 - t, 50 - t, 50, 350 + t);          // left
    const { outline } = detectOutline(img, { mode: 'room', seed: [100, 300] }, { pxPerM: 50 });
    expectCorners(outline, [[50, 50], [200, 50], [200, 200], [350, 200], [350, 350], [50, 350]]);
  });

  it('bridges a door gap and ignores text and furniture inside', () => {
    const { img, rect, room } = canvas(500, 400);
    room(50, 50, 450, 350, 8);
    // A 0.8 m door (40 px at 50 px/m) in the bottom wall, with a thin swing line
    rect(200, 350, 240, 358, 255);
    rect(200, 310, 202, 350);
    // "Text": a few thin strokes in the middle, and a thin-lined desk near a wall
    for (let i = 0; i < 6; i++) rect(180 + i * 12, 180, 182 + i * 12, 196);
    rect(180, 196, 252, 198);
    rect(60, 60, 140, 62); rect(60, 90, 140, 92); rect(60, 60, 62, 92); rect(138, 60, 140, 92);
    const { outline } = detectOutline(img, { mode: 'room', seed: [300, 250] }, { pxPerM: 50 });
    expectCorners(outline, [[50, 50], [450, 50], [450, 350], [50, 350]], 2);
  });

  it('a tilted plan, after straightening from two points on a wall, comes out square', () => {
    // Draw a 5 degree tilted room, then rotate the raster back as the window does
    const W = 500, H = 400, tilt = 5;
    const src = canvas(W, H);
    const c: Pt = [W / 2, H / 2];
    const rot = (p: Pt, deg: number): Pt => {
      const r = (deg * Math.PI) / 180, dx = p[0] - c[0], dy = p[1] - c[1];
      return [c[0] + dx * Math.cos(r) - dy * Math.sin(r), c[1] + dx * Math.sin(r) + dy * Math.cos(r)];
    };
    // Rasterize the tilted walls: a pixel is ink when its un-tilted position is in a wall
    const inWall = ([x, y]: Pt) => {
      const outer = x >= 92 && x < 408 && y >= 92 && y < 308;
      const inner = x >= 100 && x < 400 && y >= 100 && y < 300;
      return outer && !inner;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inWall(rot([x + 0.5, y + 0.5], -tilt))) src.data[y * W + x] = 0;
    // Two clicks along the (tilted) top wall's inner face, a little off
    const a = rot([120, 100], tilt), b = rot([380, 100.6], tilt);
    const rotation = straightenRotation(a, b, 0);
    expect(rotation).toBeCloseTo(-tilt, 0);
    // The aligned raster: each output pixel samples the source rotated back
    const out = canvas(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [sx, sy] = rot([x + 0.5, y + 0.5], -rotation);
      const ix = Math.floor(sx), iy = Math.floor(sy);
      out.data[y * W + x] = ix >= 0 && iy >= 0 && ix < W && iy < H ? src.data[iy * W + ix] : 255;
    }
    const { outline } = detectOutline(out.img, { mode: 'room', seed: [250, 200] }, { pxPerM: 50 });
    expect(outline).not.toBeNull();
    expect(outline!.length).toBe(4);
    const xs = outline!.map((p) => p[0]), ys = outline!.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(300, -1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200, -1);
    // Square: every edge is horizontal or vertical
    for (let i = 0; i < 4; i++) {
      const p = outline![i], q = outline![(i + 1) % 4];
      expect(Math.min(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]))).toBeLessThan(1e-6);
    }
  });

  describe('a plan with interior walls', () => {
    // Two rooms side by side: 50..250 and 258..450, an interior wall (6 px) with a door
    function twoRooms() {
      const cv = canvas(500, 300);
      cv.room(50, 50, 450, 250, 10);
      cv.rect(250, 50, 256, 250);
      cv.rect(250, 140, 256, 180, 255); // 0.8 m door at 50 px/m
      return cv;
    }

    it('room mode: the clicked room, bounded by the interior wall', () => {
      const { img } = twoRooms();
      const left = detectOutline(img, { mode: 'room', seed: [120, 150] }, { pxPerM: 50 }).outline;
      expectCorners(left, [[50, 50], [250, 50], [250, 250], [50, 250]]);
      const right = detectOutline(img, { mode: 'room', seed: [380, 150] }, { pxPerM: 50 }).outline;
      expectCorners(right, [[256, 50], [450, 50], [450, 250], [256, 250]]);
    });

    it('floor mode: the inner face of the exterior walls, interior walls filled', () => {
      const { img } = twoRooms();
      const { outline, region } = detectOutline(img, { mode: 'floor' }, { pxPerM: 50 });
      expectCorners(outline, [[50, 50], [450, 50], [450, 250], [50, 250]]);
      // The interior wall lies inside the region; the exterior wall does not
      expect(region![150 * 500 + 252]).toBe(1);
      expect(region![150 * 500 + 45]).toBe(0);
    });

    it('room mode: a stub wall into the room does not notch the outline', () => {
      const cv = canvas(500, 300);
      cv.room(50, 50, 450, 250, 10);
      cv.rect(150, 50, 156, 150);
      const { outline } = detectOutline(cv.img, { mode: 'room', seed: [300, 150] }, { pxPerM: 50 });
      expectCorners(outline, [[50, 50], [450, 50], [450, 250], [50, 250]]);
    });

    it('the wall mask is exported for reuse', () => {
      const { img } = twoRooms();
      const mask = buildWallMask(img, { pxPerM: 50 })!;
      expect(mask.width).toBe(500);
      // The interior wall is wall, its door bridged; a room centre is not
      expect(mask.data[150 * 500 + 252]).toBe(1);
      expect(mask.data[100 * 500 + 252]).toBe(1);
      expect(mask.data[150 * 500 + 120]).toBe(0);
    });
  });

  it('finds nothing on a blank page or outside every room', () => {
    expect(detectOutline(canvas(200, 200).img, { mode: 'floor' }).outline).toBeNull();
    const { img, room } = canvas(400, 300);
    room(100, 100, 300, 200, 6);
    expect(detectOutline(img, { mode: 'room', seed: [20, 20] }, { pxPerM: 50 }).outline).toBeNull();
  });

  it('works on RGBA input and on images larger than the working size', () => {
    const w = 2400, h = 1600;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
    };
    fill(200 - 24, 200 - 24, 2200 + 24, 200); fill(200 - 24, 1400, 2200 + 24, 1424);
    fill(200 - 24, 200, 200, 1400); fill(2200, 200, 2224, 1400);
    const t0 = performance.now();
    const { outline } = detectOutline({ width: w, height: h, data, channels: 4 }, { mode: 'room', seed: [1200, 800] }, { pxPerM: 200 });
    const ms = performance.now() - t0;
    expectCorners(outline, [[200, 200], [2200, 200], [2200, 1400], [200, 1400]], 4);
    // Budget check (the window runs it on the main thread)
    expect(ms).toBeLessThan(2000);
  });
});
