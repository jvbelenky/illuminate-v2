import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOCK, sanitizeDock, movePanel, toggleMinimized, swapMain, columnWidth, panelWidth, dropIndex,
  resizeColumn, resetColumnWidth, COLUMN_LIMITS,
  floatPanel, moveFloat, resizeFloat, dockFloating, FLOAT_DEFAULT, FLOAT_MIN,
} from './dockLayout';

describe('dockLayout', () => {
  it('moves results to the left under editor', () => {
    const l = movePanel(DEFAULT_DOCK, 'results', 'left', 1);
    expect(l.left).toEqual(['editor', 'results']);
    expect(l.right).toEqual(['mini', 'calculate']);
  });

  it('moves the mini view into an empty column', () => {
    const one = movePanel(DEFAULT_DOCK, 'editor', 'right', 0);
    expect(one.left).toEqual([]);
    const l = movePanel(one, 'mini', 'left', 0);
    expect(l.left).toEqual(['mini']);
    expect(l.right).toEqual(['editor', 'calculate', 'results']);
  });

  it('Calculate moves between columns and minimizes like the others', () => {
    const l = movePanel(DEFAULT_DOCK, 'calculate', 'left', 0);
    expect(l.left).toEqual(['calculate', 'editor']);
    expect(l.right).toEqual(['mini', 'results']);
    expect(toggleMinimized(l, 'calculate').minimized).toEqual(['calculate']);
    expect(sanitizeDock(JSON.parse(JSON.stringify(toggleMinimized(l, 'calculate'))))).toEqual(toggleMinimized(l, 'calculate'));
  });

  it('a stored layout without Calculate gets it directly above Results', () => {
    expect(sanitizeDock({ left: ['editor'], right: ['mini', 'results'], minimized: [], main: '2d' })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ left: ['editor', 'results'], right: ['mini'], minimized: [], main: '2d' }).left).toEqual(['editor', 'calculate', 'results']);
    expect(sanitizeDock({ left: ['results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' }))
      .toEqual({ left: ['calculate', 'results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' });
    expect(sanitizeDock({ left: ['editor'], right: ['calculate', 'mini', 'calculate', 'results'], minimized: [], main: '2d' })).toEqual(DEFAULT_DOCK);
  });

  it('reorders within the same column', () => {
    const l = movePanel(DEFAULT_DOCK, 'results', 'right', 0);
    expect(l.right).toEqual(['results', 'mini', 'calculate']);
  });

  it('clamps an out-of-range index', () => {
    expect(movePanel(DEFAULT_DOCK, 'results', 'left', 99).left).toEqual(['editor', 'results']);
    expect(movePanel(DEFAULT_DOCK, 'results', 'left', -5).left).toEqual(['results', 'editor']);
  });

  it('does not mutate its input', () => {
    movePanel(DEFAULT_DOCK, 'results', 'left', 0);
    expect(DEFAULT_DOCK.right).toEqual(['mini', 'calculate', 'results']);
  });

  it('toggleMinimized twice is identity', () => {
    const once = toggleMinimized(DEFAULT_DOCK, 'mini');
    expect(once.minimized).toEqual(['mini']);
    expect(toggleMinimized(once, 'mini')).toEqual(DEFAULT_DOCK);
  });

  it('swapMain flips main', () => {
    expect(swapMain(DEFAULT_DOCK).main).toBe('3d');
    expect(swapMain(swapMain(DEFAULT_DOCK))).toEqual(DEFAULT_DOCK);
  });

  it('column widths default to the widest panel in them; Results is a fixed 420', () => {
    expect(columnWidth(DEFAULT_DOCK, 'left')).toBe(420);
    expect(columnWidth(DEFAULT_DOCK, 'right')).toBe(420);
    const both = movePanel(DEFAULT_DOCK, 'results', 'left', 1);
    expect(columnWidth(both, 'left')).toBe(420);
    expect(panelWidth('results')).toBe(420);
    expect(panelWidth('calculate')).toBe(300);
    expect(columnWidth(movePanel(movePanel(DEFAULT_DOCK, 'results', 'left', 1), 'mini', 'left', 0), 'right')).toBe(300);
    expect(panelWidth('mini')).toBe(300);
  });

  it('an empty column is 0 wide, even with a stored width', () => {
    const l = movePanel(DEFAULT_DOCK, 'editor', 'right', 0);
    expect(columnWidth(l, 'left')).toBe(0);
    expect(columnWidth(resizeColumn(l, 'left', 400), 'left')).toBe(0);
  });

  it('a dragged width is clamped to the column limits', () => {
    expect(COLUMN_LIMITS.left).toEqual({ min: 320, max: 550 });
    expect(COLUMN_LIMITS.right).toEqual({ min: 260, max: 600 });
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 420.4), 'left')).toBe(420);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 100), 'left')).toBe(320);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 9999), 'left')).toBe(550);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'right', 100), 'right')).toBe(260);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'right', 9999), 'right')).toBe(600);
  });

  it('a dragged width persists, and results arriving no longer resize that column', () => {
    const l = resizeColumn(DEFAULT_DOCK, 'right', 350);
    expect(l.widths).toEqual({ right: 350 });
    expect(columnWidth(l, 'right')).toBe(350);
    expect(columnWidth(l, 'right')).toBe(350);
    // The other column still follows its panels
    expect(columnWidth(l, 'left')).toBe(420);
    // Survives a reload, moves, minimizing and a swap
    expect(sanitizeDock(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(movePanel(l, 'results', 'right', 0).widths).toEqual({ right: 350 });
    expect(toggleMinimized(l, 'mini').widths).toEqual({ right: 350 });
    expect(swapMain(l).widths).toEqual({ right: 350 });
  });

  it('reset (double-click) puts a column back on its default', () => {
    const l = resizeColumn(resizeColumn(DEFAULT_DOCK, 'right', 350), 'left', 500);
    const r = resetColumnWidth(l, 'right');
    expect(r.widths).toEqual({ left: 500 });
    expect(columnWidth(r, 'right')).toBe(420);
    expect(resetColumnWidth(r, 'left')).toEqual(DEFAULT_DOCK);
    expect(l.widths).toEqual({ right: 350, left: 500 });
  });

  it('sanitizeDock drops or clamps bad stored widths and keeps the layout', () => {
    const base = { left: ['editor'], right: ['mini', 'results'], minimized: [], main: '2d' };
    expect(sanitizeDock({ ...base, widths: 'wide' })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...base, widths: { left: 'x', right: NaN } })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...base, widths: { left: null, right: Infinity } })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...base, widths: { left: 10, right: 5000, middle: 300 } }).widths).toEqual({ left: 320, right: 600 });
    expect(sanitizeDock({ ...base, widths: { left: 333.6 } }).widths).toEqual({ left: 334 });
  });

  it('dropIndex gives the insertion index for a pointer y', () => {
    expect(dropIndex([10, 50, 90], 60)).toBe(2);
    expect(dropIndex([10, 50, 90], 0)).toBe(0);
    expect(dropIndex([10, 50, 90], 500)).toBe(3);
    expect(dropIndex([], 5)).toBe(0);
  });

  it('sanitizeDock', () => {
    expect(sanitizeDock(null)).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock('side')).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...DEFAULT_DOCK, left: ['editor', 'editor'] })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...DEFAULT_DOCK, right: ['mini'] })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...DEFAULT_DOCK, main: 'x' })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...DEFAULT_DOCK, minimized: ['nope'] })).toEqual(DEFAULT_DOCK);
    const ok = { left: ['calculate', 'results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' };
    expect(sanitizeDock(ok)).toEqual(ok);
  });

  describe('a floating mini view', () => {
    const area = { width: 1200, height: 800 };

    it('floatPanel lifts the mini view out of its column at the default size', () => {
      expect(FLOAT_DEFAULT).toEqual({ w: 300, h: 225 });
      const l = floatPanel(DEFAULT_DOCK, 400, 120);
      expect(l.right).toEqual(['calculate', 'results']);
      expect(l.left).toEqual(['editor']);
      expect(l.float).toEqual({ x: 400, y: 120, w: 300, h: 225 });
      expect(DEFAULT_DOCK.float).toBeUndefined();
    });

    it('floatPanel clamps into the area when given one, and keeps a floating size', () => {
      const l = floatPanel(DEFAULT_DOCK, 1100, -40, area);
      expect(l.float).toEqual({ x: 900, y: 0, w: 300, h: 225 });
      const big = resizeFloat(l, 500, 300, area);
      expect(floatPanel(big, 10, 10).float).toEqual({ x: 10, y: 10, w: 500, h: 300 });
    });

    it('moveFloat moves within the area', () => {
      const l = floatPanel(DEFAULT_DOCK, 100, 100);
      expect(moveFloat(l, 250.4, 300, area).float).toEqual({ x: 250, y: 300, w: 300, h: 225 });
      expect(moveFloat(l, -50, 9999, area).float).toEqual({ x: 0, y: 575, w: 300, h: 225 });
      expect(moveFloat(DEFAULT_DOCK, 10, 10, area)).toEqual(DEFAULT_DOCK);
    });

    it('resizeFloat holds the min and half the area, and keeps the window inside', () => {
      expect(FLOAT_MIN).toEqual({ w: 200, h: 150 });
      const l = floatPanel(DEFAULT_DOCK, 100, 100);
      expect(resizeFloat(l, 50, 20, area).float).toEqual({ x: 100, y: 100, w: 200, h: 150 });
      expect(resizeFloat(l, 5000, 5000, area).float).toEqual({ x: 100, y: 100, w: 600, h: 400 });
      const corner = moveFloat(l, 900, 575, area);
      expect(resizeFloat(corner, 600, 400, area).float).toEqual({ x: 600, y: 400, w: 600, h: 400 });
      expect(resizeFloat(DEFAULT_DOCK, 400, 300, area)).toEqual(DEFAULT_DOCK);
    });

    it('dockFloating (and moving the mini view) docks it again', () => {
      const l = floatPanel(DEFAULT_DOCK, 100, 100);
      const d = dockFloating(l, 'left', 1);
      expect(d.left).toEqual(['editor', 'mini']);
      expect(d.float).toBeUndefined();
      expect(movePanel(l, 'mini', 'right', 0)).toEqual(DEFAULT_DOCK);
    });

    it('survives minimizing, swaps, other moves and a reload', () => {
      const l = floatPanel(DEFAULT_DOCK, 100, 100);
      expect(toggleMinimized(l, 'mini').float).toEqual(l.float);
      expect(swapMain(l).float).toEqual(l.float);
      expect(movePanel(l, 'results', 'left', 0).float).toEqual(l.float);
      expect(sanitizeDock(JSON.parse(JSON.stringify(l)))).toEqual(l);
    });

    it('sanitizeDock takes a floating mini view and rejects inconsistent ones', () => {
      const f = { x: 100, y: 50, w: 300, h: 225 };
      const ok = { left: ['editor'], right: ['calculate', 'results'], minimized: [], main: '2d', float: f };
      expect(sanitizeDock(ok)).toEqual(ok);
      // Mini in a column and floating, or neither
      expect(sanitizeDock({ ...ok, right: ['mini', 'results'] })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...ok, float: null })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...ok, float: { x: 'a', y: 0, w: 300, h: 225 } })).toEqual(DEFAULT_DOCK);
      // Every other panel still exactly once
      expect(sanitizeDock({ ...ok, right: [] })).toEqual(DEFAULT_DOCK);
      // Negative positions and tiny sizes are clamped
      expect(sanitizeDock({ ...ok, float: { x: -20, y: -5, w: 10, h: 10 } }).float).toEqual({ x: 0, y: 0, w: 200, h: 150 });
      // A docked layout with a null float is just docked
      expect(sanitizeDock({ ...DEFAULT_DOCK, float: null })).toEqual(DEFAULT_DOCK);
    });
  });
});
