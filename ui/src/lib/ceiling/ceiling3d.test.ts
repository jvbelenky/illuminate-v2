import { describe, it, expect } from 'vitest';
import { ceilingDrawing } from './ceiling3d';
import { DEFAULT_CEILING_LAYOUT, type CeilingLayout } from './ceilingLayout';
import type { Vertex } from '$lib/utils/roomGeometry';

const room: Vertex[] = [[0, 0], [8, 0], [8, 6], [0, 6]];
const layout = (over: Partial<CeilingLayout> = {}): CeilingLayout => ({
  ...DEFAULT_CEILING_LAYOUT,
  tileSize: '2x2',
  items: [
    { id: 'ceiling-1', kind: 'smoke', name: 'Smoke detector 1', x: 1, y: 1 },
    { id: 'ceiling-2', kind: 'vent', name: 'Vent 1', x: 3, y: 1 },
    { id: 'ceiling-3', kind: 'sensor', name: 'Sensor 1', x: 5, y: 1 },
    { id: 'ceiling-4', kind: 'keep', name: 'Keep-out area 1', vertices: [[1, 3], [3, 3], [3, 4], [1, 4]], yaw: 0 },
  ],
  ...over,
});
const draw = (l: CeilingLayout, selectedId: string | null = null) => ceilingDrawing(l, room, 'meters', selectedId);

describe('ceilingDrawing', () => {
  it('draws the tile lines and every item', () => {
    const d = draw(layout());
    expect(d.surface).toBe(true);
    expect(d.tiles.length).toBeGreaterThan(0);
    expect(d.items.map((i) => i.id)).toEqual(['ceiling-1', 'ceiling-2', 'ceiling-3', 'ceiling-4']);
  });

  it('ceilingShown off draws nothing, not even the surface', () => {
    const d = draw(layout({ ceilingShown: false }));
    expect(d.surface).toBe(false);
    expect(d.tiles).toEqual([]);
    expect(d.items).toEqual([]);
  });

  it('tilesShown off hides only the tile lines', () => {
    const d = draw(layout({ tilesShown: false }));
    expect(d.tiles).toEqual([]);
    expect(d.items).toHaveLength(4);
  });

  it('no tile size draws no tile lines', () => {
    expect(draw(layout({ tileSize: 'none' })).tiles).toEqual([]);
  });

  it('itemsShown off hides all items but not the tiles', () => {
    const d = draw(layout({ itemsShown: false }));
    expect(d.items).toEqual([]);
    expect(d.tiles.length).toBeGreaterThan(0);
  });

  it('an item hidden by its own eye is the only one missing', () => {
    const l = layout();
    l.items[1] = { ...l.items[1], hidden: true };
    expect(draw(l).items.map((i) => i.id)).toEqual(['ceiling-1', 'ceiling-3', 'ceiling-4']);
  });

  it('marks only the selected item', () => {
    const d = draw(layout(), 'ceiling-3');
    expect(d.items.filter((i) => i.selected).map((i) => i.id)).toEqual(['ceiling-3']);
  });

  it('tile lines stay inside the room', () => {
    for (const s of draw(layout()).tiles) {
      for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(8);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(6);
      }
    }
  });

  it('point items carry a size in the project units', () => {
    const m = draw(layout()).items[0];
    const f = ceilingDrawing(layout(), room, 'feet', null).items[0];
    expect(m.kind === 'keep' ? 0 : m.size).toBeGreaterThan(0);
    expect(f.kind !== 'keep' && m.kind !== 'keep' ? f.size / m.size : 0).toBeCloseTo(3.28084, 3);
  });
});
