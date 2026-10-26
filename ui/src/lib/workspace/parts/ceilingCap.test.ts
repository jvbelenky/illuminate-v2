import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import type { PlanController } from '$lib/plan/planController.svelte';

// The real cap is 2000 items (the store test fills a layout that far); rendering
// that many rows takes over a minute here, so the UI is checked at a cap of 3.
vi.mock('$lib/ceiling/ceilingLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/ceiling/ceilingLayout')>()),
  MAX_CEILING_ITEMS: 3,
}));

afterEach(() => cleanup());

const rect: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const det = (n: number) => ({ id: `ceiling-${n}`, kind: 'smoke' as const, name: `D${n}`, x: 3, y: 3 });
const layout = (count: number) => ({
  tileSize: '2x2' as const, align: 'bl' as const, offset: [0, 0] as [number, number],
  ceilingShown: true, tilesShown: true, itemsShown: true,
  items: Array.from({ length: count }, (_, i) => det(i + 1)),
});

function mount(count: number) {
  const calls: unknown[][] = [];
  let ctl!: PlanController;
  render(Harness, { props: { vertices: rect, units: 'feet', precision: 1, part: 'ceiling', ceiling: layout(count), calls, onController: (c: PlanController) => (ctl = c) } });
  return { calls, ctl };
}

describe('ceiling item cap', () => {
  it('Add to ceiling is greyed out once the layout is full', () => {
    mount(3);
    for (const t of ['Detector', 'Vent', 'Sensor', 'Keep-out']) expect((screen.getByRole('button', { name: t }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mount(2);
    for (const t of ['Detector', 'Vent', 'Sensor', 'Keep-out']) expect((screen.getByRole('button', { name: t }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Copy and Ctrl+D do nothing once the layout is full', async () => {
    const { calls, ctl } = mount(3);
    ctl.selectCeilingItem('ceiling-1');
    await tick();
    await fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(calls.filter((c) => c[0] === 'copyCeilingItem')).toEqual([]);
    expect(ctl.selectedCeilingId).toBe('ceiling-1');
    expect(ctl.addCeilingItem('vent')).toBeNull();
    expect(calls.filter((c) => c[0] === 'addCeilingItem')).toEqual([]);
  });
});
