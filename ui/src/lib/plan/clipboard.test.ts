import { describe, test, expect } from 'vitest';
import { get } from 'svelte/store';
import { clipboard, setClipboard, takePaste, clearClipboard } from './clipboard';
import type { CeilingItem } from '$lib/ceiling/ceilingLayout';

const item = { id: 'ceiling-1', kind: 'smoke', name: 'D', x: 1, y: 2 } as CeilingItem;

describe('in-app clipboard', () => {
  test('starts empty and has nothing to paste', () => {
    clearClipboard();
    expect(get(clipboard)).toBeNull();
    expect(takePaste()).toBeNull();
  });

  test('stores a snapshot: later changes to the source do not reach it', () => {
    const src = { ...item };
    setClipboard({ kind: 'ceiling', item: src });
    (src as { x: number }).x = 99;
    expect(takePaste()?.content).toEqual({ kind: 'ceiling', item });
  });

  test('each paste counts one further; a new copy starts over', () => {
    setClipboard({ kind: 'ceiling', item });
    expect(takePaste()?.n).toBe(1);
    expect(takePaste()?.n).toBe(2);
    setClipboard({ kind: 'ceiling', item });
    expect(takePaste()?.n).toBe(1);
  });
});
