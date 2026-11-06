/**
 * Read a room outline out of a floor-plan raster, in the browser, with no
 * dependencies. The input is the image in its ALIGNED frame (already rotated
 * so the walls follow the axes); the outline comes back in that raster's pixels.
 *
 *   1. grey (alpha over white), downscaled to about 1000 px on the long side;
 *   2. Otsu threshold: dark pixels are ink;
 *   3. vertex markers (white circles or squares over the corners) are filled;
 *      thin strokes (text, furniture, door swings) go: an opening sized from
 *      the wall thickness; then only long straight runs stay (walls), and
 *      small ink blobs are dropped;
 *   4. door gaps up to about 1 m are bridged ALONG the wall line (never across
 *      a pocket), and doors or windows drawn as an outlined insert in the wall
 *      line are filled at any width;
 *   5. room mode: the enclosed region holding the seed; floor mode: all the
 *      enclosed space inside the exterior walls; then a closing as wide as the
 *      thickest wall fills interior walls and stubs, so the outline follows the
 *      INNER face of the walls around it (the air of the room);
 *   6. its outer boundary is traced along pixel edges, simplified
 *      (Douglas–Peucker) and near-right angles are snapped square.
 *
 * `buildWallMask` is exported on its own, and the result carries the region,
 * so interiorWalls.ts can read the walls inside the outline.
 */

export type Pt = [number, number];

/** Grey (1 channel) or RGBA (4 channels) pixels, row-major. */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
  channels?: 1 | 4;
}

export type DetectMode = { mode: 'room'; seed: Pt } | { mode: 'floor' };

export interface DetectOptions {
  /** Image pixels per metre in the input raster; sizes the door bridge. */
  pxPerM?: number | null;
  /** Widest door gap to bridge, metres (default 1). */
  doorWidthM?: number;
  /** Long side the work is done at (default 1000). */
  workSize?: number;
}

/** 1 = wall, row-major, at the working resolution. */
export interface WallMask {
  width: number;
  height: number;
  data: Uint8Array;
  /** Working pixels per input pixel (<= 1). */
  factor: number;
}

export interface DetectResult {
  /** Outline in input-raster pixels (CCW on screen is not guaranteed); null when nothing sensible was found. */
  outline: Pt[] | null;
  mask: WallMask;
  /** The pixels inside the outline (working resolution, 1 = inside), interior walls included; null without an outline. */
  region?: Uint8Array | null;
}

// --- 1. grey + downscale

/** Grey levels (0 black .. 255 white), alpha composited over white, box-downscaled so the long side is at most `workSize`. */
export function toGrey(img: RasterImage, workSize = 1000): { width: number; height: number; grey: Uint8Array; factor: number } {
  const ch = img.channels ?? (img.data.length >= img.width * img.height * 4 ? 4 : 1);
  const long = Math.max(img.width, img.height);
  const step = Math.max(1, Math.ceil(long / workSize));
  const w = Math.max(1, Math.floor(img.width / step));
  const h = Math.max(1, Math.floor(img.height / step));
  const grey = new Uint8Array(w * h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < step; yy++) {
        const row = (y * step + yy) * img.width;
        for (let xx = 0; xx < step; xx++) {
          const i = row + x * step + xx;
          if (ch === 1) sum += d[i];
          else {
            const j = i * 4;
            const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            const a = d[j + 3] / 255;
            sum += 255 - a * (255 - lum);
          }
        }
      }
      grey[y * w + x] = Math.round(sum / (step * step));
    }
  }
  return { width: w, height: h, grey, factor: 1 / step };
}

// --- 2. Otsu

/** Otsu's threshold over grey levels (those at `from` or lighter): ink is `grey < t`. Null for a flat image. */
export function otsuThreshold(grey: Uint8Array, from = 0): number | null {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) if (grey[i] >= from) hist[grey[i]]++;
  let total = 0;
  for (let t = 0; t < 256; t++) total += hist[t];
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0, wB = 0, best = -1, bestT = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  if (bestT < 0) return null;
  return bestT + 1;
}

// --- morphology (square structuring elements; outside the image counts as 0)

function dilate1D(src: Uint8Array, w: number, h: number, r: number, horizontal: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  if (r <= 0) { out.set(src); return out; }
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[horizontal ? l * w + i : i * w + l];
    for (let i = 0; i < len; i++) {
      const a = Math.max(0, i - r), b = Math.min(len, i + r + 1);
      if (pre[b] - pre[a] > 0) out[horizontal ? l * w + i : i * w + l] = 1;
    }
  }
  return out;
}

function erode1D(src: Uint8Array, w: number, h: number, r: number, horizontal: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  if (r <= 0) { out.set(src); return out; }
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[horizontal ? l * w + i : i * w + l];
    for (let i = 0; i < len; i++) {
      const a = i - r, b = i + r + 1;
      if (a < 0 || b > len) continue;
      if (pre[b] - pre[a] === b - a) out[horizontal ? l * w + i : i * w + l] = 1;
    }
  }
  return out;
}

export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return dilate1D(dilate1D(m, w, h, r, true), w, h, r, false);
}
export function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return erode1D(erode1D(m, w, h, r, true), w, h, r, false);
}

/** Chessboard distance from each ink pixel to the nearest non-ink pixel (0 off ink). */
function chessboardDistance(m: Uint8Array, w: number, h: number): Uint16Array {
  const big = 65535;
  const d = new Uint16Array(w * h);
  for (let i = 0; i < m.length; i++) d[i] = m[i] ? big : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1, at(x + 1, y - 1) + 1);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1, at(x - 1, y + 1) + 1);
  }
  return d;
}

/** 4-connected flood from the given start pixels over pixels where `pass` is 1. */
function flood(pass: Uint8Array, w: number, h: number, starts: number[]): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  for (const s of starts) if (pass[s] && !seen[s]) { seen[s] = 1; stack[top++] = s; }
  while (top) {
    const i = stack[--top];
    const x = i % w, y = (i - x) / w;
    if (x > 0 && pass[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
    if (x < w - 1 && pass[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
    if (y > 0 && pass[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
    if (y < h - 1 && pass[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
  }
  return seen;
}

/** 4-connected components of `m`; returns a label per pixel (0 = none) and each label's pixel count and bounding box. */
function components(m: Uint8Array, w: number, h: number, eight = false) {
  const label = new Int32Array(w * h);
  const stats: { n: number; x0: number; y0: number; x1: number; y1: number }[] = [{ n: 0, x0: 0, y0: 0, x1: 0, y1: 0 }];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    const id = stats.length;
    const st = { n: 0, x0: w, y0: h, x1: -1, y1: -1 };
    let top = 0;
    label[s] = id; stack[top++] = s;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      st.n++;
      if (x < st.x0) st.x0 = x; if (x > st.x1) st.x1 = x;
      if (y < st.y0) st.y0 = y; if (y > st.y1) st.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (m[j] && !label[j]) { label[j] = id; stack[top++] = j; }
      }
    }
    stats.push(st);
  }
  return { label, stats };
}

// --- 3+4. the cleaned wall mask

export interface WallMaskInfo extends WallMask {
  /** Closing radius used, working pixels. */
  bridge: number;
  /** Estimated wall thickness, working pixels. */
  wallThickness: number;
  /** The cleaned ink before door gaps were bridged (1 = wall): doorways stay open in it. */
  ink: Uint8Array;
}

/**
 * The ink that forms walls, thin strokes and small blobs removed and door gaps
 * bridged, at the working resolution. Null for a blank image.
 * `level` 0 thresholds at Otsu's level; 1 at the next level up (Otsu over the
 * lighter side), for light grey walls among black lines and text.
 */
export function buildWallMask(img: RasterImage, opts: DetectOptions = {}, level: 0 | 1 = 0): WallMaskInfo | null {
  const { width: w, height: h, grey, factor } = toGrey(img, opts.workSize ?? 1000);
  let t = otsuThreshold(grey);
  if (t !== null && level === 1) t = otsuThreshold(grey, t);
  if (t === null) return null;
  let ink: Uint8Array = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < grey.length; i++) if (grey[i] < t) { ink[i] = 1; count++; }
  // Ink must be the minority (lines on paper) and must exist
  if (count === 0 || count > 0.6 * w * h) return null;

  // Wall thickness: the 95th percentile of the distance to paper over ink pixels
  const dist = chessboardDistance(ink, w, h);
  const hist = new Uint32Array(64);
  for (let i = 0; i < dist.length; i++) if (ink[i]) hist[Math.min(63, dist[i])]++;
  let acc = 0, p95 = 1;
  for (let d = 0; d < 64; d++) { acc += hist[d]; if (acc >= 0.95 * count) { p95 = d; break; } }
  const thickness = Math.max(1, 2 * p95 - 1);
  const pxPerM = opts.pxPerM && opts.pxPerM > 0 ? opts.pxPerM * factor : null;
  // Vertex markers (a white circle or square drawn over each wall corner, wider
  // than the wall) cut the walls apart: such holes in the ink count as ink
  fillMarkerHoles(ink, w, h, thickness, Math.ceil(Math.min(2.5 * thickness, pxPerM ? 0.5 * pxPerM : Infinity)));
  const raw = ink;
  // Strokes thinner than about 40% of a wall go (text, furniture, door swings)
  const rOpen = Math.floor(thickness / 5);
  if (rOpen > 0) ink = dilate(erode(ink, w, h, rOpen), w, h, rOpen);
  // Walls are long: only runs of at least three wall thicknesses along an axis
  // or a diagonal stay, which also trims the vertex markers back to the walls
  ink = lineOpening(ink, w, h, 3 * thickness);

  const long = Math.max(w, h);
  // Small blobs go: anything whose bounding box is under 0.3 m (or 1.5% of the image)
  const minBlob = Math.max(3, pxPerM ? 0.3 * pxPerM : 0.015 * long);
  const { label, stats } = components(ink, w, h, true);
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const s = stats[label[i]];
    if (Math.max(s.x1 - s.x0, s.y1 - s.y0) + 1 < minBlob) ink[i] = 0;
  }

  // Bridge door gaps: along the wall line, up to the door width
  const doorM = opts.doorWidthM ?? 1;
  let bridge = Math.ceil(pxPerM ? (doorM / 2) * pxPerM : 0.015 * long);
  bridge = Math.max(1, Math.min(bridge, Math.floor(Math.min(w, h) / 8)));
  // Slits narrower than a wall close (anti-aliasing, touching lines)
  const rSlit = Math.ceil(thickness / 2);
  const closed = erode(dilate(ink, w, h, rSlit), w, h, rSlit);
  for (let i = 0; i < closed.length; i++) closed[i] |= ink[i];
  bridgeGaps(closed, ink, w, h, thickness, 2 * bridge);
  // Doors and windows drawn as an outlined insert in the wall line, at any width
  bridgeInserts(closed, raw, ink, w, h, thickness);
  return { width: w, height: h, data: closed, factor, bridge, wallThickness: thickness, ink };
}

/** Pixels of `m` on a straight run (horizontal, vertical or diagonal) of at least `len` pixels. */
function lineOpening(m: Uint8Array, w: number, h: number, len: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    // Start every run at a pixel whose predecessor is off the image or off `m`
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      const px = x - dx, py = y - dy;
      if (px >= 0 && py >= 0 && px < w && py < h && m[py * w + px]) continue;
      let n = 0, cx = x, cy = y;
      while (cx >= 0 && cy >= 0 && cx < w && cy < h && m[cy * w + cx]) { n++; cx += dx; cy += dy; }
      if (n < len) continue;
      for (let k = 0, kx = x, ky = y; k < n; k++, kx += dx, ky += dy) out[ky * w + kx] = 1;
    }
  }
  return out;
}

/**
 * Set to ink every enclosed non-ink hole (4-connected, off the border) that is
 * round or square, at least `min` and at most `max` pixels across. Long slots
 * (a double-lined furniture edge, a door insert) and tiny holes (letters) stay.
 */
function fillMarkerHoles(ink: Uint8Array, w: number, h: number, min: number, max: number) {
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) paper[i] = ink[i] ? 0 : 1;
  const { label, stats } = components(paper, w, h);
  const fill = new Uint8Array(stats.length);
  for (let k = 1; k < stats.length; k++) {
    const s = stats[k];
    const onBorder = s.x0 === 0 || s.y0 === 0 || s.x1 === w - 1 || s.y1 === h - 1;
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
    const lo = Math.min(bw, bh), hi = Math.max(bw, bh);
    fill[k] = !onBorder && hi <= max && lo >= min && lo >= 0.6 * hi ? 1 : 0;
  }
  for (let i = 0; i < ink.length; i++) if (label[i] && fill[label[i]]) ink[i] = 1;
}

/**
 * Bridge door gaps along wall lines: on a row (column), a gap of at most
 * `maxGap` pixels is filled when it lies between the ends of two wall pieces
 * on the same line (their cross-sections overlap), or between a wall's end
 * and the face of a wall across its line (a door beside a corner). An end is a
 * cross-section no longer than 2.5 wall thicknesses; thin lines (furniture
 * edges) only bridge to another end, never to a face. Unlike a square closing,
 * this never seals a pocket or a corridor between parallel walls.
 */
function bridgeGaps(mask: Uint8Array, wall: Uint8Array, w: number, h: number, t: number, maxGap: number) {
  const fills: number[] = [];
  for (const horizontal of [true, false]) {
    const lines = horizontal ? h : w, len = horizontal ? w : h;
    const at = (l: number, i: number) => (horizontal ? l * w + i : i * w + l);
    // The wall's extent across the line at (l, i)
    const across = (l: number, i: number): [number, number] => {
      let a = l, b = l;
      while (a > 0 && wall[at(a - 1, i)]) a--;
      while (b < lines - 1 && wall[at(b + 1, i)]) b++;
      return [a, b];
    };
    for (let l = 0; l < lines; l++) {
      let i = 0;
      while (i < len && !wall[at(l, i)]) i++;
      while (i < len) {
        while (i < len && wall[at(l, i)]) i++;
        const start = i;
        while (i < len && !wall[at(l, i)]) i++;
        if (i >= len || i - start > maxGap) continue;
        const [a0, a1] = across(l, start - 1), [b0, b1] = across(l, i);
        const la = a1 - a0 + 1, lb = b1 - b0 + 1;
        const endA = la <= 2.5 * t, endB = lb <= 2.5 * t;
        let ok = false;
        if (endA && endB) ok = Math.min(a1, b1) - Math.max(a0, b0) + 1 >= 0.5 * Math.min(la, lb);
        else if (endA !== endB) ok = (endA ? la : lb) >= 0.6 * t;
        if (ok) for (let k = start; k < i; k++) fills.push(at(l, k));
      }
    }
  }
  for (const j of fills) mask[j] = 1;
}

/**
 * Bridge doors and windows drawn IN the wall line as a thin-outlined insert:
 * along a row (column), a gap between two wall pieces is filled when every
 * pixel of it lies between thin lines within a wall thickness above and below
 * (left and right), i.e. inside the insert's outline, for most of it (its
 * marks aside), and not alongside a wall (a double-lined bed head against one).
 * `mask` is updated; `raw` is the ink before thin strokes were removed, `wall` after.
 */
function bridgeInserts(mask: Uint8Array, raw: Uint8Array, wall: Uint8Array, w: number, h: number, t: number) {
  const fills: number[] = [];
  for (const horizontal of [true, false]) {
    // Along each line (row for horizontal walls), across (column) for the sandwich test
    const lines = horizontal ? h : w, len = horizontal ? w : h;
    const at = (l: number, i: number) => (horizontal ? l * w + i : i * w + l);
    const thin = (l: number, i: number) => {
      if (l < 0 || l >= lines) return false;
      const j = at(l, i);
      return raw[j] === 1 && wall[j] === 0;
    };
    const paper = (l: number, i: number) => l >= 0 && l < lines && raw[at(l, i)] === 0;
    const nearWall = (l: number, i: number) => {
      for (let d = -t; d <= t; d++) if (l + d >= 0 && l + d < lines && wall[at(l + d, i)]) return true;
      return false;
    };
    // Between two thin lines, with paper between them: not on a lone line
    const sandwiched = (l: number, i: number) => {
      let a = 1, b = -1;
      for (let d = t; d >= 0; d--) if (thin(l - d, i)) { a = -d; break; }
      for (let d = t; d >= 0; d--) if (thin(l + d, i)) { b = d; break; }
      if (a > 0 || b < 0) return false;
      for (let d = a + 1; d < b; d++) if (paper(l + d, i)) return true;
      return false;
    };
    for (let l = 0; l < lines; l++) {
      let i = 0;
      while (i < len && !wall[at(l, i)]) i++;
      while (i < len) {
        while (i < len && wall[at(l, i)]) i++;
        const start = i;
        // Every pixel inside the insert's outline or on its marks, mostly
        // inside; and the insert replaces the wall, it does not run along one
        // (a double-lined bed head against a wall)
        let ok = true, inside = 0, along = 0;
        while (i < len && !wall[at(l, i)]) {
          if (ok) {
            if (sandwiched(l, i)) inside++;
            else if (!raw[at(l, i)]) ok = false;
            if (nearWall(l, i)) along++;
          }
          i++;
        }
        const n = i - start;
        if (i < len && ok && n > 0 && inside >= 0.5 * n && along <= 0.25 * n) for (let k = start; k < i; k++) fills.push(at(l, k));
      }
    }
  }
  for (const j of fills) mask[j] = 1;
}

// --- 5. the region

function regionFor(mask: WallMaskInfo, mode: DetectMode): Uint8Array | null {
  const { width: w, height: h, data } = mask;
  const open = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) open[i] = data[i] ? 0 : 1;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const exterior = flood(open, w, h, border);

  const minArea = Math.max(16, 0.0005 * w * h);
  if (mode.mode === 'floor') {
    // All the enclosed space; filling the walls between rooms joins them into one
    const space = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0; i < space.length; i++) if (open[i] && !exterior[i]) { space[i] = 1; n++; }
    if (n < minArea) return null;
    return fillWalls(space, exterior, mask);
  }

  // Room: the open region holding the seed (or the nearest open pixel to it)
  const sx = Math.round(mode.seed[0] * mask.factor), sy = Math.round(mode.seed[1] * mask.factor);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  let start = -1;
  const reach = mask.bridge * 2 + 2;
  for (let r = 0; r <= reach && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (open[i] && !exterior[i]) { start = i; break; }
    }
  }
  if (start < 0) return null;
  const region = flood(open, w, h, [start]);
  let n = 0;
  for (let i = 0; i < region.length; i++) n += region[i];
  if (n < minArea) return null;
  return fillWalls(region, exterior, mask);
}

/**
 * A closing as wide as the thickest wall: interior walls, stubs and slots the
 * walls leave in the space are filled, and the space keeps its inner faces
 * (never grows into the exterior).
 */
function fillWalls(space: Uint8Array, exterior: Uint8Array, mask: WallMaskInfo): Uint8Array {
  const { width: w, height: h } = mask;
  const r = Math.ceil(mask.wallThickness / 2) + 1;
  const closed = erode(dilate(space, w, h, r), w, h, r);
  for (let i = 0; i < closed.length; i++) closed[i] = space[i] || (closed[i] && !exterior[i]) ? 1 : 0;
  return closed;
}

/** Remove one-pixel spurs and keep the largest piece. */
function tidyRegion(region: Uint8Array, w: number, h: number): Uint8Array {
  const opened = dilate(erode(region, w, h, 1), w, h, 1);
  const { label, stats } = components(opened, w, h);
  let best = 0;
  for (let k = 1; k < stats.length; k++) if (!best || stats[k].n > stats[best].n) best = k;
  if (!best) return region;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (label[i] === best) out[i] = 1;
  return out;
}

// --- 6. trace, simplify, square

/**
 * The outer boundary of a 4-connected region, along pixel edges, as the
 * corners where it turns (grid-corner coordinates: pixel x spans [x, x+1]).
 */
export function traceBoundary(region: Uint8Array, w: number, h: number): Pt[] {
  let s = -1;
  for (let i = 0; i < region.length; i++) if (region[i]) { s = i; break; }
  if (s < 0) return [];
  const inR = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && region[y * w + x] === 1;
  // Directions E, S, W, N (screen, y down); the region stays on the right
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const x0 = s % w, y0 = (s - x0) / w;
  let cx = x0, cy = y0, dir = 0;
  const out: Pt[] = [[cx, cy]];
  const limit = 4 * (w + 1) * (h + 1);
  for (let step = 0; step < limit; step++) {
    // The two pixels ahead of corner (cx, cy) facing `dir`: front-left and front-right
    let fl: Pt, fr: Pt;
    if (dir === 0) { fl = [cx, cy - 1]; fr = [cx, cy]; }
    else if (dir === 1) { fl = [cx, cy]; fr = [cx - 1, cy]; }
    else if (dir === 2) { fl = [cx - 1, cy]; fr = [cx - 1, cy - 1]; }
    else { fl = [cx - 1, cy - 1]; fr = [cx, cy - 1]; }
    let nd: number;
    if (inR(fl[0], fl[1])) nd = (dir + 3) % 4;
    else if (inR(fr[0], fr[1])) nd = dir;
    else nd = (dir + 1) % 4;
    if (nd !== dir) {
      const last = out[out.length - 1];
      if (last[0] !== cx || last[1] !== cy) out.push([cx, cy]);
      dir = nd;
      // A turn happens in place; the move comes on the next iteration
      continue;
    }
    cx += DX[dir]; cy += DY[dir];
    if (cx === x0 && cy === y0 && dir === 0) break;
    if (cx === x0 && cy === y0) {
      // Back at the start heading elsewhere: turn back to east, then stop
      break;
    }
  }
  // The start corner may be recorded twice when the loop closes on it
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Douglas–Peucker on an open polyline. */
export function dpOpen(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = dpOpen(pts.slice(0, idx + 1), eps);
  const right = dpOpen(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** Douglas–Peucker on a closed ring. */
export function simplifyClosed(ring: Pt[], eps: number): Pt[] {
  if (ring.length <= 3) return ring.slice();
  // Split at the vertex farthest from the first
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = dpOpen(ring.slice(0, far + 1), eps);
  const b = dpOpen(ring.slice(far).concat([ring[0]]), eps);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : ring.slice();
}

/**
 * Snap edges within `tolDeg` of the axes to the axes, merging runs of edges
 * that become collinear, and recompute each corner as the meeting point of its
 * two edges.
 */
export function squareCorners(ring: Pt[], tolDeg = 10): Pt[] {
  const n = ring.length;
  if (n < 3) return ring.slice();
  type Edge = { kind: 'h' | 'v' | 'o'; c: number; a: Pt; b: Pt; len: number };
  const tol = (tolDeg * Math.PI) / 180;
  let edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
    if (ang <= tol) edges.push({ kind: 'h', c: (a[1] + b[1]) / 2, a, b, len });
    else if (ang >= Math.PI / 2 - tol) edges.push({ kind: 'v', c: (a[0] + b[0]) / 2, a, b, len });
    else edges.push({ kind: 'o', c: 0, a, b, len });
  }
  // Merge neighbouring edges of the same axis (length-weighted position)
  let merged = true;
  while (merged && edges.length > 3) {
    merged = false;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i], f = edges[(i + 1) % edges.length];
      if (e.kind !== 'o' && e.kind === f.kind) {
        const len = e.len + f.len;
        const m: Edge = { kind: e.kind, c: (e.c * e.len + f.c * f.len) / len, a: e.a, b: f.b, len };
        const j = (i + 1) % edges.length;
        edges = edges.filter((_, k) => k !== i && k !== j);
        edges.splice(Math.min(i, edges.length), 0, m);
        merged = true;
        break;
      }
    }
  }
  if (edges.length < 3) return ring.slice();
  const out: Pt[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[(i + edges.length - 1) % edges.length], f = edges[i];
    out.push(meet(e, f));
  }
  return out;

  function meet(e: Edge, f: Edge): Pt {
    if (e.kind === 'h' && f.kind === 'v') return [f.c, e.c];
    if (e.kind === 'v' && f.kind === 'h') return [e.c, f.c];
    // General: intersect the two lines; parallel lines meet at the shared corner
    const l1 = lineOf(e), l2 = lineOf(f);
    const det = l1[0] * l2[1] - l1[1] * l2[0];
    if (Math.abs(det) < 1e-9) return f.a;
    return [(l1[2] * l2[1] - l1[1] * l2[2]) / det, (l1[0] * l2[2] - l1[2] * l2[0]) / det];
  }
  function lineOf(e: Edge): [number, number, number] {
    // a x + b y = c
    if (e.kind === 'h') return [0, 1, e.c];
    if (e.kind === 'v') return [1, 0, e.c];
    const a = e.b[1] - e.a[1], b = e.a[0] - e.b[0];
    return [a, b, a * e.a[0] + b * e.a[1]];
  }
}

/**
 * The room outline in the raster. `room` mode takes the enclosed region
 * holding `seed` (input pixels); `floor` mode the outer envelope.
 */
export function detectOutline(img: RasterImage, mode: DetectMode, opts: DetectOptions = {}): DetectResult {
  const res = detectAtLevel(img, mode, opts, 0);
  if (res.outline) return res;
  // Nothing (or no room-sized space) at Otsu's level: the walls may be a lighter
  // grey than the black lines and text that set it
  const alt = detectAtLevel(img, mode, opts, 1);
  return alt.outline ? alt : res;
}

function detectAtLevel(img: RasterImage, mode: DetectMode, opts: DetectOptions, level: 0 | 1): DetectResult {
  const mask = buildWallMask(img, opts, level);
  const empty: WallMask = { width: 0, height: 0, data: new Uint8Array(0), factor: 1 };
  if (!mask) return { outline: null, mask: empty };
  const { width: w, height: h, factor } = mask;
  const pxPerM = opts.pxPerM && opts.pxPerM > 0 ? opts.pxPerM * factor : null;
  let region = regionFor(mask, mode);
  if (!region) return { outline: null, mask };
  region = tidyRegion(region, w, h);
  // A space under half a square metre is a piece of furniture, not a room
  if (pxPerM) {
    let n = 0;
    for (let i = 0; i < region.length; i++) n += region[i];
    if (n < 0.5 * pxPerM * pxPerM) return { outline: null, mask };
  }
  const ring = traceBoundary(region, w, h);
  if (ring.length < 3) return { outline: null, mask };
  const eps = Math.min(Math.max(1.5, pxPerM ? 0.04 * pxPerM : 0), 0.01 * Math.max(w, h) + 1.5);
  let simple = squareCorners(simplifyClosed(ring, eps));
  simple = dropShortEdges(simple, eps);
  if (simple.length < 3) return { outline: null, mask };
  return { outline: simple.map(([x, y]) => [x / factor, y / factor] as Pt), mask, region };
}

/** Drop vertices that sit within `eps` of their neighbour (after squaring). */
function dropShortEdges(ring: Pt[], eps: number): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps * 0.5) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps * 0.5) out.pop();
  }
  return out;
}
