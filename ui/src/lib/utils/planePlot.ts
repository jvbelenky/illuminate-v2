/**
 * Draws a calculation plane as a heatmap, numbers or contours, with its axes,
 * legend and (for safety zones) TLV bar. One renderer for the plot window
 * (zoomable), Save Plot (full plane, any size) and the room view's contour
 * texture (data only).
 *
 * Works on a display grid: row 0 is the top of the plot (v2), column 0 is u1.
 */
import { contours } from 'd3-contour';
import { ticks as niceTicks } from 'd3-array';
import type { ColorScale, LevelLimit } from './plotScale';
import { formatPlotValue, hexToRgb, levelText, scaleColor } from './plotScale';
import { valueToColor } from './colormaps';

export interface PlaneGrid {
  nU: number;
  nV: number;
  /** Display-unit values, row-major from the top row; NaN outside the room. */
  data: Float64Array;
}

/**
 * The plane's values as a display grid. `flipV` is true when the values run
 * toward +v, so their last column belongs at the top.
 */
export function planeGrid(values: number[][], flipV: boolean, factor = 1, mirrorU = false): PlaneGrid {
  const nU = values.length;
  const nV = values[0]?.length ?? 0;
  const data = new Float64Array(nU * nV);
  for (let i = 0; i < nU; i++) {
    const col = mirrorU ? nU - 1 - i : i;
    for (let j = 0; j < nV; j++) {
      const row = flipV ? nV - 1 - j : j;
      const v = values[i][j];
      data[row * nU + col] = Number.isFinite(v) ? v * factor : NaN;
    }
  }
  return { nU, nV, data };
}

export type ContourShape = { level: number; color: string; polygons: number[][][][] };

/**
 * Filled regions at or above each level, in grid units (cell i spans [i, i + 1]).
 * A level with a field (`fields`, from `levelFields`) is traced on it in place
 * of the grid's values.
 */
export function contourShapes(grid: PlaneGrid, levels: number[], colors: string[], fields?: (Float64Array | null)[]): ContourShape[] {
  if (grid.nU < 2 || grid.nV < 2 || levels.length === 0) return [];
  const values = holesFilled(grid);
  if (!values) return [];
  // d3-contour reads beyond the grid as below every level, so each line would
  // bend back to close along the border. A border of copied edge cells lets the
  // lines run straight off the plot, where drawing clips them.
  const nU = grid.nU + 2;
  const nV = grid.nV + 2;
  const pad = (filled: number[]) => {
    const padded = new Array<number>(nU * nV);
    for (let j = 0; j < nV; j++) {
      const row = Math.min(grid.nV - 1, Math.max(0, j - 1)) * grid.nU;
      for (let i = 0; i < nU; i++) padded[j * nU + i] = filled[row + Math.min(grid.nU - 1, Math.max(0, i - 1))];
    }
    return padded;
  };
  const padded = pad(values);
  const gen = contours().size([nU, nV]).smooth(true);
  const unpad = (rings: number[][][]) => rings.map((ring) => ring.map(([u, v]) => [u - 1, v - 1]));
  return levels.map((level, i) => {
    const field = fields?.[i];
    const own = field ? holesFilled({ ...grid, data: field }) : null;
    return { level, color: colors[i], polygons: gen.contour(own ? pad(own) : padded, level).coordinates.map(unpad) };
  });
}

/**
 * The field each level is traced on, where it differs from the plane's
 * values: for a level set from a limit that varies across the plane (lamps
 * with different limits), each value scaled by the limit's weighed dose over
 * the limit at its point. The level's line then falls where every point
 * reaches the same fraction of its own limit. Undefined when no level needs one.
 */
export function levelFields(grid: PlaneGrid, flipV: boolean, levelLimits: (LevelLimit | null)[] | null | undefined, mirrorU = false): (Float64Array | null)[] | undefined {
  if (!levelLimits?.some((l) => l?.perPoint)) return undefined;
  const byKey = new Map<string, Float64Array>();
  return levelLimits.map((limit) => {
    const perPoint = limit?.perPoint;
    if (!limit || !perPoint) return null;
    let field = byKey.get(limit.key);
    if (!field) {
      const tlvs = planeGrid(perPoint.grid as number[][], flipV, 1, mirrorU);
      if (tlvs.nU !== grid.nU || tlvs.nV !== grid.nV) return null;
      field = grid.data.map((v, k) => {
        const tlv = tlvs.data[k];
        return Number.isFinite(tlv) && tlv > 0 ? (v * perPoint.ref) / tlv : v;
      });
      byKey.set(limit.key, field);
    }
    return field;
  });
}

/**
 * The grid with each hole (NaN: outside a polygon room, inside an obstacle)
 * given its nearest valid cell's value; null when every cell is a hole.
 *
 * d3-contour reads a hole as below every level, so each level's line would
 * stop at the centre of the last valid cell: half a cell short at every hole,
 * which breaks up a band that is only a cell or two wide. Tracing the filled
 * grid runs every line to the hole, and `drawPlaneData` paints the hole back.
 *
 * Unlit cells (exactly zero: where the lamps are outside an eye's field of
 * view, inside an obstacle, or in its shadow) count as holes too. They sit a cliff away from their lit neighbours, and tracing
 * across it would crowd every band between the two into that one cell.
 */
export function holesFilled(grid: PlaneGrid): number[] | null {
  const lit = Array.from(grid.data, (v) => (v === 0 ? NaN : v));
  return nearestFilled(grid, lit) ?? nearestFilled(grid, Array.from(grid.data));
}

/** `out` with each NaN given its nearest finite cell's value; null when there is none. */
function nearestFilled(grid: PlaneGrid, out: number[]): number[] | null {
  const { nU, nV } = grid;
  // Breadth-first from every valid cell at once: each hole takes its nearest
  let frontier: number[] = [];
  for (let k = 0; k < out.length; k++) if (Number.isFinite(out[k])) frontier.push(k);
  if (frontier.length === 0) return null;
  if (frontier.length === out.length) return out;
  while (frontier.length) {
    const next: number[] = [];
    for (const k of frontier) {
      const i = k % nU;
      const j = (k - i) / nU;
      const around = [i > 0 ? k - 1 : -1, i < nU - 1 ? k + 1 : -1, j > 0 ? k - nU : -1, j < nV - 1 ? k + nU : -1];
      for (const n of around) {
        if (n >= 0 && !Number.isFinite(out[n])) {
          out[n] = out[k];
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The value at grid coordinates (cell i spans [i, i + 1], its value sits at
 * i + 0.5), interpolated between the four nearest cell centres. `values` is a
 * full grid, such as `holesFilled` returns.
 */
export function sampleGrid(values: number[], nU: number, nV: number, gu: number, gv: number): number {
  const fu = Math.min(nU - 1, Math.max(0, gu - 0.5));
  const fv = Math.min(nV - 1, Math.max(0, gv - 0.5));
  const i0 = Math.min(nU - 2, Math.floor(fu));
  const j0 = Math.min(nV - 2, Math.floor(fv));
  if (i0 < 0 || j0 < 0) return values[0];
  const tu = fu - i0;
  const tv = fv - j0;
  const at = (i: number, j: number) => values[j * nU + i];
  const top = at(i0, j0) * (1 - tu) + at(i0 + 1, j0) * tu;
  const bottom = at(i0, j0 + 1) * (1 - tu) + at(i0 + 1, j0 + 1) * tu;
  return top * (1 - tv) + bottom * tv;
}

/** Each shape's outline in canvas coordinates, for hit-testing a level's line. */
export function shapePaths(shapes: ContourShape[], grid: PlaneGrid, rect: Rect, view: View): Path2D[] {
  const cellW = (rect.w / grid.nU) * view.k;
  const cellH = (rect.h / grid.nV) * view.k;
  return shapes.map((s) => {
    const path = new Path2D();
    for (const polygon of s.polygons) {
      for (const ring of polygon) {
        ring.forEach(([u, v], i) => {
          const x = rect.x + view.tx + u * cellW;
          const y = rect.y + view.ty + v * cellH;
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        });
        path.closePath();
      }
    }
    return path;
  });
}

/** The cells `isHole` picks as opaque pixels (one per cell), or null when it picks none. */
function holeBitmap(grid: PlaneGrid, color: string, isHole: (v: number) => boolean): HTMLCanvasElement | null {
  if (!grid.data.some(isHole)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = grid.nU;
  canvas.height = grid.nV;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(grid.nU, grid.nV);
  const c = hexToRgb(color);
  for (let k = 0; k < grid.data.length; k++) {
    if (!isHole(grid.data[k])) continue;
    img.data[k * 4] = Math.round(c.r * 255);
    img.data[k * 4 + 1] = Math.round(c.g * 255);
    img.data[k * 4 + 2] = Math.round(c.b * 255);
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zoom: scale `k` about the plot's top-left corner, then shift by tx, ty (px). */
export interface View {
  k: number;
  tx: number;
  ty: number;
}

export const NO_ZOOM: View = { k: 1, tx: 0, ty: 0 };

export interface PlotPalette {
  background: string;
  text: string;
  muted: string;
  grid: string;
  /** Below the lowest level. */
  floor: string;
}

export interface PlaneAxes {
  u1: number;
  u2: number;
  v1: number;
  v2: number;
  uLabel: string;
  vLabel: string;
  units: string;
}

export interface PlotLamp {
  name: string;
  u: number;
  v: number;
}

export interface PlaneDataOptions {
  grid: PlaneGrid;
  view: 'heatmap' | 'contours';
  /** Print each cell's value where it fits. */
  showValues?: boolean;
  scale: ColorScale;
  filled: boolean;
  decimals: number;
  palette: PlotPalette;
  /** Pixel multiplier for text and lines (2 for a 2x export). */
  px?: number;
  contourLabels?: boolean;
  /** Precomputed shapes for this grid and scale, to skip retracing while zooming. */
  shapes?: ContourShape[];
  /** The field each level is traced on in place of the values (`levelFields`). */
  fields?: (Float64Array | null)[];
  /** Leave holes transparent (a texture) rather than painting them the background. */
  clearHoles?: boolean;
  /** A level under the pointer or being dragged: its line is drawn heavier, with a halo. */
  activeLevel?: number | null;
}

/** The plot colors of the current theme (app.css tokens). */
export function readPlotPalette(): PlotPalette {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: get('--color-plot-bg', '#1a1a2e'),
    text: get('--color-plot-text', '#e0e0e0'),
    muted: get('--color-text-muted', '#a0a0a0'),
    grid: get('--color-plot-grid', '#444444'),
    floor: get('--color-plot-floor', '#262a44'),
  };
}

const MONO = "'SF Mono', 'Fira Code', Consolas, monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
/** Contour labels sit on the bands' own colors, so they keep one look in either theme. */
const LABEL_INK = '#16205c';
const LABEL_HALO = '#ffffff';
const NUMBER_FONT_PX = 11;

function rgbCss(c: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

function luminance(c: { r: number; g: number; b: number }): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/** One pixel per cell, for drawing scaled up with smoothing off. */
function cellBitmap(grid: PlaneGrid, scale: ColorScale, floor: string, skipColors: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.nU;
  canvas.height = grid.nV;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(grid.nU, grid.nV);
  const floorRgb = hexToRgb(floor);
  for (let k = 0; k < grid.data.length; k++) {
    const v = grid.data[k];
    if (!Number.isFinite(v)) continue; // outside the room: transparent
    const c = skipColors ? floorRgb : (scaleColor(scale, v) ?? floorRgb);
    img.data[k * 4] = Math.round(c.r * 255);
    img.data[k * 4 + 1] = Math.round(c.g * 255);
    img.data[k * 4 + 2] = Math.round(c.b * 255);
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Widest number the grid will print, in px at size `px`. */
export function numberWidth(ctx: CanvasRenderingContext2D, grid: PlaneGrid, decimals: number, px = 1): number {
  let max = 0;
  for (const v of grid.data) if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v);
  ctx.font = `${NUMBER_FONT_PX * px}px ${MONO}`;
  return ctx.measureText(formatPlotValue(-max, decimals)).width;
}

/** Whether every number fits in its cell at this on-screen cell size. */
export function numbersFit(textWidth: number, cellW: number, cellH: number, px = 1): boolean {
  return cellW >= textWidth + 4 * px && cellH >= (NUMBER_FONT_PX + 3) * px;
}

/** The zoom at which numbers start to fit. */
export function zoomForNumbers(textWidth: number, cellW: number, cellH: number): number {
  return Math.max((textWidth + 4) / cellW, (NUMBER_FONT_PX + 3) / cellH);
}

function tracePolygons(ctx: CanvasRenderingContext2D, polygons: number[][][][], toX: (u: number) => number, toY: (v: number) => number) {
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(toX(u), toY(v)) : ctx.lineTo(toX(u), toY(v))));
      ctx.closePath();
    }
  }
}

/** The data itself, clipped to `rect`. */
export function drawPlaneData(ctx: CanvasRenderingContext2D, rect: Rect, view: View, o: PlaneDataOptions): void {
  const { grid, scale, palette } = o;
  const px = o.px ?? 1;
  const cellW = (rect.w / grid.nU) * view.k;
  const cellH = (rect.h / grid.nV) * view.k;
  const toX = (gu: number) => rect.x + view.tx + gu * cellW;
  const toY = (gv: number) => rect.y + view.ty + gv * cellH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  const contoured = o.view === 'contours';
  const bitmap = cellBitmap(grid, scale, palette.floor, contoured);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, toX(0), toY(0), grid.nU * cellW, grid.nV * cellH);

  if (contoured && scale.levels) {
    const shapes = o.shapes ?? contourShapes(grid, scale.levels, scale.colors, o.fields);
    if (o.filled) {
      for (const s of shapes) {
        ctx.beginPath();
        tracePolygons(ctx, s.polygons, toX, toY);
        ctx.fillStyle = s.color;
        ctx.fill('evenodd');
      }
    }
    shapes.forEach((s, i) => {
      ctx.beginPath();
      tracePolygons(ctx, s.polygons, toX, toY);
      const c = hexToRgb(s.color);
      const line = o.filled ? rgbCss({ r: c.r * 0.55, g: c.g * 0.55, b: c.b * 0.55 }) : s.color;
      if (i === o.activeLevel) {
        // Grabbable: a halo in the background color, then a heavier line
        ctx.strokeStyle = palette.background;
        ctx.lineWidth = 7 * px;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = line;
        ctx.lineWidth = 3.5 * px;
      } else {
        ctx.strokeStyle = line;
        ctx.lineWidth = (o.filled ? 1.2 : 2) * px;
      }
      ctx.stroke();
    });
    // Contours were traced over filled-in holes; put the holes back, cell for cell
    const lit = grid.data.some((v) => v !== 0 && Number.isFinite(v));
    const unlit = lit ? holeBitmap(grid, palette.floor, (v) => v === 0) : null;
    if (unlit) ctx.drawImage(unlit, toX(0), toY(0), grid.nU * cellW, grid.nV * cellH);
    const holes = holeBitmap(grid, o.clearHoles ? '#000000' : palette.background, (v) => !Number.isFinite(v));
    if (holes) {
      if (o.clearHoles) ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(holes, toX(0), toY(0), grid.nU * cellW, grid.nV * cellH);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (o.contourLabels) drawContourLabels(ctx, rect, shapes, (i) => levelText(scale, i, o.decimals), toX, toY, px);
  }

  if (o.showValues) {
    const tw = numberWidth(ctx, grid, o.decimals, px);
    if (numbersFit(tw, cellW, cellH, px)) {
      ctx.font = `${NUMBER_FONT_PX * px}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const floorRgb = hexToRgb(palette.floor);
      const i0 = Math.max(0, Math.floor((rect.x - toX(0)) / cellW));
      const i1 = Math.min(grid.nU - 1, Math.ceil((rect.x + rect.w - toX(0)) / cellW));
      const j0 = Math.max(0, Math.floor((rect.y - toY(0)) / cellH));
      const j1 = Math.min(grid.nV - 1, Math.ceil((rect.y + rect.h - toY(0)) / cellH));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const v = grid.data[j * grid.nU + i];
          if (!Number.isFinite(v)) continue;
          const c = scaleColor(scale, v) ?? floorRgb;
          ctx.fillStyle = luminance(c) < 0.5 ? '#ffffff' : '#000000';
          ctx.fillText(formatPlotValue(v, o.decimals), toX(i + 0.5), toY(j + 0.5));
        }
      }
    }
  }
  ctx.restore();
}

/** Each level's value or name on its line, spaced along the ring so neighbours don't collide. */
function drawContourLabels(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  shapes: ContourShape[],
  textFor: (levelIndex: number) => string,
  toX: (u: number) => number,
  toY: (v: number) => number,
  px: number,
) {
  // Bold dark text in a thin white outline, sitting on its line: readable on any band
  ctx.font = `bold ${11 * px}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const placed: Rect[] = [];
  shapes.forEach((s, li) => {
    const text = textFor(li);
    const w = ctx.measureText(text).width + 6 * px;
    const h = 14 * px;
    for (const polygon of s.polygons) {
      const ring = polygon[0];
      if (!ring || ring.length < 12) continue;
      for (let attempt = 0; attempt < 4; attempt++) {
        const [u, v] = ring[Math.floor(ring.length * ((0.2 + 0.13 * li + 0.25 * attempt) % 1))];
        const x = toX(u);
        const y = toY(v);
        const box = { x: x - w / 2, y: y - h / 2, w, h };
        const m = 4 * px;
        const inside = box.x > rect.x + m && box.y > rect.y + m && box.x + w < rect.x + rect.w - m && box.y + h < rect.y + rect.h - m;
        const clear = placed.every((b) => box.x > b.x + b.w || box.x + w < b.x || box.y > b.y + b.h || box.y + h < b.y);
        if (!inside || !clear) continue;
        placed.push(box);
        ctx.strokeStyle = LABEL_HALO;
        ctx.lineWidth = 3.5 * px;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = LABEL_INK;
        ctx.fillText(text, x, y);
        break;
      }
    }
  });
}

// --- Full plot: data, axes, legend, TLV bar ---

export interface PlaneLayout {
  width: number;
  height: number;
  plot: Rect;
  legendX: number;
  tlvX: number | null;
  titleY: number | null;
  px: number;
}

/**
 * Fit the plot into `width` x `height`, keeping the plane's aspect, and centre
 * it with its legend in whatever room is left over.
 */
export function planeLayout(
  width: number,
  height: number,
  aspect: number,
  opts: { tlv: boolean; title: boolean; px?: number; legendText?: number },
): PlaneLayout {
  const px = opts.px ?? 1;
  // Legend: gap, bar, gap, its longest label, gap; then the TLV bar and its labels
  const legendW = 18 + 14 + 5 + Math.max(50, opts.legendText ?? 0) + 12;
  const m = { l: 70 * px, r: (legendW + (opts.tlv ? 70 : 0)) * px, t: (opts.title ? 40 : 18) * px, b: 52 * px };
  const availW = Math.max(40, width - m.l - m.r);
  const availH = Math.max(40, height - m.t - m.b);
  const w = Math.min(availW, availH * aspect);
  const h = w / aspect;
  const x = m.l + (availW - w) / 2;
  const y = m.t + (availH - h) / 2;
  const legendX = x + w + 18 * px;
  return {
    width,
    height,
    plot: { x, y, w, h },
    legendX,
    tlvX: opts.tlv ? legendX + (legendW - 18) * px : null,
    titleY: opts.title ? 20 * px : null,
    px,
  };
}

/** Width of the legend's longest label at 1x (its 10 px monospace font). */
export function legendTextWidth(labels: string[]): number {
  return Math.max(0, ...labels.map((t) => t.length)) * 6.1;
}

/** Canvas size for an image of the whole plane where every number is readable. */
export function readableNumbersSize(textWidth: number, grid: PlaneGrid, aspect: number, opts: { tlv: boolean; legendText?: number }): { width: number; height: number } {
  // Cell size that fits a number, then the plot that gives each cell that size
  const cellW = Math.max(textWidth + 8, ((NUMBER_FONT_PX + 5) * aspect * grid.nV) / grid.nU);
  let w = cellW * grid.nU;
  // Stay within what browsers will allocate for one canvas
  w = Math.min(w, 12000);
  const h = w / aspect;
  const chromeW = 70 + 18 + 14 + 5 + Math.max(50, opts.legendText ?? 0) + 12 + (opts.tlv ? 70 : 0);
  return { width: Math.ceil(w + chromeW), height: Math.ceil(h + 40 + 52) };
}

export interface TlvBar {
  limit: number;
  max: number;
}

export interface PlanePlotOptions extends PlaneDataOptions {
  axes: PlaneAxes;
  zoom: View;
  showTickMarks: boolean;
  showTickLabels: boolean;
  showAxisLabels: boolean;
  lamps: PlotLamp[];
  tlv: TlvBar | null;
  unitLabel: string;
  title?: string;
}

export function drawPlanePlot(ctx: CanvasRenderingContext2D, layout: PlaneLayout, o: PlanePlotOptions): void {
  const { plot, px } = layout;
  const { axes, palette } = o;
  const view = o.zoom;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (o.title && layout.titleY != null) {
    ctx.fillStyle = palette.text;
    ctx.font = `bold ${14 * px}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.title, layout.width / 2, layout.titleY);
  }

  drawPlaneData(ctx, plot, view, o);

  // World <-> screen under the zoom; v1 at the bottom
  const uSpan = axes.u2 - axes.u1 || 1;
  const vSpan = axes.v2 - axes.v1 || 1;
  const sx = (u: number) => plot.x + view.tx + ((u - axes.u1) / uSpan) * plot.w * view.k;
  const sy = (v: number) => plot.y + view.ty + (1 - (v - axes.v1) / vSpan) * plot.h * view.k;
  const ux = (x: number) => axes.u1 + ((x - plot.x - view.tx) / (plot.w * view.k)) * uSpan;
  const vy = (y: number) => axes.v1 + (1 - (y - plot.y - view.ty) / (plot.h * view.k)) * vSpan;

  // Lamps
  if (o.lamps.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    ctx.font = `${12 * px}px ${MONO}`;
    ctx.textBaseline = 'middle';
    for (const lamp of o.lamps) {
      const x = sx(lamp.u);
      const y = sy(lamp.v);
      ctx.beginPath();
      ctx.arc(x, y, 5 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      const w = ctx.measureText(lamp.name).width + 12 * px;
      const lx = Math.min(Math.max(x - w / 2, plot.x + 2 * px), plot.x + plot.w - w - 2 * px);
      const ly = y - 28 * px;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, w, 18 * px, 4 * px);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(lamp.name, lx + w / 2, ly + 9 * px);
    }
    ctx.restore();
  }

  // Frame
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1 * px;
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  // Ticks for the visible range
  const tickLen = 6 * px;
  ctx.strokeStyle = palette.text;
  ctx.fillStyle = palette.text;
  ctx.font = `${10 * px}px ${MONO}`;
  // d3 tick steps are 1, 2 or 5 x 10^n, so this many decimals shows each exactly
  const tickDecimals = (step: number) => Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  const uTicks = niceTicks(ux(plot.x), ux(plot.x + plot.w), Math.max(3, Math.round(plot.w / (90 * px))));
  const vTicks = niceTicks(vy(plot.y + plot.h), vy(plot.y), Math.max(3, Math.round(plot.h / (60 * px))));
  const uDec = tickDecimals(uTicks.length > 1 ? uTicks[1] - uTicks[0] : 1);
  const vDec = tickDecimals(vTicks.length > 1 ? vTicks[1] - vTicks[0] : 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of uTicks) {
    const x = sx(t);
    if (x < plot.x - 0.5 || x > plot.x + plot.w + 0.5) continue;
    if (o.showTickMarks) {
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.h);
      ctx.lineTo(x, plot.y + plot.h + tickLen);
      ctx.stroke();
    }
    if (o.showTickLabels) ctx.fillText(t.toFixed(uDec), x, plot.y + plot.h + tickLen + 2 * px);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of vTicks) {
    const y = sy(t);
    if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
    if (o.showTickMarks) {
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x - tickLen, y);
      ctx.stroke();
    }
    if (o.showTickLabels) ctx.fillText(t.toFixed(vDec), plot.x - tickLen - 3 * px, y);
  }
  if (o.showAxisLabels) {
    ctx.font = `${12 * px}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${axes.uLabel} (${axes.units})`, plot.x + plot.w / 2, plot.y + plot.h + 28 * px);
    ctx.save();
    ctx.translate(plot.x - 56 * px, plot.y + plot.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(`${axes.vLabel} (${axes.units})`, 0, 0);
    ctx.restore();
  }

  drawLegend(ctx, layout, o);
  if (o.tlv && layout.tlvX != null) drawTlvBar(ctx, layout, o.tlv, o.decimals, palette);
}

function drawLegend(ctx: CanvasRenderingContext2D, layout: PlaneLayout, o: PlanePlotOptions) {
  const { plot, px, legendX: x } = layout;
  const { scale, palette } = o;
  const y = plot.y;
  const w = 14 * px;
  const h = plot.h;
  ctx.font = `${10 * px}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.text;
  if (!scale.levels) {
    for (let k = 0; k < h; k++) {
      ctx.fillStyle = rgbCss(valueToColor(1 - k / h, scale.colormap));
      ctx.fillRect(x, y + k, w, 1.5);
    }
    ctx.fillStyle = palette.text;
    ctx.textBaseline = 'top';
    ctx.fillText(formatPlotValue(scale.range.max, o.decimals), x + w + 5 * px, y);
    ctx.textBaseline = 'middle';
    ctx.fillText(formatPlotValue((scale.range.min + scale.range.max) / 2, o.decimals), x + w + 5 * px, y + h / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatPlotValue(scale.range.min, o.decimals), x + w + 5 * px, y + h);
  } else {
    // One band per level above a floor band; boundaries labelled with the level values
    const n = scale.levels.length + 1;
    const bh = h / n;
    for (let b = 0; b < n; b++) {
      ctx.fillStyle = b === 0 ? palette.floor : scale.colors[b - 1];
      ctx.fillRect(x, y + h - (b + 1) * bh, w, bh + 0.5);
    }
    ctx.fillStyle = palette.text;
    ctx.textBaseline = 'middle';
    scale.levels.forEach((_, i) => ctx.fillText(levelText(scale, i, o.decimals), x + w + 5 * px, y + h - (i + 1) * bh));
  }
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1 * px;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = palette.muted;
  ctx.font = `${10 * px}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(o.unitLabel, x + w / 2 + 8 * px, y + h + 8 * px);
}

function drawTlvBar(ctx: CanvasRenderingContext2D, layout: PlaneLayout, tlv: TlvBar, decimals: number, palette: PlotPalette) {
  const { plot, px } = layout;
  const x = layout.tlvX as number;
  const y = plot.y;
  const w = 10 * px;
  const h = plot.h;
  // Scale tops out at the limit; a max above it pins to the top
  const yOf = (v: number) => y + h - Math.min(1, Math.max(0, v / tlv.limit)) * h;
  const grad = ctx.createLinearGradient(0, y + h, 0, y);
  grad.addColorStop(0, 'rgba(76, 175, 80, 0.05)');
  grad.addColorStop(1, 'rgba(76, 175, 80, 0.2)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1 * px;
  ctx.strokeRect(x, y, w, h);
  const bandTop = yOf(tlv.limit);
  const bandBottom = yOf(tlv.limit * 0.9);
  ctx.fillStyle = 'rgba(255, 235, 59, 0.35)';
  ctx.fillRect(x, bandTop, w, bandBottom - bandTop);

  const exceeds = tlv.max > tlv.limit;
  const iy = yOf(tlv.max);
  ctx.fillStyle = exceeds ? '#f44336' : '#4caf50';
  ctx.fillRect(x - 3 * px, iy - 1.5 * px, w + 6 * px, 3 * px);
  ctx.font = `${9 * px}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = exceeds ? '#f44336' : palette.text;
  ctx.fillText(formatPlotValue(tlv.max, decimals), x + w + 4 * px, iy);
  ctx.fillStyle = palette.muted;
  if (Math.abs(iy - y) > 12 * px) {
    ctx.textBaseline = 'top';
    ctx.fillText(formatPlotValue(tlv.limit, decimals), x + w + 4 * px, y);
  }
  ctx.textBaseline = 'bottom';
  ctx.fillText('0', x + w + 4 * px, y + h);
  ctx.font = `bold ${10 * px}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('TLV', x + w / 2, y + h + 8 * px);
  ctx.fillStyle = exceeds ? '#f44336' : '#4caf50';
  ctx.fillText(exceeds ? 'FAIL' : 'PASS', x + w / 2, y + h + 22 * px);
}
