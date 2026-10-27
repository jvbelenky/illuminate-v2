import { describe, it, expect } from 'vitest';
import { orderSurfaceHits, nextSurface, chooseClickTarget, type ClickItem } from './surfacePicking';

describe('orderSurfaceHits', () => {
  it('puts the floor and far walls before the ceiling, and the ceiling before a near wall', () => {
    const order = orderSurfaceHits([
      { surface: 'wall:0', distance: 1, facesCamera: false },
      { surface: 'ceiling', distance: 2, facesCamera: false },
      { surface: 'wall:2', distance: 9, facesCamera: true },
      { surface: 'floor', distance: 6, facesCamera: true },
    ]);
    expect(order).toEqual(['floor', 'wall:2', 'ceiling', 'wall:0']);
  });

  it('keeps the ceiling between far and near surfaces even when seen from inside', () => {
    const order = orderSurfaceHits([
      { surface: 'ceiling', distance: 3, facesCamera: true },
      { surface: 'floor', distance: 1, facesCamera: false },
      { surface: 'wall:1', distance: 5, facesCamera: true },
    ]);
    expect(order).toEqual(['wall:1', 'ceiling', 'floor']);
  });

  it('lists each surface once', () => {
    const order = orderSurfaceHits([
      { surface: 'floor', distance: 4, facesCamera: true },
      { surface: 'floor', distance: 4.01, facesCamera: true },
      { surface: 'ceiling', distance: 1, facesCamera: false },
    ]);
    expect(order).toEqual(['floor', 'ceiling']);
  });

  it('is empty without hits', () => {
    expect(orderSurfaceHits([])).toEqual([]);
  });
});

describe('nextSurface', () => {
  const order = ['floor', 'wall:1', 'ceiling'] as const;

  it('steps to the surface after the current one', () => {
    expect(nextSurface([...order], 'floor')).toBe('wall:1');
    expect(nextSurface([...order], 'wall:1')).toBe('ceiling');
  });

  it('wraps after the last surface', () => {
    expect(nextSurface([...order], 'ceiling')).toBe('floor');
  });

  it('starts at the first surface when the current one is not under the cursor', () => {
    expect(nextSurface([...order], 'wall:3')).toBe('floor');
    expect(nextSurface([...order], null)).toBe('floor');
  });

  it('is null without surfaces', () => {
    expect(nextSurface([], 'floor')).toBeNull();
  });
});

describe('chooseClickTarget', () => {
  const lamp: ClickItem = { type: 'lamp', id: 'L1' };
  const zone: ClickItem = { type: 'zone', id: 'Z1' };
  const object: ClickItem = { type: 'object', id: 'O1' };

  it('an item wins over a surface in its context', () => {
    expect(chooseClickTarget([lamp, zone], ['floor', 'ceiling'], 'lamps')).toEqual({ kind: 'items', items: [lamp] });
    expect(chooseClickTarget([lamp, zone], ['floor'], 'zones')).toEqual({ kind: 'items', items: [zone] });
    expect(chooseClickTarget([object], ['floor'], 'obstacles')).toEqual({ kind: 'items', items: [object] });
  });

  it('uses the surfaces when no item applies to the context', () => {
    expect(chooseClickTarget([lamp], ['floor', 'ceiling'], 'zones')).toEqual({ kind: 'surface', order: ['floor', 'ceiling'] });
    expect(chooseClickTarget([lamp, zone, object], ['wall:0'], 'outline')).toEqual({ kind: 'surface', order: ['wall:0'] });
    expect(chooseClickTarget([], ['ceiling'], 'lamps')).toEqual({ kind: 'surface', order: ['ceiling'] });
  });

  it('does nothing when neither applies, or outside the editor', () => {
    expect(chooseClickTarget([lamp], [], 'zones')).toBeNull();
    expect(chooseClickTarget([lamp], ['floor'], null)).toBeNull();
  });
});
