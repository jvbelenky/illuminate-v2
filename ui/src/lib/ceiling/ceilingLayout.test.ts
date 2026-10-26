import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CEILING_LAYOUT,
  tileSizeIn,
  tileGrid,
  tileLines,
  clipTileLines,
  snapToTileCentre,
  newItem,
  copyItem,
  scaleCeilingLayout,
  parseCeilingLayout,
  MAX_TILE_LINES,
  copyInside,
  normalizeOffset,
  polygonInRoom,
  keepOutEditAllowed,
  pointMoveAllowed,
  type CeilingLayout,
} from './ceilingLayout';
import { pointInPolygon, polygonBoundingBox, type Vertex } from '$lib/utils/roomGeometry';

const rect: Vertex[] = [[0, 0], [10, 0], [10, 7], [0, 7]];
const layout = (partial: Partial<CeilingLayout> = {}): CeilingLayout => ({ ...DEFAULT_CEILING_LAYOUT, ...partial });

describe('ceiling layout', () => {
  it('tile size in metres and feet', () => {
    expect(tileSizeIn('feet', '2x2')).toEqual({ tw: 2, th: 2 });
    expect(tileSizeIn('feet', '4x2')).toEqual({ tw: 4, th: 2 });
    expect(tileSizeIn('feet', '2x4')).toEqual({ tw: 2, th: 4 });
    expect(tileSizeIn('meters', '2x2').tw).toBeCloseTo(0.6096, 9);
    expect(tileSizeIn('meters', '4x2').tw).toBeCloseTo(1.2192, 9);
    expect(tileSizeIn('centimeters', '2x2').th).toBeCloseTo(60.96, 9);
    expect(tileSizeIn('inches', '2x4')).toEqual({ tw: 24, th: 48 });
    expect(tileSizeIn('meters', 'none')).toEqual({ tw: 0, th: 0 });
  });

  it('alignment origins (corners and centre)', () => {
    const at = (align: CeilingLayout['align']) => {
      const g = tileGrid(layout({ align }), rect, 'feet');
      return [g.ox, g.oy];
    };
    // Room y points up: "top" is the far wall (y max)
    expect(at('tl')).toEqual([0, 7]);
    expect(at('tr')).toEqual([10, 7]);
    expect(at('bl')).toEqual([0, 0]);
    expect(at('br')).toEqual([10, 0]);
    // Centred: one tile sits in the middle of the room
    expect(at('c')).toEqual([4, 2.5]);
    const g = tileGrid(layout({ align: 'c', tileSize: '4x2' }), rect, 'feet');
    expect([g.ox, g.oy, g.tw, g.th]).toEqual([3, 2.5, 4, 2]);
  });

  it('Move grid offset shifts the origin', () => {
    const g = tileGrid(layout({ align: 'bl', offset: [0.5, -0.25] }), rect, 'feet');
    // The offset shifts the grid's phase, kept within one tile (-0.25 is the same lines as 1.75)
    expect([g.ox, g.oy]).toEqual([0.5, 1.75]);
    const ys = tileLines(g, polygonBoundingBox(rect)).filter((l) => l.y1 === l.y2).map((l) => l.y1);
    expect(ys).toEqual([1.75, 3.75, 5.75]);
    // The lines follow the shifted origin
    const xs = tileLines(g, polygonBoundingBox(rect)).filter((l) => l.x1 === l.x2).map((l) => l.x1);
    expect(xs).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
  });

  it('snap to tile centre', () => {
    const g = tileGrid(layout({ align: 'bl' }), rect, 'feet');
    expect(snapToTileCentre(2.3, 3.9, g)).toEqual([3, 3]);
    expect(snapToTileCentre(0.1, 0.1, g)).toEqual([1, 1]);
    const shifted = tileGrid(layout({ align: 'bl', offset: [0.5, 0] }), rect, 'feet');
    expect(snapToTileCentre(0.2, 0.2, shifted)).toEqual([-0.5, 1]);
    // No tiles: no snapping
    const none = tileGrid(layout({ tileSize: 'none' }), rect, 'feet');
    expect(snapToTileCentre(2.3, 3.9, none)).toEqual([2.3, 3.9]);
  });

  it('tiles are clipped to an L-shaped outline', () => {
    const L: Vertex[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const g = tileGrid(layout({ align: 'bl' }), L, 'feet');
    const segs = clipTileLines(tileLines(g, polygonBoundingBox(L)), L);
    // x = 6 only crosses the lower arm; y = 6 only the left arm
    expect(segs.filter((s) => s.x1 === 6 && s.x2 === 6)).toEqual([{ x1: 6, y1: 0, x2: 6, y2: 4 }]);
    expect(segs.filter((s) => s.y1 === 6 && s.y2 === 6)).toEqual([{ x1: 0, y1: 6, x2: 4, y2: 6 }]);
    // Every segment's midpoint lies inside the room
    for (const s of segs) expect(pointInPolygon(L, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)).toBe(true);
    // A new item lands inside the outline even though the bounding box's middle is outside
    expect(pointInPolygon(L, 5, 5)).toBe(false);
    const det = newItem('smoke', L, layout({ align: 'bl' }), 'feet');
    if (det.kind === 'keep') throw new Error('expected a point item');
    expect(pointInPolygon(L, det.x, det.y)).toBe(true);
    expect([(det.x - 1) % 2, (det.y - 1) % 2]).toEqual([0, 0]);
  });

  it('new items: a snapped point in the middle, or a 1.2 × 0.6 m keep-out', () => {
    const det = newItem('smoke', rect, layout({ align: 'bl' }), 'feet');
    expect(det).toMatchObject({ kind: 'smoke', name: 'Smoke detector 1', x: 5, y: 3 });
    const keep = newItem('keep', [[0, 0], [6, 0], [6, 4], [0, 4]], layout(), 'meters');
    if (keep.kind !== 'keep') throw new Error('expected a keep-out');
    const bb = polygonBoundingBox(keep.vertices);
    expect(bb.xMax - bb.xMin).toBeCloseTo(1.2, 9);
    expect(bb.yMax - bb.yMin).toBeCloseTo(0.6, 9);
    expect(keep.name).toBe('Keep-out area 1');
    const ft = newItem('keep', rect, layout(), 'feet');
    if (ft.kind !== 'keep') throw new Error('expected a keep-out');
    const fb = polygonBoundingBox(ft.vertices);
    expect(fb.xMax - fb.xMin).toBeCloseTo(1.2 / 0.3048, 6);
    // Names count up per kind, ids never repeat
    const second = newItem('smoke', rect, layout({ align: 'bl', items: [det] }), 'feet');
    expect(second.name).toBe('Smoke detector 2');
    expect(second.id).not.toBe(det.id);
    // ...and take the nearest free tile instead of piling onto the first
    if (second.kind === 'keep') throw new Error('expected a point item');
    expect([second.x, second.y]).not.toEqual([5, 3]);
    expect(Math.hypot(second.x - 5, second.y - 3)).toBeCloseTo(2, 6);
  });

  it('a copy is shifted, renamed and keeps its kind', () => {
    const det = newItem('vent', rect, layout({ align: 'bl' }), 'feet');
    const c = copyItem(det, layout({ items: [det] }), 2);
    expect(c).toMatchObject({ kind: 'vent', name: 'Vent 2' });
    if (c.kind === 'keep' || det.kind === 'keep') throw new Error('expected a point item');
    expect([c.x, c.y]).toEqual([det.x + 2, det.y]);
  });

  it('scales with a units switch', () => {
    const keep = newItem('keep', rect, layout(), 'feet');
    const l = scaleCeilingLayout(layout({ offset: [1, 2], items: [keep, { id: 'p', kind: 'sensor', name: 'S', x: 1, y: 2 }] }), 12);
    expect(l.offset).toEqual([12, 24]);
    expect(l.items[1]).toMatchObject({ x: 12, y: 24 });
  });

  it('a huge offset or an enormous room never runs away', () => {
    const g = tileGrid(layout({ align: 'bl', offset: [1e300, -1e300] }), rect, 'feet');
    expect(g.ox).toBeGreaterThanOrEqual(0);
    expect(g.ox).toBeLessThan(2);
    expect(Number.isFinite(g.oy)).toBe(true);
    const huge: Vertex[] = [[0, 0], [1e6, 0], [1e6, 10], [0, 10]];
    const t0 = Date.now();
    const lines = tileLines(tileGrid(layout({ align: 'bl' }), huge, 'feet'), polygonBoundingBox(huge));
    // Half a million lines across would be too small to draw: that axis is skipped
    expect(lines.length).toBeLessThanOrEqual(MAX_TILE_LINES * 2);
    expect(lines.filter((l) => l.x1 === l.x2)).toHaveLength(0);
    expect(lines.filter((l) => l.y1 === l.y2)).toHaveLength(4);
    // Placing in such a room is bounded too
    const det = newItem('smoke', [[0, 0], [1e6, 0], [1e6, 1e6], [5e5, 1e6], [5e5, 5e5], [0, 5e5]], layout({ align: 'bl' }), 'meters');
    expect(det.kind).toBe('smoke');
    expect(Date.now() - t0).toBeLessThan(2000);
    // A zero-size grid draws nothing
    expect(tileLines({ tw: 0, th: 0, ox: 0, oy: 0 }, polygonBoundingBox(rect))).toEqual([]);
  });

  it('saved data with out-of-range or non-finite numbers is rejected', () => {
    const bad = (over: Record<string, unknown>) => parseCeilingLayout({ ...DEFAULT_CEILING_LAYOUT, ...over });
    expect(bad({ offset: [1e300, 0] })).toBeNull();
    expect(bad({ offset: [Infinity, 0] })).toBeNull();
    expect(bad({ offset: [NaN, 0] })).toBeNull();
    expect(bad({ items: [{ id: 'ceiling-1', kind: 'smoke', name: 'A', x: 1e300, y: 0 }] })).toBeNull();
    expect(bad({ items: [{ id: 'ceiling-1', kind: 'keep', name: 'A', vertices: [[0, 0], [1, 0], [Infinity, 1]], yaw: 0 }] })).toBeNull();
    expect(bad({ items: [{ id: 'ceiling-1', kind: 'keep', name: 'A', vertices: [[0, 0], [1, 0], [1, 1]], yaw: NaN }] })).toBeNull();
    expect(bad({ offset: [1e5, -1e5] })).not.toBeNull();
  });

  it('saved data with duplicate or oversized ids is rejected; new ids ignore unsafe numbers', () => {
    const det = (id: string) => ({ id, kind: 'smoke', name: 'A', x: 1, y: 1 });
    expect(parseCeilingLayout({ ...DEFAULT_CEILING_LAYOUT, items: [det('ceiling-1'), det('ceiling-1')] })).toBeNull();
    expect(parseCeilingLayout({ ...DEFAULT_CEILING_LAYOUT, items: [det('ceiling-999999999999999999999')] })).toBeNull();
    expect(parseCeilingLayout({ ...DEFAULT_CEILING_LAYOUT, items: [det('lamp-1')] })).toBeNull();
    expect(parseCeilingLayout({ ...DEFAULT_CEILING_LAYOUT, items: [det('ceiling-1'), det('ceiling-2')] })).not.toBeNull();
    const huge = { id: 'ceiling-999999999999999999999', kind: 'smoke' as const, name: 'A', x: 1, y: 1 };
    expect(newItem('vent', rect, layout({ items: [huge] }), 'feet').id).toBe('ceiling-1');
  });

  it('an item left outside the room by a room change stays editable back in', () => {
    const inside: Vertex[] = [[1, 1], [3, 1], [3, 3], [1, 3]];
    const out: Vertex[] = [[8, 1], [12, 1], [12, 3], [8, 3]];
    // Inside before: the edit must stay inside
    expect(keepOutEditAllowed(inside, [[1, 1], [4, 1], [4, 3], [1, 3]], rect)).toBe(true);
    expect(keepOutEditAllowed(inside, [[8, 1], [12, 1], [12, 3], [8, 3]], rect)).toBe(false);
    // Already outside: any edit goes, so it can be brought back one step at a time
    expect(keepOutEditAllowed(out, [[8, 1], [11, 1], [11, 3], [8, 3]], rect)).toBe(true);
    expect(keepOutEditAllowed(out, [[8, 1], [13, 1], [13, 3], [8, 3]], rect)).toBe(true);
    // Points: inside always goes; from outside, closer goes and farther does not
    expect(pointMoveAllowed([5, 5], [6, 5], rect)).toBe(true);
    expect(pointMoveAllowed([5, 5], [11, 5], rect)).toBe(false);
    expect(pointMoveAllowed([12, 5], [11, 5], rect)).toBe(true);
    expect(pointMoveAllowed([12, 5], [9, 5], rect)).toBe(true);
    expect(pointMoveAllowed([12, 5], [13, 5], rect)).toBe(false);
    expect(pointMoveAllowed([12, 5], [12, 6], rect)).toBe(false);
  });

  it('items stay in the room: copies go the other way at a wall; areas crossing a wall are out', () => {
    const L: Vertex[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    expect(polygonInRoom([[1, 1], [3, 1], [3, 3], [1, 3]], L)).toBe(true);
    // Touching the walls is fine
    expect(polygonInRoom([[0, 0], [4, 0], [4, 4], [0, 4]], L)).toBe(true);
    // Corners inside, but an edge cuts across the notch
    expect(polygonInRoom([[3, 3], [6, 3], [3, 6]], L)).toBe(false);
    expect(polygonInRoom([[9, 1], [11, 1], [11, 2], [9, 2]], L)).toBe(false);
    const det = { id: 'ceiling-1', kind: 'smoke' as const, name: 'A', x: 9, y: 1 };
    const c = copyInside(det, layout({ items: [det] }), L, 2, 0);
    if (c.kind === 'keep') throw new Error('expected a point item');
    expect([c.x, c.y]).toEqual([7, 1]);
  });

  it('the stored offset is its phase within 4 ft, the same lines for every tile size', () => {
    expect(normalizeOffset([9, -1], 'feet')).toEqual([1, 3]);
    expect(normalizeOffset([1e5, 0], 'meters')[0]).toBeLessThan(1.2192);
    for (const tileSize of ['2x2', '4x2', '2x4'] as const) {
      const a = tileGrid(layout({ tileSize, align: 'bl', offset: [9, -1] }), rect, 'feet');
      const b = tileGrid(layout({ tileSize, align: 'bl', offset: normalizeOffset([9, -1], 'feet') }), rect, 'feet');
      expect([a.ox, a.oy]).toEqual([b.ox, b.oy]);
    }
  });

  it('parses saved data, dropping only a bad block', () => {
    expect(parseCeilingLayout(undefined)).toBeNull();
    expect(parseCeilingLayout({ tileSize: 'huge' })).toBeNull();
    const ok = parseCeilingLayout({ ...DEFAULT_CEILING_LAYOUT, items: [{ id: 'ceiling-1', kind: 'smoke', name: 'A', x: 1, y: 2 }] });
    expect(ok?.items).toHaveLength(1);
  });
});
