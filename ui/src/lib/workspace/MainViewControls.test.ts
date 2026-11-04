import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import Harness from './test/WorkspaceHarness.svelte';
import { userSettings } from '$lib/stores/settings';
import type { PlanController } from '$lib/plan/planController.svelte';

vi.mock('$lib/utils/calculate', () => ({ performCalculation: vi.fn().mockResolvedValue({ success: true }) }));

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };

function mount(props: Record<string, unknown> = {}) {
  let ctl!: PlanController;
  const result = render(Harness, { props: { vertices: rect, units: 'meters', precision: 1, onController: (c: PlanController) => (ctl = c), ...props } });
  return { ...result, ctl };
}

const corner = (c: HTMLElement, name: 'tl' | 'tr' | 'bl' | 'bc') => c.querySelector(`.main-view-controls .corner.${name}`) as HTMLElement;
const labelsOf = (el: Element) => [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

describe('MainViewControls', () => {
  beforeEach(() => userSettings.update((s) => ({ ...s, planNavMode: 'hand', autoRecalculate: false })));

  it('Undo | Redo, a divider and the edit strip top-left; Calculate top-right; the view picker bottom-left; 2D | 3D bottom-middle', async () => {
    const onSelectMain = vi.fn();
    const { container, ctl } = mount({ controls: '2d', context: 'obstacles', onSelectMain });
    const tl = corner(container, 'tl');
    const strip = tl.querySelector('.plan-toolbar') as HTMLElement;
    const tools = [...strip.querySelectorAll('button')];
    expect(tools.map((b) => b.getAttribute('aria-label'))).toEqual(['Rectangle', 'Polygon']);
    expect(tools.map((b) => b.title)).toEqual(['Rectangle', 'Polygon']);
    for (const b of tools) expect(b.textContent?.trim()).toBe(b.getAttribute('aria-label'));
    // Undo | Redo first, then the divider, then the strip
    expect(tl.firstElementChild!.getAttribute('aria-label')).toBe('History');
    expect(strip.previousElementSibling!.classList.contains('tl-divider')).toBe(true);
    expect(strip.previousElementSibling!.previousElementSibling!.getAttribute('aria-label')).toBe('History');
    expect(labelsOf(tl).slice(0, 2)).toEqual(['Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)']);

    // Calculate, with Autorecalculate under it
    const tr = corner(container, 'tr');
    const calc = tr.querySelector('button.calculate-btn') as HTMLElement;
    expect(calc.textContent?.trim()).toBe('Calculate');
    const auto = within(tr).getByRole('checkbox');
    expect(auto.closest('label')!.textContent?.trim()).toBe('Autorecalculate');
    expect(calc.closest('.calculate-row')!.nextElementSibling).toBe(auto.closest('label'));

    // Plan view, then each wall; no Floor | Ceiling | Walls
    const bl = corner(container, 'bl');
    const pick = within(bl).getByRole('combobox', { name: '2D view' }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Plan view', 'Wall 1', 'Wall 2', 'Wall 3', 'Wall 4']);
    expect(pick.value).toBe('floor');
    expect(container.querySelector('.surface-switcher')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ceiling' })).toBeNull();
    await fireEvent.change(pick, { target: { value: 'wall:2' } });
    expect(ctl.surface).toBe('wall:2');

    const mainGroup = within(corner(container, 'bc')).getByRole('group', { name: 'Main view' });
    const two = within(mainGroup).getByRole('button', { name: '2D' });
    expect(two.getAttribute('aria-pressed')).toBe('true');
    // The pane itself has no toolbar or picker row of its own
    expect(container.querySelector('.plan-pane .plan-toolbar')).toBeNull();
    expect(container.querySelector('.plan-pane .surface-row')).toBeNull();
    await fireEvent.click(within(mainGroup).getByRole('button', { name: '3D' }));
    expect(onSelectMain).toHaveBeenCalledWith('3d');
  });

  it('the spinner sits beside Calculate, out of the layout', async () => {
    const { calculationStatus } = await import('$lib/stores/calculationStatus');
    const { container } = mount({ controls: '2d', context: 'outline' });
    const row = corner(container, 'tr').querySelector('.calculate-row') as HTMLElement;
    expect(row.querySelector('.calc-status')).toBeNull();
    calculationStatus.begin();
    await tick();
    const status = row.querySelector('.calc-status') as HTMLElement;
    expect(status.querySelector('.spinner')).not.toBeNull();
    // In the button's row (positioned out of the flow): Autorecalculate stays the row's next sibling
    expect(row.nextElementSibling!.classList.contains('autorecalc-label')).toBe(true);
    calculationStatus.finish('Server unreachable');
    await tick();
    // An error mark takes the same place
    expect(row.querySelector('.calc-status .error-indicator')).not.toBeNull();
    calculationStatus.reset();
  });

  it('with 3D main: no view picker, the edit strip stays top-left and Draw brings the 2D view up', async () => {
    const onNeedCanvas = vi.fn();
    const calls: unknown[][] = [];
    const other = { ...lamp, id: 'lamp-8', name: 'Other', x: 4 };
    const { container, ctl } = mount({ controls: '3d', mini: true, context: 'lamps', lamps: [lamp, other], onNeedCanvas, calls });
    expect(corner(container, 'bl')).toBeNull();
    expect(within(corner(container, 'bc')).getByRole('button', { name: '3D' }).getAttribute('aria-pressed')).toBe('true');
    const strip = corner(container, 'tl').querySelector('.plan-toolbar') as HTMLElement;
    expect([...strip.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Move', 'Aim', 'Copy', 'Delete']);
    // Delete acts on the selection here, without switching views
    ctl.selectedLampIds = ['lamp-7'];
    await tick();
    await fireEvent.click(within(strip).getByRole('button', { name: 'Delete' }));
    expect(calls.filter((c) => c[0] === 'removeLamp')).toEqual([['removeLamp', 'lamp-7']]);
    expect(onNeedCanvas).not.toHaveBeenCalled();
    // Aim works on the 2D canvas: the view switches first
    await fireEvent.click(within(strip).getByRole('button', { name: 'Aim' }));
    expect(onNeedCanvas).toHaveBeenCalledTimes(1);
  });

  it('Rectangle in 3D (structures) asks for the 2D view', async () => {
    const onNeedCanvas = vi.fn();
    const { container } = mount({ controls: '3d', mini: true, context: 'obstacles', onNeedCanvas });
    await fireEvent.click(within(corner(container, 'tl')).getByRole('button', { name: 'Rectangle' }));
    expect(onNeedCanvas).toHaveBeenCalledTimes(1);
  });

  it('the summary shows Undo | Redo alone top-left, and keeps the view picker and Calculate', () => {
    const { container } = mount({ controls: '2d', readonly: true, context: 'obstacles' });
    const tl = corner(container, 'tl');
    expect(tl.querySelector('.plan-toolbar')).toBeNull();
    expect(tl.querySelector('.tl-divider')).toBeNull();
    expect(labelsOf(tl)).toEqual(['Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)']);
    expect(within(corner(container, 'bl')).getByRole('combobox', { name: '2D view' })).toBeTruthy();
    expect(corner(container, 'tr').querySelector('button.calculate-btn')).not.toBeNull();
  });

  it('no surface name shows over the view', async () => {
    const { container, ctl } = mount({ controls: '2d', context: 'outline' });
    ctl.setSurface('wall:1');
    await tick();
    for (const name of ['tl', 'tr', 'bc'] as const) expect(corner(container, name).textContent).not.toContain('Wall');
  });
});

describe('the 2D view tools corner', () => {
  beforeEach(() => userSettings.update((s) => ({ ...s, planNavMode: 'hand' })));

  it('units, then Open in new tab and Save as image; no Undo, Pan, Zoom, − + or Fit; changing units changes the project units', async () => {
    const calls: unknown[][] = [];
    const { container } = mount({ controls: '2d', context: 'outline', calls });
    const tools = container.querySelector('.plan-pane .view-controls') as HTMLElement;
    const units = tools.firstElementChild as HTMLSelectElement;
    expect(units.tagName).toBe('SELECT');
    expect(units.title).toBe('Units');
    expect(units.value).toBe('meters');
    expect([...units.options].map((o) => o.textContent)).toEqual(['meters', 'centimeters', 'millimeters', 'feet', 'inches']);
    expect([...tools.querySelectorAll('button')].map((b) => b.title)).toEqual(['Open in new tab', 'Save as image']);
    expect(container.querySelector('.nav-fit, .nav-in, .nav-out, .nav-mode')).toBeNull();
    await fireEvent.change(units, { target: { value: 'feet' } });
    expect(calls.filter((c) => c[0] === 'changeUnits')).toEqual([['changeUnits', 'feet']]);
  });

  it('H and Z pick Pan and Zoom', async () => {
    mount({ controls: '2d', context: 'outline' });
    await fireEvent.keyDown(window, { key: 'z' });
    expect(get(userSettings).planNavMode).toBe('zoom');
    await fireEvent.keyDown(window, { key: 'h' });
    expect(get(userSettings).planNavMode).toBe('hand');
    // Ctrl+Z is undo, not Zoom
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(get(userSettings).planNavMode).toBe('hand');
  });

  it('the mini view has no units and no view tools', () => {
    const { container } = mount({ mini: true, context: 'outline' });
    expect(container.querySelector('.view-controls')).toBeNull();
    expect(container.querySelector('select[title="Units"]')).toBeNull();
  });
});

describe('on a phone (touch)', () => {
  beforeEach(() => userSettings.update((s) => ({ ...s, planNavMode: 'hand' })));

  const br = (c: HTMLElement) => c.querySelector('.main-view-controls .corner.br') as HTMLElement;

  it('Fit and the view picker top-right, ⤢ bottom-right, the strip bottom-left; no Pan, Zoom, − + or units', async () => {
    const onFit = vi.fn();
    const onToggleFullScreen = vi.fn();
    const { container, ctl } = mount({ controls: '2d', touch: true, context: 'obstacles', onFit, onToggleFullScreen });
    const tr = corner(container, 'tr');
    expect([...tr.querySelectorAll('button')].slice(0, 3).map((b) => b.getAttribute('aria-label'))).toEqual(['Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)', 'Fit']);
    await fireEvent.click(within(tr).getByRole('button', { name: 'Fit' }));
    expect(onFit).toHaveBeenCalledTimes(1);
    const surface = within(tr).getByRole('combobox', { name: '2D view' }) as HTMLSelectElement;
    expect([...surface.options].map((o) => o.textContent)).toEqual(['Plan view', 'Wall 1', 'Wall 2', 'Wall 3', 'Wall 4']);
    await fireEvent.change(surface, { target: { value: 'wall:0' } });
    expect(ctl.surface).toBe('wall:0');
    expect(tr.querySelector('button.calculate-btn')).toBeNull();

    expect(container.querySelector('.view-controls')).toBeNull();
    expect(container.querySelector('select[title="Units"]')).toBeNull();
    expect(corner(container, 'bl').querySelector('.plan-toolbar.compact')).toBeNull();

    const full = within(br(container)).getByRole('button', { name: 'Full screen view' });
    expect(full.textContent).toBe('⤢');
    await fireEvent.click(full);
    expect(onToggleFullScreen).toHaveBeenCalledTimes(1);
  });

  it('full screen shows ⤡ to leave it', () => {
    const { container } = mount({ controls: '2d', touch: true, fullScreen: true, context: 'obstacles' });
    expect(within(br(container)).getByRole('button', { name: 'Exit full screen' }).textContent).toBe('⤡');
  });

  it('3D shows only Undo | Redo and Fit top-right and no edit strip', () => {
    const { container } = mount({ controls: '3d', mini: true, touch: true, context: 'lamps', lamps: [lamp] });
    const tr = corner(container, 'tr');
    expect([...tr.querySelectorAll('button, select')].map((e) => e.getAttribute('aria-label'))).toEqual(['Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)', 'Fit']);
    expect(corner(container, 'bl')).toBeNull();
  });

  it('the summary keeps Fit and the dropdown but no edit strip', () => {
    const { container } = mount({ controls: '2d', touch: true, readonly: true, context: 'obstacles' });
    expect(within(corner(container, 'tr')).getByRole('combobox', { name: '2D view' })).toBeTruthy();
    expect(corner(container, 'bl')).toBeNull();
  });
});
