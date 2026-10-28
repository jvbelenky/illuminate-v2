import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOCK, sanitizeDock, movePanel, toggleMinimized, swapMain, columnWidth, panelWidth, dropIndex,
  resizeColumn, resetColumnWidth, COLUMN_LIMITS,
} from './dockLayout';

describe('dockLayout', () => {
  it('moves results to the left under editor', () => {
    const l = movePanel(DEFAULT_DOCK, 'results', 'left', 1);
    expect(l.left).toEqual(['editor', 'results']);
    expect(l.right).toEqual(['mini']);
  });

  it('moves the mini view into an empty column', () => {
    const one = movePanel(DEFAULT_DOCK, 'editor', 'right', 0);
    expect(one.left).toEqual([]);
    const l = movePanel(one, 'mini', 'left', 0);
    expect(l.left).toEqual(['mini']);
    expect(l.right).toEqual(['editor', 'results']);
  });

  it('reorders within the same column', () => {
    const l = movePanel(DEFAULT_DOCK, 'results', 'right', 0);
    expect(l.right).toEqual(['results', 'mini']);
  });

  it('clamps an out-of-range index', () => {
    expect(movePanel(DEFAULT_DOCK, 'results', 'left', 99).left).toEqual(['editor', 'results']);
    expect(movePanel(DEFAULT_DOCK, 'results', 'left', -5).left).toEqual(['results', 'editor']);
  });

  it('does not mutate its input', () => {
    movePanel(DEFAULT_DOCK, 'results', 'left', 0);
    expect(DEFAULT_DOCK.right).toEqual(['mini', 'results']);
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

  it('column widths default to the panels in them (left 420; right 300, 420 once results exist)', () => {
    expect(columnWidth(DEFAULT_DOCK, 'left', false)).toBe(420);
    expect(columnWidth(DEFAULT_DOCK, 'right', false)).toBe(300);
    expect(columnWidth(DEFAULT_DOCK, 'right', true)).toBe(420);
    const both = movePanel(DEFAULT_DOCK, 'results', 'left', 1);
    expect(columnWidth(both, 'left', true)).toBe(420);
    expect(columnWidth(both, 'left', false)).toBe(420);
    expect(panelWidth('mini', true)).toBe(300);
  });

  it('an empty column is 0 wide, even with a stored width', () => {
    const l = movePanel(DEFAULT_DOCK, 'editor', 'right', 0);
    expect(columnWidth(l, 'left', true)).toBe(0);
    expect(columnWidth(resizeColumn(l, 'left', 400), 'left', true)).toBe(0);
  });

  it('a dragged width is clamped to the column limits', () => {
    expect(COLUMN_LIMITS.left).toEqual({ min: 320, max: 550 });
    expect(COLUMN_LIMITS.right).toEqual({ min: 260, max: 600 });
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 420.4), 'left', false)).toBe(420);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 100), 'left', false)).toBe(320);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'left', 9999), 'left', false)).toBe(550);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'right', 100), 'right', false)).toBe(260);
    expect(columnWidth(resizeColumn(DEFAULT_DOCK, 'right', 9999), 'right', false)).toBe(600);
  });

  it('a dragged width persists, and results arriving no longer resize that column', () => {
    const l = resizeColumn(DEFAULT_DOCK, 'right', 350);
    expect(l.widths).toEqual({ right: 350 });
    expect(columnWidth(l, 'right', false)).toBe(350);
    expect(columnWidth(l, 'right', true)).toBe(350);
    // The other column still follows its panels
    expect(columnWidth(l, 'left', true)).toBe(420);
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
    expect(columnWidth(r, 'right', true)).toBe(420);
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
    const ok = { left: ['results'], right: ['mini', 'editor'], minimized: ['mini'], main: '3d' };
    expect(sanitizeDock(ok)).toEqual(ok);
  });
});
