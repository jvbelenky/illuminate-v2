import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOCK, sanitizeDock, movePanel, toggleMinimized, swapMain, columnWidth, panelWidth, dropIndex,
  resizeColumn, resetColumnWidth, COLUMN_LIMITS, fitColumns, MIN_MAIN_WIDTH,
  floatPanel, moveFloat, resizeFloat, dockFloating, floatInArea, FLOAT_DEFAULTS, FLOAT_MINS,
  splitPanels, resetSplit, splitPairs, fillPanel, minPanelHeight, BAR_HEIGHT,
  type DockLayout,
} from './dockLayout';

/** The previous default, for tests that are about moves rather than the default. */
const OLD: DockLayout = { left: ['editor'], right: ['mini', 'results'], minimized: [], main: '2d' };

describe('dockLayout', () => {
  it('the default: editor over the mini view on the left, Results on the right, 2D main', () => {
    expect(DEFAULT_DOCK).toEqual({ left: ['editor', 'mini'], right: ['results'], minimized: [], main: '2d' });
    expect(sanitizeDock(undefined)).toEqual(DEFAULT_DOCK);
  });

  it('moves results to the left under editor', () => {
    const l = movePanel(OLD, 'results', 'left', 1);
    expect(l.left).toEqual(['editor', 'results']);
    expect(l.right).toEqual(['mini']);
  });

  it('moves the mini view into an empty column', () => {
    const one = movePanel(OLD, 'editor', 'right', 0);
    expect(one.left).toEqual([]);
    const l = movePanel(one, 'mini', 'left', 0);
    expect(l.left).toEqual(['mini']);
    expect(l.right).toEqual(['editor', 'results']);
  });

  it('a stored layout keeps its own arrangement', () => {
    expect(sanitizeDock(OLD)).toEqual(OLD);
    const ok = { left: ['results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' };
    expect(sanitizeDock(ok)).toEqual(ok);
  });

  it('an old stored layout with a Calculate panel drops it cleanly', () => {
    expect(sanitizeDock({ left: ['editor'], right: ['mini', 'calculate', 'results'], minimized: [], main: '2d' })).toEqual(OLD);
    expect(sanitizeDock({ left: ['editor', 'mini'], right: ['calculate', 'results'], minimized: ['calculate'], main: '2d' })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ left: ['calculate', 'results'], right: ['mini', 'editor'], minimized: ['calculate', 'mini'], main: '3d' }))
      .toEqual({ left: ['results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' });
    const f = { x: 10, y: 10, w: 300, h: 120 };
    expect(sanitizeDock({ left: ['editor', 'mini'], right: ['results'], minimized: [], main: '2d', floats: { calculate: f }, heights: { calculate: 200 } }))
      .toEqual(DEFAULT_DOCK);
    const old = sanitizeDock({ left: ['editor', 'mini'], right: ['calculate', 'results'], minimized: [], main: '2d', heights: { calculate: 200, mini: 300 } });
    expect(old).toEqual({ ...DEFAULT_DOCK, heights: { mini: 300 } });
    // Still exactly once each
    expect(sanitizeDock({ left: ['editor'], right: ['mini', 'calculate', 'mini', 'results'], minimized: [], main: '2d' })).toEqual(DEFAULT_DOCK);
  });

  it('reorders within the same column', () => {
    expect(movePanel(OLD, 'results', 'right', 0).right).toEqual(['results', 'mini']);
  });

  it('clamps an out-of-range index', () => {
    expect(movePanel(OLD, 'results', 'left', 99).left).toEqual(['editor', 'results']);
    expect(movePanel(OLD, 'results', 'left', -5).left).toEqual(['results', 'editor']);
  });

  it('does not mutate its input', () => {
    movePanel(DEFAULT_DOCK, 'results', 'left', 0);
    floatPanel(DEFAULT_DOCK, 'editor', 10, 10);
    splitPanels(DEFAULT_DOCK, 'editor', 'mini', 400, 300, -50);
    expect(DEFAULT_DOCK).toEqual({ left: ['editor', 'mini'], right: ['results'], minimized: [], main: '2d' });
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

  it('default widths follow the window: the editor 22%, Results a fixed 420, within their limits', () => {
    expect(panelWidth('editor', 1600)).toBe(352);
    expect(panelWidth('results', 1600)).toBe(420);
    expect(panelWidth('editor', 1000)).toBe(280);
    expect(panelWidth('results', 1000)).toBe(420);
    expect(panelWidth('editor', 4000)).toBe(550);
    expect(panelWidth('results', 4000)).toBe(420);
    expect(panelWidth('mini', 1600)).toBe(300);
    expect(columnWidth(DEFAULT_DOCK, 'left', 1600)).toBe(352);
    expect(columnWidth(DEFAULT_DOCK, 'right', 1600)).toBe(420);
    // The mini view does not widen a column holding the editor or Results
    expect(columnWidth(DEFAULT_DOCK, 'left', 1200)).toBe(280);
    // A column of only the mini view is the mini view's width
    expect(columnWidth(movePanel(OLD, 'results', 'left', 1), 'right', 1600)).toBe(300);
    // Two fillers in a column: the wider default
    expect(columnWidth(movePanel(DEFAULT_DOCK, 'results', 'left', 1), 'left', 1600)).toBe(420);
    // Without a window width: a 1920 px window
    expect(columnWidth(DEFAULT_DOCK, 'left')).toBe(422);
    expect(columnWidth(DEFAULT_DOCK, 'right')).toBe(420);
  });

  it('a stored width wins over the window default', () => {
    const l = resizeColumn(DEFAULT_DOCK, 'left', 500);
    expect(columnWidth(l, 'left', 1000)).toBe(500);
    expect(columnWidth(l, 'right', 1000)).toBe(420);
  });

  it('on a narrow window the columns give way to the main view, down to their minimums', () => {
    const w = { left: 420, right: 420 };
    // Wide enough: untouched
    expect(fitColumns(w, 1600, 12)).toEqual(w);
    // 1280: both give way evenly, and the main view keeps its minimum
    const at1280 = fitColumns(w, 1280, 12);
    expect(1280 - 12 - at1280.left - at1280.right).toBe(MIN_MAIN_WIDTH);
    expect(at1280.left - COLUMN_LIMITS.left.min).toBeCloseTo((at1280.right - COLUMN_LIMITS.right.min) * (140 / 160), -1);
    // 1024: both stop at their minimums
    expect(fitColumns(w, 1024, 12)).toEqual({ left: COLUMN_LIMITS.left.min, right: COLUMN_LIMITS.right.min });
    // An empty column stays empty
    expect(fitColumns({ left: 420, right: 0 }, 800, 6)).toEqual({ left: COLUMN_LIMITS.left.min, right: 0 });
  });

  it('an empty column is 0 wide, even with a stored width; a column of floating panels is empty', () => {
    const l = movePanel(OLD, 'editor', 'right', 0);
    expect(columnWidth(l, 'left')).toBe(0);
    expect(columnWidth(resizeColumn(l, 'left', 400), 'left')).toBe(0);
    const f = floatPanel(floatPanel(DEFAULT_DOCK, 'editor', 0, 0), 'mini', 0, 0);
    expect(f.left).toEqual([]);
    expect(columnWidth(f, 'left')).toBe(0);
  });

  it('a dragged width is clamped to the column limits', () => {
    expect(COLUMN_LIMITS.left).toEqual({ min: 280, max: 550 });
    expect(COLUMN_LIMITS.right).toEqual({ min: 260, max: 600 });
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 420.4), 'left')).toBe(420);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 100), 'left')).toBe(280);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 9999), 'left')).toBe(550);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'right', 100), 'right')).toBe(260);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'right', 9999), 'right')).toBe(600);
  });

  it('a dragged width persists through a reload, moves, minimizing and a swap', () => {
    const l = resizeColumn(DEFAULT_DOCK, 'right', 350);
    expect(l.widths).toEqual({ right: 350 });
    expect(columnWidth(l, 'left')).toBe(422);
    expect(sanitizeDock(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(movePanel(l, 'results', 'right', 0).widths).toEqual({ right: 350 });
    expect(toggleMinimized(l, 'mini').widths).toEqual({ right: 350 });
    expect(swapMain(l).widths).toEqual({ right: 350 });
  });

  it('reset (double-click) puts a column back on its default', () => {
    const l = resizeColumn(resizeColumn(DEFAULT_DOCK, 'right', 350), 'left', 500);
    const r = resetColumnWidth(l, 'right');
    expect(r.widths).toEqual({ left: 500 });
    expect(columnWidth(r, 'right', 1600)).toBe(420);
    expect(resetColumnWidth(r, 'left')).toEqual(DEFAULT_DOCK);
  });

  it('sanitizeDock drops or clamps bad stored widths and keeps the layout', () => {
    const base = { left: ['editor', 'mini'], right: ['results'], minimized: [], main: '2d' };
    expect(sanitizeDock({ ...base, widths: 'wide' })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...base, widths: { left: 'x', right: NaN } })).toEqual(DEFAULT_DOCK);
    expect(sanitizeDock({ ...base, widths: { left: 10, right: 5000, middle: 300 } }).widths).toEqual({ left: 280, right: 600 });
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
    const ok = { left: ['results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' };
    expect(sanitizeDock(ok)).toEqual(ok);
  });

  describe('floating panels', () => {
    const area = { width: 1200, height: 800 };

    it('default and smallest floating sizes per panel', () => {
      expect(FLOAT_DEFAULTS.editor).toEqual({ w: 420, h: 600 });
      expect(FLOAT_DEFAULTS.results).toEqual({ w: 420, h: 500 });
      expect(FLOAT_DEFAULTS.mini).toEqual({ w: 300, h: 225 });
      expect(FLOAT_MINS.editor).toEqual({ w: 260, h: 200 });
      expect(FLOAT_MINS.results).toEqual({ w: 260, h: 200 });
      expect(FLOAT_MINS.mini).toEqual({ w: 200, h: 150 });
    });

    it.each(['editor', 'results', 'mini'] as const)('%s floats out of its column and docks again', (id) => {
      const l = floatPanel(DEFAULT_DOCK, id, 400, 120);
      expect([...l.left, ...l.right]).not.toContain(id);
      expect(l.floats?.[id]).toEqual({ x: 400, y: 120, ...FLOAT_DEFAULTS[id] });
      expect(sanitizeDock(JSON.parse(JSON.stringify(l)))).toEqual(l);
      const d = dockFloating(l, id, 'right', 0);
      expect(d.right[0]).toBe(id);
      expect(d.floats).toBeUndefined();
      // Minimizing keeps it where it floats
      expect(toggleMinimized(l, id).floats).toEqual(l.floats);
    });

    it('several panels float at once', () => {
      const l = floatPanel(floatPanel(DEFAULT_DOCK, 'results', 500, 100), 'editor', 10, 10);
      expect(Object.keys(l.floats!).sort()).toEqual(['editor', 'results']);
      expect(l.left).toEqual(['mini']);
      expect(l.right).toEqual([]);
      expect(sanitizeDock(JSON.parse(JSON.stringify(l)))).toEqual(l);
      expect(movePanel(l, 'results', 'left', 0).floats).toEqual({ editor: l.floats!.editor });
    });

    it('floatPanel clamps into the area when given one, and keeps a floating size', () => {
      const l = floatPanel(DEFAULT_DOCK, 'mini', 1100, -40, area);
      expect(l.floats?.mini).toEqual({ x: 900, y: 0, w: 300, h: 225 });
      const big = resizeFloat(l, 'mini', 500, 300, area);
      const back = floatPanel(dockFloating(big, 'mini', 'left', 1), 'mini', 10, 10);
      expect(back.floats?.mini).toEqual({ x: 10, y: 10, w: 300, h: 225 });
      expect(floatPanel(big, 'mini', 10, 10).floats?.mini).toEqual({ x: 10, y: 10, w: 500, h: 300 });
    });

    it('moveFloat moves within the area', () => {
      const l = floatPanel(DEFAULT_DOCK, 'results', 100, 100);
      expect(moveFloat(l, 'results', 250.4, 200, area).floats?.results).toEqual({ x: 250, y: 200, w: 420, h: 500 });
      expect(moveFloat(l, 'results', -50, 9999, area).floats?.results).toEqual({ x: 0, y: 300, w: 420, h: 500 });
      expect(moveFloat(DEFAULT_DOCK, 'results', 10, 10, area)).toEqual(DEFAULT_DOCK);
    });

    it('resizeFloat holds the min and the workspace size, and keeps the window inside', () => {
      const l = floatPanel(DEFAULT_DOCK, 'editor', 100, 100);
      expect(resizeFloat(l, 'editor', 50, 20, area).floats?.editor).toEqual({ x: 100, y: 100, w: 260, h: 200 });
      expect(resizeFloat(l, 'editor', 5000, 5000, area).floats?.editor).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
      expect(resizeFloat(floatPanel(DEFAULT_DOCK, 'mini', 0, 0), 'mini', 10, 10, area).floats?.mini).toEqual({ x: 0, y: 0, w: 200, h: 150 });
      expect(resizeFloat(DEFAULT_DOCK, 'editor', 400, 300, area)).toEqual(DEFAULT_DOCK);
    });

    it('floatInArea keeps a box inside the area at no more than its size', () => {
      expect(floatInArea({ x: 4000, y: 3000, w: 300, h: 225 }, area, 'mini')).toEqual({ x: 900, y: 575, w: 300, h: 225 });
      expect(floatInArea({ x: 0, y: 0, w: 2000, h: 2000 }, area, 'editor')).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
      expect(floatInArea({ x: 5, y: 5, w: 300, h: 225 }, null, 'mini')).toEqual({ x: 5, y: 5, w: 300, h: 225 });
    });

    it('sanitizeDock migrates the old mini float into floats.mini', () => {
      const f = { x: 100, y: 50, w: 300, h: 225 };
      const old = { left: ['editor'], right: ['calculate', 'results'], minimized: [], main: '2d', float: f };
      expect(sanitizeDock(old).right).toEqual(['results']);
      const l = sanitizeDock(old);
      expect(l.floats).toEqual({ mini: f });
      expect((l as unknown as Record<string, unknown>).float).toBeUndefined();
      expect(sanitizeDock({ left: ['editor'], right: ['results'], minimized: [], main: '2d', float: f }))
        .toEqual({ left: ['editor'], right: ['results'], minimized: [], main: '2d', floats: { mini: f } });
      // A docked layout with a null float is just docked
      expect(sanitizeDock({ ...DEFAULT_DOCK, float: null })).toEqual(DEFAULT_DOCK);
    });

    it('sanitizeDock rejects inconsistent or bad floats', () => {
      const f = { x: 100, y: 50, w: 300, h: 225 };
      const ok = { left: ['editor', 'mini'], right: [], minimized: [], main: '2d', floats: { results: { x: 10, y: 10, w: 420, h: 500 } } };
      expect(sanitizeDock(ok)).toEqual(ok);
      // Docked and floating at once, or neither
      expect(sanitizeDock({ ...ok, right: ['results'] })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...ok, floats: {} })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...ok, floats: { results: { x: 'a', y: 0, w: 300, h: 225 } } })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...ok, floats: { results: f, nope: f } })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...ok, floats: 'x' })).toEqual(DEFAULT_DOCK);
      // Negative positions and tiny sizes are clamped to the panel's minimum
      expect(sanitizeDock({ ...ok, floats: { results: { x: -20, y: -5, w: 10, h: 10 } } }).floats)
        .toEqual({ results: { x: 0, y: 0, w: 260, h: 200 } });
    });
  });

  describe('heights of stacked panels', () => {
    it('minimum heights: the bar plus 80, the mini view the bar plus 100', () => {
      expect(BAR_HEIGHT).toBe(26);
      expect(minPanelHeight('editor')).toBe(106);
      expect(minPanelHeight('results')).toBe(106);
      expect(minPanelHeight('mini')).toBe(126);
    });

    it('dragging the editor/mini divider stores the mini view height; widths stay', () => {
      const l = resizeColumn(DEFAULT_DOCK, 'left', 450);
      const s = splitPanels(l, 'editor', 'mini', 500, 340, 100);
      expect(s.heights).toEqual({ mini: 240 });
      expect(s.widths).toEqual({ left: 450 });
      expect(sanitizeDock(JSON.parse(JSON.stringify(s)))).toEqual(s);
    });

    it('two fillers store the upper one; the last filler always fills', () => {
      const l = movePanel(DEFAULT_DOCK, 'results', 'left', 1);
      expect(l.left).toEqual(['editor', 'results', 'mini']);
      const s = splitPanels(l, 'editor', 'results', 400, 300, -50);
      expect(s.heights).toEqual({ editor: 350 });
      expect(fillPanel(s, 'left')).toBe('results');
      expect(fillPanel(DEFAULT_DOCK, 'left')).toBe('editor');
      expect(fillPanel(DEFAULT_DOCK, 'right')).toBe('results');
      expect(fillPanel(toggleMinimized(DEFAULT_DOCK, 'editor'), 'left')).toBeNull();
    });

    it('height clamps: neither panel goes below its minimum', () => {
      expect(splitPanels(DEFAULT_DOCK, 'editor', 'mini', 500, 340, 9999).heights).toEqual({ mini: 126 });
      expect(splitPanels(DEFAULT_DOCK, 'editor', 'mini', 500, 340, -9999).heights).toEqual({ mini: 840 - 106 });
      expect(splitPanels(DEFAULT_DOCK, 'editor', 'mini', 500, 340.4, 0.2).heights).toEqual({ mini: 340 });
    });

    it('resetSplit (double-click) clears those two heights', () => {
      const s = splitPanels(DEFAULT_DOCK, 'editor', 'mini', 500, 340, 100);
      expect(resetSplit(s, 'editor', 'mini')).toEqual(DEFAULT_DOCK);
    });

    it('a moved or floated panel drops its height', () => {
      const s = splitPanels(DEFAULT_DOCK, 'editor', 'mini', 500, 340, 100);
      expect(movePanel(s, 'mini', 'right', 0).heights).toBeUndefined();
      expect(floatPanel(s, 'mini', 0, 0).heights).toBeUndefined();
      expect(movePanel(s, 'results', 'left', 0).heights).toEqual({ mini: 240 });
    });

    it('splitPairs: dividers pair the nearest resizable panels, skipping minimized ones', () => {
      expect(splitPairs(DEFAULT_DOCK, 'left')).toEqual([{ gap: 0, above: 'editor', below: 'mini' }]);
      expect(splitPairs(DEFAULT_DOCK, 'right')).toEqual([]);
      expect(splitPairs(OLD, 'right')).toEqual([{ gap: 0, above: 'mini', below: 'results' }]);
      expect(splitPairs(toggleMinimized(DEFAULT_DOCK, 'mini'), 'left')).toEqual([]);
      const three = movePanel(DEFAULT_DOCK, 'results', 'left', 1);
      expect(splitPairs(three, 'left')).toEqual([
        { gap: 0, above: 'editor', below: 'results' },
        { gap: 1, above: 'results', below: 'mini' },
      ]);
    });

    it('sanitizeDock drops bad heights and clamps small ones', () => {
      const base = { left: ['editor', 'mini'], right: ['results'], minimized: [], main: '2d' };
      expect(sanitizeDock({ ...base, heights: 'tall' })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...base, heights: { mini: NaN, editor: 'x', nope: 300, calculate: 200 } })).toEqual(DEFAULT_DOCK);
      expect(sanitizeDock({ ...base, heights: { mini: 10, editor: 300.6 } }).heights).toEqual({ mini: 126, editor: 301 });
      // A floating panel has no docked height
      expect(sanitizeDock({ ...base, left: ['editor'], floats: { mini: { x: 0, y: 0, w: 300, h: 225 } }, heights: { mini: 200 } }).heights).toBeUndefined();
    });
  });
});
