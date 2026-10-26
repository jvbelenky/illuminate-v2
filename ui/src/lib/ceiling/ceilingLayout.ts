/**
 * The ceiling designer's model: a tile grid (standard 2 ft acoustic tiles)
 * aligned to the room, and the things on the ceiling (smoke detectors, vents,
 * sensors, and keep-out areas where no lamp may go). Frontend-only: saved in
 * the project autosave and the `.guv` sidecar, never sent to the backend.
 * Coordinates are in the project's display units, like the room outline.
 */
import { z } from 'zod';
import { pointInPolygon, polygonBoundingBox, type Vertex } from '$lib/utils/roomGeometry';
import { fromMeters, METERS_PER_FOOT, type LengthUnit } from '$lib/utils/unitConversion';

export type TileSize = 'none' | '2x2' | '4x2' | '2x4';
export type TileAlign = 'tl' | 'tr' | 'bl' | 'br' | 'c';
export type PointKind = 'smoke' | 'vent' | 'sensor';
export type CeilingKind = PointKind | 'keep';

export interface CeilingPointItem { id: string; kind: PointKind; name: string; x: number; y: number; hidden?: boolean }
export interface CeilingKeepOut { id: string; kind: 'keep'; name: string; vertices: Vertex[]; yaw: number; hidden?: boolean }
export type CeilingItem = CeilingPointItem | CeilingKeepOut;

export interface CeilingLayout {
  tileSize: TileSize;
  align: TileAlign;
  /** Move grid: shifts the grid's origin from its alignment point. */
  offset: [number, number];
  ceilingShown: boolean;
  tilesShown: boolean;
  itemsShown: boolean;
  items: CeilingItem[];
}

export const DEFAULT_CEILING_LAYOUT: CeilingLayout = {
  tileSize: '2x2',
  align: 'tl',
  offset: [0, 0],
  ceilingShown: true,
  tilesShown: true,
  itemsShown: true,
  items: [],
};

/** Names for new items ("Smoke detector 2"). */
export const CEILING_KIND_NAMES: Record<CeilingKind, string> = {
  smoke: 'Smoke detector',
  vent: 'Vent',
  sensor: 'Sensor',
  keep: 'Keep-out area',
};

/** Fields that only change what is shown, never undo steps. */
export const CEILING_VIEW_KEYS = ['ceilingShown', 'tilesShown', 'itemsShown'] as const;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

const VertexSchema = z.tuple([z.number(), z.number()]);
const ItemSchema = z.union([
  z.object({ id: z.string(), kind: z.enum(['smoke', 'vent', 'sensor']), name: z.string(), x: z.number(), y: z.number(), hidden: z.boolean().optional() }),
  z.object({ id: z.string(), kind: z.literal('keep'), name: z.string(), vertices: z.array(VertexSchema).min(3), yaw: z.number(), hidden: z.boolean().optional() }),
]);
export const CeilingLayoutSchema = z.object({
  tileSize: z.enum(['none', '2x2', '4x2', '2x4']),
  align: z.enum(['tl', 'tr', 'bl', 'br', 'c']),
  offset: VertexSchema,
  ceilingShown: z.boolean(),
  tilesShown: z.boolean(),
  itemsShown: z.boolean(),
  items: z.array(ItemSchema),
});

/** A saved layout, validated; null when absent or malformed. */
export function parseCeilingLayout(value: unknown): CeilingLayout | null {
  if (value === undefined || value === null) return null;
  const result = CeilingLayoutSchema.safeParse(value);
  return result.success ? (result.data as CeilingLayout) : null;
}

/** One tile's width (along X) and height (along Y), in the project's units. */
export function tileSizeIn(units: LengthUnit, tileSize: TileSize): { tw: number; th: number } {
  if (tileSize === 'none') return { tw: 0, th: 0 };
  const [wFt, hFt] = tileSize === '2x2' ? [2, 2] : tileSize === '4x2' ? [4, 2] : [2, 4];
  const ft = (n: number) => (units === 'feet' ? n : units === 'inches' ? n * 12 : fromMeters(n * METERS_PER_FOOT, units));
  return { tw: ft(wFt), th: ft(hFt) };
}

export interface TileGrid { tw: number; th: number; ox: number; oy: number }

/**
 * The grid's tile size and the origin its lines run through: a corner of the
 * room's bounding box (room y points up, so "top" is y max), or for `c` the
 * corner of a tile centred on the room; then shifted by `offset`.
 */
export function tileGrid(layout: CeilingLayout, vertices: Vertex[], units: LengthUnit): TileGrid {
  const { tw, th } = tileSizeIn(units, layout.tileSize);
  const b = vertices.length ? polygonBoundingBox(vertices) : { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  const a = layout.align;
  const ox = a === 'c' ? (b.xMin + b.xMax) / 2 - tw / 2 : a === 'tr' || a === 'br' ? b.xMax : b.xMin;
  const oy = a === 'c' ? (b.yMin + b.yMax) / 2 - th / 2 : a === 'tl' || a === 'tr' ? b.yMax : b.yMin;
  return { tw, th, ox: r6(ox + layout.offset[0]), oy: r6(oy + layout.offset[1]) };
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }
type Box = { xMin: number; yMin: number; xMax: number; yMax: number };

/** The grid lines strictly inside a box, each spanning the whole box. */
export function tileLines(grid: TileGrid, bbox: Box): Segment[] {
  const out: Segment[] = [];
  const eps = 1e-6;
  if (grid.tw > 0) {
    for (let x = grid.ox + Math.ceil((bbox.xMin - grid.ox) / grid.tw) * grid.tw; x < bbox.xMax - eps; x += grid.tw) {
      if (x > bbox.xMin + eps) out.push({ x1: r6(x), y1: bbox.yMin, x2: r6(x), y2: bbox.yMax });
    }
  }
  if (grid.th > 0) {
    for (let y = grid.oy + Math.ceil((bbox.yMin - grid.oy) / grid.th) * grid.th; y < bbox.yMax - eps; y += grid.th) {
      if (y > bbox.yMin + eps) out.push({ x1: bbox.xMin, y1: r6(y), x2: bbox.xMax, y2: r6(y) });
    }
  }
  return out;
}

/** Cut axis-aligned grid lines to the parts inside the outline. */
export function clipTileLines(lines: Segment[], outline: Vertex[]): Segment[] {
  if (outline.length < 3) return [];
  const out: Segment[] = [];
  const n = outline.length;
  for (const l of lines) {
    const vertical = l.x1 === l.x2;
    const c = vertical ? l.x1 : l.y1;
    const [u, v] = vertical ? [0, 1] : [1, 0];
    // Where the line crosses the outline's edges (half-open, so a vertex counts once)
    const hits: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n];
      if ((a[u] <= c && c < b[u]) || (b[u] <= c && c < a[u])) hits.push(a[v] + ((c - a[u]) / (b[u] - a[u])) * (b[v] - a[v]));
    }
    hits.sort((p, q) => p - q);
    const lo = vertical ? Math.min(l.y1, l.y2) : Math.min(l.x1, l.x2);
    const hi = vertical ? Math.max(l.y1, l.y2) : Math.max(l.x1, l.x2);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const s = r6(Math.max(hits[k], lo)), e = r6(Math.min(hits[k + 1], hi));
      if (e - s <= 1e-9) continue;
      out.push(vertical ? { x1: c, y1: s, x2: c, y2: e } : { x1: s, y1: c, x2: e, y2: c });
    }
  }
  return out;
}

/** The centre of the tile under (x, y); unchanged when there are no tiles. */
export function snapToTileCentre(x: number, y: number, grid: TileGrid): Vertex {
  if (!(grid.tw > 0) || !(grid.th > 0)) return [x, y];
  return [
    r6(grid.ox + (Math.floor((x - grid.ox) / grid.tw) + 0.5) * grid.tw),
    r6(grid.oy + (Math.floor((y - grid.oy) / grid.th) + 0.5) * grid.th),
  ];
}

/** The grid corner nearest (x, y); unchanged when there are no tiles. */
function snapToTileCorner(x: number, y: number, grid: TileGrid): Vertex {
  if (!(grid.tw > 0) || !(grid.th > 0)) return [x, y];
  return [r6(grid.ox + Math.round((x - grid.ox) / grid.tw) * grid.tw), r6(grid.oy + Math.round((y - grid.oy) / grid.th) * grid.th)];
}

/**
 * A point near `target` that lies inside the outline: `snap(target)` when that
 * is inside, otherwise the nearest inside candidate (tile centres, or a fine
 * lattice over the room when there are no tiles). An L-shaped room's bounding
 * box can have its middle outside the room. A spot in `taken` (where another
 * item already sits) counts as unavailable, so new items do not pile up.
 */
function placeInside(target: Vertex, outline: Vertex[], grid: TileGrid, snap: (x: number, y: number) => Vertex, taken: Vertex[] = []): Vertex {
  const free = (p: Vertex) => !taken.some((q) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6);
  const inside = (p: Vertex) => outline.length < 3 || pointInPolygon(outline, p[0], p[1]);
  const first = snap(target[0], target[1]);
  if (inside(first) && free(first)) return first;
  if (outline.length < 3) return first;
  const b = polygonBoundingBox(outline);
  const candidates: Vertex[] = [];
  if (grid.tw > 0 && grid.th > 0) {
    for (let x = b.xMin; x <= b.xMax; x += grid.tw) for (let y = b.yMin; y <= b.yMax; y += grid.th) candidates.push(snap(x, y));
  } else {
    const steps = 32;
    for (let i = 1; i < steps; i++) for (let j = 1; j < steps; j++) candidates.push([r6(b.xMin + ((b.xMax - b.xMin) * i) / steps), r6(b.yMin + ((b.yMax - b.yMin) * j) / steps)]);
  }
  let best: Vertex | null = null;
  let bestD = Infinity;
  for (const p of candidates) {
    if (!pointInPolygon(outline, p[0], p[1]) || !free(p)) continue;
    const d = Math.hypot(p[0] - target[0], p[1] - target[1]);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best ?? first;
}

function nextId(items: CeilingItem[]): string {
  let max = 0;
  for (const it of items) {
    const m = /^ceiling-(\d+)$/.exec(it.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ceiling-${max + 1}`;
}

function nextName(kind: CeilingKind, items: CeilingItem[]): string {
  return `${CEILING_KIND_NAMES[kind]} ${items.filter((i) => i.kind === kind).length + 1}`;
}

/**
 * A new item in the middle of the room (kept inside an L-shaped outline). A
 * detector, vent or sensor sits in the middle of a tile; a keep-out area is a
 * 1.2 × 0.6 m rectangle centred on a tile corner.
 */
export function newItem(kind: CeilingKind, outline: Vertex[], layout: CeilingLayout, units: LengthUnit): CeilingItem {
  const grid = tileGrid(layout, outline, units);
  const b = outline.length ? polygonBoundingBox(outline) : { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  const mid: Vertex = [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2];
  const id = nextId(layout.items);
  const name = nextName(kind, layout.items);
  if (kind === 'keep') {
    const [cx, cy] = placeInside(mid, outline, grid, (x, y) => snapToTileCorner(x, y, grid));
    const hw = fromMeters(0.6, units), hh = fromMeters(0.3, units);
    const vertices: Vertex[] = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]].map(([x, y]) => [r6(x), r6(y)] as Vertex);
    return { id, kind, name, vertices, yaw: 0 };
  }
  const taken = layout.items.flatMap((i) => (i.kind === 'keep' ? [] : [[i.x, i.y] as Vertex]));
  const [x, y] = placeInside(mid, outline, grid, (px, py) => {
    const [sx, sy] = snapToTileCentre(px, py, grid);
    return [r6(sx), r6(sy)];
  }, taken);
  return { id, kind, name, x, y };
}

/** A copy of an item, shifted by (dx, dy), with the next id and name of its kind. */
export function copyItem(item: CeilingItem, layout: CeilingLayout, dx: number, dy = 0): CeilingItem {
  const id = nextId(layout.items);
  const name = nextName(item.kind, layout.items);
  if (item.kind === 'keep') return { ...item, id, name, vertices: item.vertices.map(([x, y]) => [r6(x + dx), r6(y + dy)] as Vertex) };
  return { ...item, id, name, x: r6(item.x + dx), y: r6(item.y + dy) };
}

/** The layout without what only changes the view (the eyes), for undo comparisons. */
export function ceilingContent(layout: CeilingLayout): Omit<CeilingLayout, (typeof CEILING_VIEW_KEYS)[number]> {
  const { ceilingShown: _c, tilesShown: _t, itemsShown: _i, ...rest } = layout;
  return { ...rest, items: rest.items.map(({ hidden: _h, ...it }) => it as CeilingItem) };
}

/** `target`'s content shown the way `current` shows it (undo restores content, not the eyes). */
export function withViewOf(target: CeilingLayout, current: CeilingLayout): CeilingLayout {
  const hidden = new Map(current.items.map((it) => [it.id, it.hidden]));
  return {
    ...target,
    ceilingShown: current.ceilingShown,
    tilesShown: current.tilesShown,
    itemsShown: current.itemsShown,
    items: target.items.map((it) => {
      const h = hidden.has(it.id) ? hidden.get(it.id) : it.hidden;
      const { hidden: _h, ...rest } = it;
      return (h ? { ...rest, hidden: true } : rest) as CeilingItem;
    }),
  };
}

/** The layout re-expressed after a units switch (factor = new units per old unit). */
export function scaleCeilingLayout(layout: CeilingLayout, factor: number): CeilingLayout {
  const s = (v: number) => r6(v * factor);
  return {
    ...layout,
    offset: [s(layout.offset[0]), s(layout.offset[1])],
    items: layout.items.map((it) => (it.kind === 'keep' ? { ...it, vertices: it.vertices.map(([x, y]) => [s(x), s(y)] as Vertex) } : { ...it, x: s(it.x), y: s(it.y) })),
  };
}
