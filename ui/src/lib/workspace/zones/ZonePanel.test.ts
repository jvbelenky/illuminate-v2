import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import ZonePanel from './ZonePanel.svelte';
import type { CalcZone } from '$lib/types/project';
import { defaultRoom } from '$lib/types/project';
import type { PlanController } from '$lib/plan/planController.svelte';

// The lamp library store is imported by project.ts transitively.
vi.mock('$lib/stores/lampLibrary', async () => {
  const { writable } = await import('svelte/store');
  return {
    customLamps: writable<unknown[]>([]),
    lampLibrary: {
      get: vi.fn(),
      toIesFile: vi.fn(),
      toSpectrumFile: vi.fn(),
      toIntensityMapFile: vi.fn(),
      init: vi.fn(),
      isInitialized: vi.fn(() => false),
    },
  };
});

import { project } from '$lib/stores/project';
import { pickMode, pickResult } from '$lib/stores/pickMode';
import { get } from 'svelte/store';
import { MAX_NUMERIC_VOLUME_POINTS } from '$lib/utils/calculations';

const room = { ...defaultRoom(), x: 6, y: 4, z: 2.7, precision: 2 };

const floorPlane: CalcZone = {
  id: 'zone-1', name: 'Floor plane', type: 'plane', surface: 'floor', ref_surface: 'xy',
  height: 1.8, direction: 1, calc_mode: 'planar_normal', fit_room: true,
  x1: 0, x2: 6, y1: 0, y2: 4, num_x: 10, num_y: 12, x_spacing: 0.6, y_spacing: 0.33,
  offset: true, display_mode: 'heatmap',
};
const ceilingPlane: CalcZone = { ...floorPlane, id: 'zone-2', surface: 'ceiling', height: 2.4, direction: -1 };
const wallPlane: CalcZone = { ...floorPlane, id: 'zone-3', surface: 'wall:1', normal_offset: 0.2, flip: false };
const volume: CalcZone = {
  id: 'zone-4', name: 'Vol', type: 'volume', fit_room: true,
  x_min: 0, x_max: 6, y_min: 0, y_max: 4, z_min: 0, z_max: 2.7, num_x: 10, num_y: 12, num_z: 8, display_mode: 'heatmap',
};
const point: CalcZone = { id: 'zone-5', name: 'Pt', type: 'point', x: 2, y: 3, z: 1.8, aim_x: 2, aim_y: 4, aim_z: 1.8 };

function fakeController(extra: Partial<PlanController> = {}) {
  return { surface: 'floor', drawing: false, drawKind: null, startZoneDraw: vi.fn(), setSurface: vi.fn(), selectZone: vi.fn(), ...extra } as unknown as PlanController;
}

function renderPanel(zone: CalcZone, opts: { isStandard?: boolean; controller?: PlanController } = {}) {
  const controller = opts.controller ?? fakeController();
  const spy = vi.spyOn(project, 'updateZone').mockImplementation(() => {});
  const result = render(ZonePanel, { props: { zone, room, isStandard: opts.isStandard ?? false, controller } });
  return { ...result, spy, controller };
}

const fold = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const calcType = () => screen.getByRole('group', { name: 'Calculation type' });
const calcSummary = () => within(calcType()).getByRole('button', { expanded: false });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ZonePanel', () => {
  it('plane on floor shows Height and Flip, Draw outline, Fit to room, and folded Geometry, Grid points and Display', async () => {
    const { container, spy, controller } = renderPanel(floorPlane);
    expect(container.querySelector('.zone-panel')).not.toBeNull();
    expect(calcType()).toBeTruthy();
    const height = screen.getByLabelText(/^Height/) as HTMLInputElement;
    expect(parseFloat(height.value)).toBe(1.8);
    expect(screen.getByRole('button', { name: 'Flip' })).toBeTruthy();
    for (const name of ['Geometry', 'Grid points', 'Display']) expect(fold(name).getAttribute('aria-expanded')).toBe('false');

    await fireEvent.change(height, { target: { value: '0.75' } });
    expect(spy).toHaveBeenLastCalledWith('zone-1', { height: 0.75 });

    await fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    expect(spy).toHaveBeenLastCalledWith('zone-1', { direction: -1 });

    await fireEvent.click(screen.getByRole('button', { name: 'Draw outline' }));
    expect(controller.startZoneDraw).toHaveBeenCalledWith('plane');

    // Fit to room is a switch: off keeps the geometry as explicit bounds
    const fit = screen.getByRole('switch', { name: 'Fit to room' }) as HTMLInputElement;
    expect(fit.checked).toBe(true);
    await fireEvent.click(fit);
    expect(spy).toHaveBeenLastCalledWith('zone-1', { fit_room: false, x1: 0, x2: 6, y1: 0, y2: 4, vertices: undefined });
  });

  it('Fit to room switched on refits the plane to the room', async () => {
    const { spy } = renderPanel({ ...floorPlane, fit_room: false, x1: 1, x2: 2, y1: 1, y2: 2 });
    const fit = screen.getByRole('switch', { name: 'Fit to room' }) as HTMLInputElement;
    expect(fit.checked).toBe(false);
    await fireEvent.click(fit);
    const [, partial] = spy.mock.calls.at(-1)!;
    expect(partial).toMatchObject({ fit_room: true, x1: 0, x2: 6, y1: 0, y2: 4 });
    expect('vertices' in partial && partial.vertices === undefined).toBe(true);
  });

  it('the Reference surface select lists the floor, the ceiling and each wall, and moves the plane, keeping it selected', async () => {
    const { spy, controller } = renderPanel(floorPlane);
    const select = screen.getByLabelText('Reference surface') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Floor', 'Ceiling', 'Wall 1', 'Wall 2', 'Wall 3', 'Wall 4']);
    expect(select.value).toBe('floor');
    // Above Calculation type
    const calc = calcType();
    expect(select.compareDocumentPosition(calc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await fireEvent.change(select, { target: { value: 'wall:2' } });
    expect(spy).toHaveBeenLastCalledWith('zone-1', { surface: 'wall:2', fit_room: true, normal_offset: 0, flip: false, wall_vertices: undefined, wall_orphan: undefined });
    expect(controller.setSurface).toHaveBeenLastCalledWith('wall:2');
    expect(controller.selectZone).toHaveBeenLastCalledWith('zone-1');

    await fireEvent.change(select, { target: { value: 'ceiling' } });
    expect(spy.mock.calls.at(-1)![1]).toMatchObject({ surface: 'ceiling', fit_room: true, height: 2.7, direction: -1, ref_surface: 'xy' });
  });

  it('an orphaned plane shows no surface, so any can be chosen', async () => {
    const { spy } = renderPanel({ ...wallPlane, wall_orphan: true });
    const select = screen.getByLabelText('Reference surface') as HTMLSelectElement;
    expect(select.value).toBe('');
    const none = [...select.options].find((o) => o.value === '')!;
    expect(none.textContent).toBe('—');
    expect(none.disabled).toBe(true);
    await fireEvent.change(select, { target: { value: 'floor' } });
    expect(spy.mock.calls.at(-1)![1]).toMatchObject({ surface: 'floor', fit_room: true, height: 1.8, direction: 1, wall_orphan: undefined });
  });

  it('Geometry of a rectangle plane: X and Y ranges, an edit turns Fit off', async () => {
    const { spy, container } = renderPanel(floorPlane);
    await fireEvent.click(fold('Geometry'));
    expect(screen.getByText('X Range')).toBeTruthy();
    expect(screen.getByText('Y Range')).toBeTruthy();
    const vals = ['x1', 'x2', 'y1', 'y2'].map((n) => parseFloat((screen.getByLabelText(n) as HTMLInputElement).value));
    expect(vals).toEqual([0, 6, 0, 4]);
    expect(container.querySelector('.zone-panel')!.textContent).not.toMatch(/Corners/);
    await fireEvent.change(screen.getByLabelText('x2'), { target: { value: '3' } });
    expect(spy).toHaveBeenLastCalledWith('zone-1', { x1: 0, x2: 3, y1: 0, y2: 4, vertices: undefined, fit_room: false });
  });

  it('Geometry of a drawn outline: the corners table, its headings with no units', async () => {
    const { spy, container } = renderPanel({ ...floorPlane, fit_room: false, vertices: [[0.5, 0.5], [3, 0.5], [3, 2.5]] });
    await fireEvent.click(fold('Geometry'));
    expect(screen.queryByText('X Range')).toBeNull();
    const table = container.querySelector('.zp-corners')!;
    expect(table.querySelector('.zp-label')!.textContent).toBe('Corners');
    expect([...table.querySelectorAll('.zp-corner-head span')].map((s) => s.textContent)).toEqual(['', 'X', 'Y']);
    expect(table.textContent).not.toMatch(/\(m\)/);
    await fireEvent.change(screen.getByLabelText('Corner 2 X'), { target: { value: '4' } });
    expect(spy.mock.calls.at(-1)![1]).toMatchObject({ fit_room: false, x1: 0.5, x2: 4, y1: 0.5, y2: 2.5 });
  });

  it('plane on ceiling labels the distance Below ceiling and writes height = roomZ − value', async () => {
    const { spy } = renderPanel(ceilingPlane, { controller: fakeController({ surface: 'ceiling' }) });
    const below = screen.getByLabelText(/^Below ceiling/) as HTMLInputElement;
    expect(parseFloat(below.value)).toBeCloseTo(0.3, 6);
    expect(screen.getByRole('button', { name: 'Draw outline' })).toBeTruthy();
    await fireEvent.change(below, { target: { value: '0.5' } });
    const [id, partial] = spy.mock.calls.at(-1)!;
    expect(id).toBe('zone-2');
    expect(Object.keys(partial)).toEqual(['height']);
    expect(partial.height).toBeCloseTo(2.2, 9);
    await fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    expect(spy).toHaveBeenLastCalledWith('zone-2', { direction: 1 });
  });

  it('plane on a wall labels it From wall and writes normal_offset', async () => {
    const { spy } = renderPanel(wallPlane, { controller: fakeController({ surface: 'wall:1' }) });
    const from = screen.getByLabelText(/^From wall/) as HTMLInputElement;
    expect(parseFloat(from.value)).toBe(0.2);
    expect(screen.queryByLabelText(/^Height/)).toBeNull();
    await fireEvent.change(from, { target: { value: '0.6' } });
    expect(spy).toHaveBeenLastCalledWith('zone-3', { normal_offset: 0.6 });
    await fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    expect(spy).toHaveBeenLastCalledWith('zone-3', { flip: true });
    expect(screen.getByRole('button', { name: 'Draw outline' })).toBeTruthy();
    const fit = screen.getByRole('switch', { name: 'Fit to wall' }) as HTMLInputElement;
    expect(fit.checked).toBe(true);
    await fireEvent.click(fit);
    expect(spy).toHaveBeenLastCalledWith('zone-3', { fit_room: false, wall_vertices: [[0, 0], [4, 0], [4, 2.7], [0, 2.7]] });
    // No Flat/Upright switch on a wall; the ranges are in wall coordinates, the whole wall while fit
    expect(screen.queryByText(/Upright|Flat/)).toBeNull();
    await fireEvent.click(fold('Geometry'));
    expect(screen.getByText('Along Range')).toBeTruthy();
    expect(screen.getByText('Up Range')).toBeTruthy();
    expect(['a1', 'a2', 'u1', 'u2'].map((n) => parseFloat((screen.getByLabelText(n) as HTMLInputElement).value))).toEqual([0, 4, 0, 2.7]);
    await fireEvent.change(screen.getByLabelText('u2'), { target: { value: '2' } });
    expect(spy).toHaveBeenLastCalledWith('zone-3', { wall_vertices: [[0, 0], [4, 0], [4, 2], [0, 2]], fit_room: false });
  });

  it('a wall plane with a drawn outline shows its corners as Along and Up', async () => {
    renderPanel({ ...wallPlane, fit_room: false, wall_vertices: [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5]] });
    await fireEvent.click(fold('Geometry'));
    expect(screen.getByLabelText('Corner 1 Along')).toBeTruthy();
    expect(screen.getByLabelText('Corner 1 Up')).toBeTruthy();
  });

  it('no Type switch, no presets, no Whole room checkbox, no Delete/Copy/Close', () => {
    const { container } = renderPanel(floorPlane);
    expect(container.querySelector('.zone-type-btn')).toBeNull();
    for (const name of ['Plane', 'Volume', 'Point', 'Floor', 'Work Surface', 'Head Height', 'Delete', 'Copy', 'Close']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('Whole room')).toBeNull();
    expect(screen.queryByText(/Reference Surface|Normal Direction/)).toBeNull();
    expect(container.querySelector('.help-text')).toBeNull();
  });

  it('volume shows Bottom and Top', async () => {
    const { spy, controller } = renderPanel(volume);
    const bottom = screen.getByLabelText(/^Bottom/) as HTMLInputElement;
    const top = screen.getByLabelText(/^Top/) as HTMLInputElement;
    expect(parseFloat(bottom.value)).toBe(0);
    expect(parseFloat(top.value)).toBe(2.7);
    await fireEvent.change(top, { target: { value: '2' } });
    expect(spy).toHaveBeenLastCalledWith('zone-4', { z_min: 0, z_max: 2 });
    await fireEvent.click(screen.getByRole('button', { name: 'Draw outline' }));
    expect(controller.startZoneDraw).toHaveBeenCalledWith('volume');
    const fit = screen.getByRole('switch', { name: 'Fit to room' }) as HTMLInputElement;
    expect(fit.checked).toBe(true);
    await fireEvent.click(fit);
    expect(spy).toHaveBeenLastCalledWith('zone-4', { fit_room: false, x_min: 0, x_max: 6, y_min: 0, y_max: 4, vertices: undefined });
    await fireEvent.click(fold('Geometry'));
    await fireEvent.change(screen.getByLabelText('y1'), { target: { value: '1' } });
    expect(spy).toHaveBeenLastCalledWith('zone-4', { x_min: 0, x_max: 6, y_min: 1, y_max: 4, vertices: undefined, fit_room: false });
    expect(fold('Grid points').textContent).toMatch('10 × 12 × 8');
    await fireEvent.click(fold('Display'));
    const seg = screen.getByRole('group', { name: 'Display mode' });
    expect(within(seg).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Iso', 'Numeric', 'Markers', 'None']);
  });

  it('point shows Position and Aim at rows with X Y Z and Place / Aim buttons', async () => {
    const { spy } = renderPanel(point);
    const pos = screen.getByRole('group', { name: /^Position/ });
    const aim = screen.getByRole('group', { name: /^Aim at/ });
    expect(within(pos).getAllByRole('textbox')).toHaveLength(3);
    expect(within(aim).getAllByRole('textbox')).toHaveLength(3);
    for (const axis of ['X', 'Y', 'Z']) {
      expect(within(pos).getByLabelText(axis)).toBeTruthy();
      expect(within(aim).getByLabelText(axis)).toBeTruthy();
    }
    await fireEvent.change(within(pos).getByLabelText('Y'), { target: { value: '3.5' } });
    expect(spy).toHaveBeenLastCalledWith('zone-5', { y: 3.5 });
    expect(screen.getByRole('button', { name: 'Place' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aim' })).toBeTruthy();
    expect(fold('Display').getAttribute('aria-expanded')).toBe('false');
    expect(fold('Advanced').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^Grid points/ })).toBeNull();
  });

  it('Grid points fold shows Points | Spacing and Inset | On edge, closed by default with the summary', async () => {
    const { spy } = renderPanel(floorPlane);
    const disc = fold('Grid points');
    expect(disc.getAttribute('aria-expanded')).toBe('false');
    expect(disc.textContent).toMatch('10 × 12');
    expect(screen.queryByRole('button', { name: 'Spacing' })).toBeNull();
    await fireEvent.click(disc);
    for (const name of ['Points', 'Spacing', 'Inset', 'On edge']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByText('0.60 × 0.33 m')).toBeTruthy();
    await fireEvent.change(screen.getByLabelText('X'), { target: { value: '20' } });
    expect(spy).toHaveBeenLastCalledWith('zone-1', { num_x: 20 });
    await fireEvent.click(screen.getByRole('button', { name: 'On edge' }));
    expect(spy).toHaveBeenLastCalledWith('zone-1', { offset: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Spacing' }));
    expect(spy).toHaveBeenLastCalledWith('zone-1', { resolution_mode: 'spacing' });
  });

  it('standard zone shows only Grid points', () => {
    renderPanel({ ...floorPlane, id: 'EyeLimits', isStandard: true }, { isStandard: true });
    expect(fold('Grid points').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('group', { name: 'Calculation type' })).toBeNull();
    expect(screen.queryByLabelText(/^Height/)).toBeNull();
    for (const name of ['Geometry', 'Display', 'Flip', 'Draw outline']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull();
    }
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByLabelText('Reference surface')).toBeNull();
  });

  it('a zone changed elsewhere shows the new values', async () => {
    const { rerender } = renderPanel(floorPlane);
    await fireEvent.click(fold('Grid points'));
    await rerender({ zone: { ...floorPlane, height: 1.2, num_x: 7 } });
    expect(parseFloat((screen.getByLabelText(/^Height/) as HTMLInputElement).value)).toBe(1.2);
    expect(parseFloat((screen.getByLabelText('X') as HTMLInputElement).value)).toBe(7);
    expect(fold('Grid points').textContent).toMatch('7 × 12');
  });

  it('a legacy vertical plane shows its geometry read-only, with no distance, Draw or Fit', async () => {
    renderPanel({ ...floorPlane, id: 'zone-6', surface: undefined, ref_surface: 'xz', height: 1, z_min: 0, z_max: 2.7 });
    expect(calcType()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Flip' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Draw/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByLabelText('Reference surface')).toBeNull();
    await fireEvent.click(fold('Geometry'));
    expect(screen.getByText('X Range')).toBeTruthy();
    expect(screen.getByText('Z Range')).toBeTruthy();
    const inputs = [...document.querySelectorAll('.zone-panel .fold-body input')] as HTMLInputElement[];
    expect(inputs).toHaveLength(4);
    expect(inputs.every((i) => i.disabled)).toBe(true);
  });

  it('the calculation type shows its illustration and title, and opens to illustrated options', async () => {
    const { container } = renderPanel(floorPlane);
    const summary = calcSummary();
    expect(summary.textContent?.trim()).toBe('Planar Normal');
    expect(summary.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.calc-options')).toBeNull();
    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    const options = [...container.querySelectorAll('.calc-option')] as HTMLElement[];
    expect(options.map((o) => o.querySelector('.calc-option-title')?.textContent)).toEqual([
      'Fluence Rate', 'Planar Normal', 'Planar Maximum', 'Eye (Worst Case)', 'Eye (Directional)', 'Eye (Target)', 'Custom',
    ]);
    for (const o of options) {
      expect(o.querySelector('svg')).not.toBeNull();
      expect(o.querySelector('.calc-option-desc')?.textContent?.length).toBeGreaterThan(10);
    }
    expect(options[1].getAttribute('aria-pressed')).toBe('true');
    expect(options[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('choosing a calculation type sets the mode with its flags and closes the options', async () => {
    const { spy, container } = renderPanel(floorPlane);
    await fireEvent.click(calcSummary());
    await fireEvent.click(within(calcType()).getByRole('button', { name: /^Eye \(Worst Case\)/ }));
    expect(spy.mock.calls.at(-1)![1]).toMatchObject({ calc_mode: 'eye_worst_case', fov_vert: 80, fov_horiz: 120 });
    expect(container.querySelector('.calc-options')).toBeNull();
  });

  it('Eye (Target) keeps its Target fields under the calculation type', async () => {
    renderPanel({ ...floorPlane, calc_mode: 'eye_target', view_target: [1, 2, 3] });
    expect(calcSummary().textContent?.trim()).toBe('Eye (Target)');
    expect(screen.getByRole('group', { name: 'Target' })).toBeTruthy();
  });

  it('flags an exposure time of zero', async () => {
    const { container } = renderPanel({ ...floorPlane, dose: true, hours: 0, minutes: 0, seconds: 0 });
    await fireEvent.click(fold('Display'));
    expect(container.querySelector('.time-inputs.invalid')).toBeTruthy();
  });

  it('does not flag a valid exposure time', async () => {
    const { container } = renderPanel({ ...floorPlane, dose: true, hours: 0, minutes: 15, seconds: 0 });
    await fireEvent.click(fold('Display'));
    expect(container.querySelector('.time-inputs')).toBeTruthy();
    expect(container.querySelector('.time-inputs.invalid')).toBeNull();
  });

  it('a volume with too many points has Numeric disabled, and a stored Numeric falls back to Iso', async () => {
    const big = { ...volume, num_x: 11, num_y: 11, num_z: 11, display_mode: 'numeric' as const };
    expect(11 * 11 * 11).toBeGreaterThan(MAX_NUMERIC_VOLUME_POINTS);
    const { spy } = renderPanel(big);
    expect(spy).toHaveBeenCalledWith('zone-4', { display_mode: 'heatmap' });
    await fireEvent.click(fold('Display'));
    const numeric = within(screen.getByRole('group', { name: 'Display mode' })).getByRole('button', { name: 'Numeric' }) as HTMLButtonElement;
    expect(numeric.disabled).toBe(true);
  });
});

describe('ZonePanel picks', () => {
  afterEach(() => {
    pickMode.set(null);
    pickResult.set(null);
  });

  it('a pick running when the panel closes is cancelled', () => {
    const { unmount } = renderPanel(point);
    pickMode.set({ type: 'point_position' });
    unmount();
    expect(get(pickMode)).toBeNull();
  });

  it("closing the panel leaves a lamp's pick alone", () => {
    const { unmount } = renderPanel(point);
    pickMode.set({ type: 'lamp_position' });
    unmount();
    expect(get(pickMode)).toEqual({ type: 'lamp_position' });
  });

  it('a pick started for one zone is cancelled when the panel shows another', async () => {
    const { rerender, spy } = renderPanel(point);
    pickMode.set({ type: 'point_position' });
    await rerender({ zone: { ...point, id: 'zone-6' }, room, isStandard: false, controller: fakeController() });
    expect(get(pickMode)).toBeNull();
    // A late result is not written onto the new zone either way: nothing is running
    expect(spy).not.toHaveBeenCalled();
  });

  it("a pick result for another kind of zone is ignored", () => {
    const { spy } = renderPanel(point);
    pickResult.set({ type: 'target', value: [1, 2, 3] });
    expect(spy).not.toHaveBeenCalled();
    pickResult.set({ type: 'point_position', value: [1, 2, 1.5] });
    expect(spy).toHaveBeenLastCalledWith('zone-5', { x: 1, y: 2, z: 1.5 });
  });
});
