/**
 * Interior walls read out of a floor-plan raster, as straight segments with a
 * thickness, for the import window to turn into structures. Works on the
 * cleaned wall ink of autoDetect.ts (before door gaps were bridged, so
 * doorways stay open) and on the region inside the detected outline (so the
 * outline's own walls, which lie outside it, are skipped):
 *
 *   1. thin the ink to a one-pixel skeleton (Zhang–Suen) and keep the part
 *      inside the region;
 *   2. cut it at junctions and trace each piece into a polyline;
 *   3. simplify (Douglas–Peucker) and split into straight pieces;
 *   4. snap near-axis pieces to the axes; measure each piece's thickness and
 *      centre line from the ink (median perpendicular run);
 *   5. merge collinear pieces of the same wall: junction splits and small
 *      breaks join, door-sized gaps stay open;
 *   6. stretch each end along the ink to the wall's real end (a face of the
 *      outline or of a crossing wall);
 *   7. drop short pieces, thin strokes and stubby blobs.
 *
 * Everything is in working pixels (the mask's resolution).
 */
import { detectOutline, dpOpen, type DetectMode, type DetectOptions, type Pt, type RasterImage, type WallMaskInfo } from './autoDetect';

export interface WallSegment {
  /** End points, pixels (grid-corner coordinates: pixel x spans [x, x+1]). */
  a: Pt;
  b: Pt;
  /** Thickness, pixels. */
  thickness: number;
}

export interface WallOptions {
  /** Working pixels per metre; sizes the length filter and the join gap. */
  pxPerM?: number | null;
  /** Shortest wall kept, metres (default 0.3). */
  minLengthM?: number;
  /** Thinnest wall kept, metres (default 0.04): a furniture edge is thinner. */
  minThicknessM?: number;
}

// --- 1. thinning

/** Zhang–Suen thinning of a binary mask (outside the image counts as 0). */
export function skeletonize(m: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(m.length);
  let live: number[] = [];
  for (let i = 0; i < m.length; i++) if (m[i]) { img[i] = 1; live.push(i); }
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (const i of live) {
        if (!img[i]) continue;
        const x = i % w, y = (i - x) / w;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a = (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) + (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2));
        if (a !== 1) continue;
        if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        del.push(i);
      }
      for (const i of del) img[i] = 0;
      if (del.length) changed = true;
    }
    live = live.filter((i) => img[i]);
  }
  return img;
}

// --- 2. pieces between junctions

const NX = [0, 1, 1, 1, 0, -1, -1, -1];
const NY = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Polylines (pixel centres) of a skeleton cut at its junctions. */
function traceChains(sk: Uint8Array, w: number, h: number): Pt[][] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && sk[y * w + x] === 1;
  // A junction: three or more separate branches around the pixel
  const keep = new Uint8Array(sk.length);
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i]) continue;
    const x = i % w, y = (i - x) / w;
    let t = 0;
    for (let k = 0; k < 8; k++) {
      const a = on(x + NX[k], y + NY[k]), b = on(x + NX[(k + 1) % 8], y + NY[(k + 1) % 8]);
      if (!a && b) t++;
    }
    if (t < 3) keep[i] = 1;
  }
  const kOn = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && keep[y * w + x] === 1;
  const degree = (x: number, y: number) => {
    let d = 0;
    for (let k = 0; k < 8; k++) if (kOn(x + NX[k], y + NY[k])) d++;
    return d;
  };
  const seen = new Uint8Array(sk.length);
  const chains: Pt[][] = [];
  // 4-neighbours first, so a staircase is walked step by step
  const ORDER = [0, 2, 4, 6, 1, 3, 5, 7];
  const walk = (s: number) => {
    const out: Pt[] = [];
    let i = s;
    for (;;) {
      seen[i] = 1;
      const x = i % w, y = (i - x) / w;
      out.push([x + 0.5, y + 0.5]);
      let nextI = -1;
      for (const k of ORDER) {
        const nx = x + NX[k], ny = y + NY[k];
        if (kOn(nx, ny) && !seen[ny * w + nx]) { nextI = ny * w + nx; break; }
      }
      if (nextI < 0) break;
      i = nextI;
    }
    return out;
  };
  // Open chains from their ends, then whatever is left (loops)
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i] || seen[i]) continue;
    const x = i % w, y = (i - x) / w;
    if (degree(x, y) <= 1) chains.push(walk(i));
  }
  for (let i = 0; i < keep.length; i++) if (keep[i] && !seen[i]) chains.push(walk(i));
  return chains.filter((c) => c.length >= 2);
}

// --- 3+4. straight pieces, snapped and measured

interface Piece {
  /** Unit direction (angle in [0, 180)) and its normal (-uy, ux). */
  ux: number;
  uy: number;
  /** Centre line: n · p. */
  off: number;
  /** Extent along u. */
  s0: number;
  s1: number;
  thickness: number;
  axis: boolean;
}

const SNAP_DEG = 8;

function fitPiece(pts: Pt[]): Piece | null {
  const n = pts.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Endpoints decide when the cloud is too thin to have a direction
  if (sxx + syy < 1e-9) return null;
  if (ang < 0) ang += Math.PI;
  if (ang >= Math.PI) ang -= Math.PI;
  const deg = (ang * 180) / Math.PI;
  let axis = false;
  if (deg <= SNAP_DEG || deg >= 180 - SNAP_DEG) { ang = 0; axis = true; }
  else if (Math.abs(deg - 90) <= SNAP_DEG) { ang = Math.PI / 2; axis = true; }
  const ux = axis ? (ang === 0 ? 1 : 0) : Math.cos(ang);
  const uy = axis ? (ang === 0 ? 0 : 1) : Math.sin(ang);
  let s0 = Infinity, s1 = -Infinity;
  for (const p of pts) { const s = ux * p[0] + uy * p[1]; if (s < s0) s0 = s; if (s > s1) s1 = s; }
  return { ux, uy, off: -uy * mx + ux * my, s0, s1, thickness: 0, axis };
}

const pointAt = (q: Piece, s: number, o = q.off): Pt => [s * q.ux - o * q.uy, s * q.uy + o * q.ux];

/** The ink run across the piece at `s`: its width and centre offset (pixels), or null off ink. */
function runAcross(ink: Uint8Array, w: number, h: number, q: Piece, s: number, cap: number): { width: number; centre: number } | null {
  const inkAt = (p: Pt) => {
    const x = Math.floor(p[0]), y = Math.floor(p[1]);
    return x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1;
  };
  const p = pointAt(q, s);
  if (!inkAt(p)) return null;
  const step = q.axis ? 1 : 0.5;
  let lo = 0, hi = 0;
  while (hi < cap && inkAt(pointAt(q, s, q.off + hi + step))) hi += step;
  while (lo < cap && inkAt(pointAt(q, s, q.off - lo - step))) lo += step;
  if (q.axis) {
    // Whole pixels: the run covers the pixels' edges
    const c = Math.floor(q.ux ? p[1] : p[0]) + 0.5;
    const base = q.ux ? c : -c;
    const top = base + hi + 0.5, bottom = base - lo - 0.5;
    return { width: top - bottom, centre: (top + bottom) / 2 - q.off };
  }
  return { width: hi + lo + step, centre: (hi - lo) / 2 };
}

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Thickness and centre line from the ink; false when the piece is not over ink. */
function measure(ink: Uint8Array, w: number, h: number, q: Piece, cap: number): boolean {
  const widths: number[] = [], centres: number[] = [];
  for (let s = q.s0; s <= q.s1 + 1e-9; s += 1) {
    const r = runAcross(ink, w, h, q, s, cap);
    if (r) { widths.push(r.width); centres.push(r.centre); }
  }
  if (widths.length < Math.max(1, 0.5 * (q.s1 - q.s0 + 1))) return false;
  q.thickness = median(widths);
  q.off += median(centres);
  return true;
}

// --- 5. merge

function sameWall(a: Piece, b: Piece, joinGap: (thickness: number) => number): Piece | null {
  // Parallel (within 4 degrees)
  const cross = Math.abs(a.ux * b.uy - a.uy * b.ux);
  if (cross > Math.sin((4 * Math.PI) / 180)) return null;
  const tMax = Math.max(a.thickness, b.thickness), tMin = Math.min(a.thickness, b.thickness);
  if (tMax > 1.6 * tMin + 1) return null;
  // On one line
  const bMid = pointAt(b, (b.s0 + b.s1) / 2);
  const off = -a.uy * bMid[0] + a.ux * bMid[1];
  if (Math.abs(off - a.off) > Math.max(1.5, 0.5 * tMax)) return null;
  // Close along it
  const e0 = pointAt(b, b.s0), e1 = pointAt(b, b.s1);
  const p0 = a.ux * e0[0] + a.uy * e0[1], p1 = a.ux * e1[0] + a.uy * e1[1];
  const bs0 = Math.min(p0, p1), bs1 = Math.max(p0, p1);
  const gap = Math.max(bs0 - a.s1, a.s0 - bs1);
  if (gap > joinGap(tMax)) return null;
  const la = a.s1 - a.s0 + 1, lb = bs1 - bs0 + 1;
  return {
    ux: a.ux, uy: a.uy, axis: a.axis,
    off: (a.off * la + off * lb) / (la + lb),
    s0: Math.min(a.s0, bs0), s1: Math.max(a.s1, bs1),
    thickness: (a.thickness * la + b.thickness * lb) / (la + lb),
  };
}

function mergeAll(pieces: Piece[], joinGap: (thickness: number) => number): Piece[] {
  let list = pieces.slice();
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = list[i].s1 - list[i].s0 >= list[j].s1 - list[j].s0 ? [list[i], list[j]] : [list[j], list[i]];
        const m = sameWall(a, b, joinGap);
        if (m) {
          list = list.filter((_, k) => k !== i && k !== j);
          list.push(m);
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

// --- 6. ends

function extend(ink: Uint8Array, region: Uint8Array, w: number, h: number, q: Piece, cap: number) {
  const ok = (s: number) => {
    const p = pointAt(q, s);
    const x = Math.floor(p[0]), y = Math.floor(p[1]);
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    if (!ink[i] || !region[i]) return false;
    // A much wider run means the end has reached a crossing wall
    const r = runAcross(ink, w, h, q, s, cap);
    return !!r && r.width <= 1.5 * q.thickness + 1;
  };
  // Skeleton ends run into the wall they meet: trim them back first
  while (q.s1 - q.s0 > 1 && !ok(q.s1)) q.s1 -= 1;
  while (q.s1 - q.s0 > 1 && !ok(q.s0)) q.s0 += 1;
  const reach = 2 * q.thickness + 2;
  let s1 = q.s1;
  while (s1 - q.s1 < reach && ok(s1 + 1)) s1 += 1;
  let s0 = q.s0;
  while (q.s0 - s0 < reach && ok(s0 - 1)) s0 -= 1;
  // From the last pixel centre on ink to its edge
  q.s0 = s0 - 0.5;
  q.s1 = s1 + 0.5;
}

/**
 * The interior walls: straight segments of `mask.ink` inside `region` (both at
 * the mask's working resolution), with their thickness, in working pixels.
 */
export function extractInteriorWalls(mask: WallMaskInfo, region: Uint8Array, opts: WallOptions = {}): WallSegment[] {
  const { width: w, height: h, ink, wallThickness } = mask;
  const pxPerM = opts.pxPerM && opts.pxPerM > 0 ? opts.pxPerM : null;
  const sk = skeletonize(ink, w, h);
  for (let i = 0; i < sk.length; i++) if (!region[i]) sk[i] = 0;
  const cap = 4 * wallThickness + 4;
  const pieces: Piece[] = [];
  for (const chain of traceChains(sk, w, h)) {
    const corners = dpOpen(chain, 1.5);
    // Each straight run between corners, as the chain points it covers
    let from = 0;
    for (let c = 1; c < corners.length; c++) {
      const end = chain.findIndex((p, k) => k >= from && p[0] === corners[c][0] && p[1] === corners[c][1]);
      const run = chain.slice(from, end + 1);
      from = end;
      if (run.length < 3) continue;
      const q = fitPiece(run);
      if (q && measure(ink, w, h, q, cap)) pieces.push(q);
    }
  }
  // Junction splits and scan breaks join; a doorway (0.6 m and up) stays open
  const joinGap = (t: number) => Math.min(pxPerM ? pxPerM : Infinity, Math.max(3, 1.5 * t, pxPerM ? 0.25 * pxPerM : 0));
  const walls = mergeAll(pieces, joinGap);
  const minLen = Math.max(4, pxPerM ? (opts.minLengthM ?? 0.3) * pxPerM : 0.015 * Math.max(w, h));
  const out: WallSegment[] = [];
  for (const q of walls) {
    // Furniture and text are drawn thinner than walls
    if (q.thickness < Math.max(1.5, 0.3 * wallThickness, pxPerM ? (opts.minThicknessM ?? 0.04) * pxPerM : 0)) continue;
    extend(ink, region, w, h, q, cap);
    const len = q.s1 - q.s0;
    if (len < minLen || len < 2.5 * q.thickness) continue;
    out.push({ a: pointAt(q, q.s0), b: pointAt(q, q.s1), thickness: q.thickness });
  }
  // Stable order: top to bottom, then left to right
  out.sort((p, q) => Math.min(p.a[1], p.b[1]) - Math.min(q.a[1], q.b[1]) || Math.min(p.a[0], p.b[0]) - Math.min(q.a[0], q.b[0]));
  return out;
}

export interface PlanDetectResult {
  /** Outline in input-raster pixels; null when nothing sensible was found. */
  outline: Pt[] | null;
  /** Interior walls inside the outline, in input-raster pixels. */
  walls: WallSegment[];
}

/** The outline (autoDetect.ts) and the interior walls inside it, in input pixels. */
export function detectPlan(img: RasterImage, mode: DetectMode, opts: DetectOptions = {}): PlanDetectResult {
  const res = detectOutline(img, mode, opts);
  if (!res.outline || !res.region) return { outline: null, walls: [] };
  const mask = res.mask as WallMaskInfo;
  const f = mask.factor;
  // The scale the outline was found at (the given one may not have fitted)
  const used = res.pxPerM === undefined ? opts.pxPerM : res.pxPerM;
  const pxPerM = used && used > 0 ? used * f : null;
  const walls = extractInteriorWalls(mask, res.region, { pxPerM }).map((s) => ({
    a: [s.a[0] / f, s.a[1] / f] as Pt,
    b: [s.b[0] / f, s.b[1] / f] as Pt,
    thickness: s.thickness / f,
  }));
  return { outline: res.outline, walls };
}
