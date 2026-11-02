import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import { interceptUndo } from '$lib/utils/undoKeys';
import type { PlanController } from '$lib/plan/planController.svelte';

vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  const web = { vertices: [], triangles: [], aim_line: [], surface_points: [], fixture_bounds: null, color: '#cc61ff' };
  return { ...actual, getPhotometricWeb: vi.fn(async () => web), getSessionLampPhotometricWeb: vi.fn(async () => web) };
});

afterEach(() => cleanup());

const room: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const detector = { id: 'ceiling-1', kind: 'smoke' as const, name: 'Hall detector', x: 3, y: 3 };
const keep = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[6, 4], [8, 4], [8, 6], [6, 6]] as [number, number][], yaw: 0 };
const ceiling = { tileSize: '2x2' as const, align: 'bl' as const, offset: [0, 0] as [number, number], ceilingShown: true, tilesShown: true, itemsShown: true, items: [detector, keep] };
const lamp = { id: 'lamp-1', name: 'L1', lamp_type: 'krcl_222', preset_id: 'beacon', has_ies_file: true, scaling_factor: 1, enabled: true, x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0 };

function mount(props: Record<string, unknown> = {}) {
  let ctl!: PlanController;
  let designer!: PlanController;
  const calls: unknown[][] = [];
  const result = render(Harness, {
    props: {
      vertices: room, units: 'feet', precision: 1, ceiling, calls,
      onController: (c: PlanController) => (ctl = c),
      onDesignerController: (c: PlanController) => (designer = c),
      ...props,
    },
  });
  return { ...result, ctl, designer, calls };
}

const dialog = () => screen.getByRole('dialog', { name: 'Ceiling designer' });
const names = (calls: unknown[][], name: string) => calls.filter((c) => c[0] === name);

describe('Ceiling designer window', () => {
  it('holds the ceiling list beside its own plan of the ceiling, and Close', async () => {
    const onCloseDesigner = vi.fn();
    mount({ designer: true, context: 'outline', onCloseDesigner });
    const d = dialog();
    expect(d.querySelector('.cd-list .ceiling-part')).not.toBeNull();
    expect(within(d).getByRole('heading', { name: 'Tile grid' })).toBeTruthy();
    expect(within(d).getByRole('heading', { name: 'Add to ceiling' })).toBeTruthy();
    const plan = d.querySelector('.cd-plan svg.plan')!;
    expect(plan).not.toBeNull();
    // The plan shows the ceiling's tiles and items, and the view tools and undo / redo
    expect(plan.querySelectorAll('line.tile-line').length).toBeGreaterThan(0);
    expect(within(d).getAllByRole('button', { name: 'Hall detector' }).length).toBeGreaterThan(0);
    expect(within(d).getByRole('group', { name: 'History' })).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Move grid' })).toBeTruthy();
    // No surface switcher: the window shows the ceiling only
    expect(d.querySelector('.surface-row')).toBeNull();
    const footer = d.querySelector('.cd-footer') as HTMLElement;
    await fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    expect(onCloseDesigner).toHaveBeenCalled();
  });

  it("an item opened in the list gets the strip's Copy and Delete in the window", async () => {
    const { designer, calls } = mount({ designer: true, context: 'outline' });
    const d = dialog();
    await fireEvent.click(d.querySelector('.editor-row[data-id="ceiling-1"] .row-main')!);
    expect(designer.selectedCeilingId).toBe('ceiling-1');
    const strip = d.querySelector('.cd-tools .plan-toolbar') as HTMLElement;
    expect([...strip.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Copy', 'Delete']);
    await fireEvent.click(within(strip).getByRole('button', { name: 'Delete' }));
    expect(names(calls, 'removeCeilingItem')).toEqual([['removeCeilingItem', 'ceiling-1']]);
  });

  it("keys go to the window's plan, not the main view's selection behind it", async () => {
    const { ctl, designer, calls } = mount({ designer: true, context: 'lamps', lamps: [lamp] });
    ctl.selectLamp('lamp-1');
    designer.selectCeilingItem('ceiling-1');
    await tick();
    await fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(names(calls, 'removeCeilingItem')).toEqual([['removeCeilingItem', 'ceiling-1']]);
    expect(names(calls, 'removeLamp')).toEqual([]);
    expect(ctl.selectedLampIds).toEqual(['lamp-1']);
  });

  it('Escape first drops the selection, then closes the window', async () => {
    const onCloseDesigner = vi.fn();
    const { designer } = mount({ designer: true, context: 'outline', onCloseDesigner });
    designer.selectCeilingItem('ceiling-1');
    await tick();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(designer.selectedCeilingId).toBeNull();
    expect(onCloseDesigner).not.toHaveBeenCalled();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCloseDesigner).toHaveBeenCalled();
  });

  it("Ctrl+Z goes to the window's plan first while it is open, and to the main view's again once it closes", async () => {
    const { ctl, designer, rerender } = mount({ designer: true, context: 'outline' });
    const main = vi.spyOn(ctl, 'undoInterceptor');
    const win = vi.spyOn(designer, 'undoInterceptor');
    interceptUndo('undo');
    expect(win).toHaveBeenCalled();
    expect(main).not.toHaveBeenCalled();
    await rerender({ designer: false });
    interceptUndo('undo');
    expect(main).toHaveBeenCalled();
  });
});

describe('the main view and the ceiling', () => {
  it('on the Ceiling surface it draws the tiles and items; an item clicked opens the designer on it', async () => {
    const onCeilingItemClick = vi.fn();
    const { ctl, container } = mount({ context: 'lamps', onCeilingItemClick });
    ctl.setSurface('ceiling');
    await tick();
    expect(container.querySelectorAll('line.tile-line').length).toBeGreaterThan(0);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Hall detector' }), { button: 0, pointerId: 1 });
    expect(onCeilingItemClick).toHaveBeenCalledWith('ceiling-1');
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Duct' }), { button: 0, pointerId: 1 });
    expect(onCeilingItemClick).toHaveBeenLastCalledWith('ceiling-2');
    // Nothing is selected or moved in the main view
    expect(ctl.selectedCeilingId).toBeNull();
  });

  it("the main view's strip has no ceiling tools", async () => {
    const { ctl, container } = mount({ context: 'lamps', lamps: [lamp] });
    ctl.setSurface('ceiling');
    await tick();
    const labels = [...container.querySelectorAll('.workspace-harness .plan-toolbar button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Move', 'Aim', 'Copy', 'Delete']);
    expect(screen.queryByRole('button', { name: 'Move grid' })).toBeNull();
  });
});
