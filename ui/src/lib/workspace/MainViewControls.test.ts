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

const corner = (c: HTMLElement, name: 'tl' | 'tr' | 'bl') => c.querySelector(`.main-view-controls .corner.${name}`) as HTMLElement;

describe('MainViewControls', () => {
  beforeEach(() => userSettings.update((s) => ({ ...s, planNavMode: 'hand', autoRecalculate: false })));

  it('puts 2D | 3D top-left, the surface switch top-right, the edit strip bottom-left; no Calculate', () => {
    const onSelectMain = vi.fn();
    const { container } = mount({ controls: '2d', context: 'obstacles', onSelectMain });
    const tl = corner(container, 'tl');
    const mainGroup = within(tl).getByRole('group', { name: 'Main view' });
    const two = within(mainGroup).getByRole('button', { name: '2D' });
    const three = within(mainGroup).getByRole('button', { name: '3D' });
    expect(two.getAttribute('aria-pressed')).toBe('true');
    expect(two.querySelector('svg')).toBeNull();
    const tr = corner(container, 'tr');
    expect(within(tl).queryByRole('group', { name: 'Surface' })).toBeNull();
    const surface = within(tr).getByRole('group', { name: 'Surface' });
    expect(within(surface).getByRole('button', { name: 'Floor' }).textContent?.trim()).toBe('Floor');
    expect(within(surface).getByRole('button', { name: 'Ceiling' }).textContent?.trim()).toBe('Ceiling');
    expect(within(surface).getByRole('combobox', { name: 'Walls' })).toBeTruthy();
    expect(surface.textContent).toContain('Walls ▾');
    expect(container.querySelector('button.calculate-btn')).toBeNull();

    const strip = corner(container, 'bl').querySelector('.plan-toolbar') as HTMLElement;
    const tools = [...strip.querySelectorAll('button')];
    expect(tools.map((b) => b.getAttribute('aria-label'))).toEqual(['Draw', 'Copy', 'Delete']);
    expect(tools.map((b) => b.title)).toEqual(['Draw', 'Copy (Ctrl+D)', 'Delete (Del)']);
    for (const b of tools) expect(b.textContent?.trim()).toBe(b.getAttribute('aria-label'));
    // The pane itself has no toolbar or surface row of its own
    expect(container.querySelector('.plan-pane .plan-toolbar')).toBeNull();
    expect(container.querySelector('.plan-pane .surface-row')).toBeNull();

    fireEvent.click(three);
    expect(onSelectMain).toHaveBeenCalledWith('3d');
  });

  it('with 3D main: no surface switch, the edit strip stays and Draw brings the 2D view up', async () => {
    const onNeedCanvas = vi.fn();
    const calls: unknown[][] = [];
    const other = { ...lamp, id: 'lamp-8', name: 'Other', x: 4 };
    const { container, ctl } = mount({ controls: '3d', mini: true, context: 'lamps', lamps: [lamp, other], onNeedCanvas, calls });
    expect(within(corner(container, 'tr')).queryByRole('group', { name: 'Surface' })).toBeNull();
    const strip = corner(container, 'bl').querySelector('.plan-toolbar') as HTMLElement;
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

  it('Draw in 3D (structures) asks for the 2D view', async () => {
    const onNeedCanvas = vi.fn();
    const { container } = mount({ controls: '3d', mini: true, context: 'obstacles', onNeedCanvas });
    await fireEvent.click(within(corner(container, 'bl')).getByRole('button', { name: 'Draw' }));
    expect(onNeedCanvas).toHaveBeenCalledTimes(1);
  });

  it('the summary keeps the surface switch in 2D but shows no edit strip', () => {
    const { container } = mount({ controls: '2d', readonly: true, context: 'obstacles' });
    expect(within(corner(container, 'tr')).getByRole('group', { name: 'Surface' })).toBeTruthy();
    expect(corner(container, 'bl')).toBeNull();
    expect(within(corner(container, 'tl')).getByRole('group', { name: 'Main view' })).toBeTruthy();
  });
});

describe('the 2D view tools corner', () => {
  beforeEach(() => userSettings.update((s) => ({ ...s, planNavMode: 'hand' })));

  it('units sit before Pan | Zoom | Fit, and changing them changes the project units', async () => {
    const calls: unknown[][] = [];
    const { container } = mount({ controls: '2d', context: 'outline', calls });
    const tools = container.querySelector('.plan-pane .view-controls') as HTMLElement;
    const units = tools.firstElementChild as HTMLSelectElement;
    expect(units.tagName).toBe('SELECT');
    expect(units.title).toBe('Units');
    expect(units.value).toBe('meters');
    expect([...units.options].map((o) => o.textContent)).toEqual(['meters', 'centimeters', 'millimeters', 'feet', 'inches']);
    expect([...tools.querySelectorAll('button')].map((b) => b.title)).toEqual(['Pan (H)', 'Zoom (Z)', 'Zoom out (−)', 'Zoom in (+)', 'Fit (F)']);
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
