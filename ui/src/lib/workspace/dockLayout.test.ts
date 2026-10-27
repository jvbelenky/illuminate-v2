import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOCK, sanitizeDock, movePanel, toggleMinimized, swapMain, columnWidth, panelWidth, dropIndex,
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

  it('column widths', () => {
    expect(columnWidth([], true)).toBe(0);
    expect(columnWidth(['editor', 'results'], true)).toBe(420);
    expect(columnWidth(['editor', 'results'], false)).toBe(300);
    expect(panelWidth('mini', true)).toBe(300);
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
