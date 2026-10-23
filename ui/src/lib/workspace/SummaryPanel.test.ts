import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import SummaryPanel from './SummaryPanel.svelte';
import { defaultRoom, type CalcZone, type LampInstance, type SceneObject } from '$lib/types/project';
import type { PlanScene, PlanActions } from '$lib/plan/planActions';

afterEach(cleanup);

const rect: [number, number][] = [[0, 0], [24, 0], [24, 20], [0, 20]];
const lamp = { id: 'lamp-1', name: 'Beacon', lamp_type: 'krcl_222', preset_id: 'beacon', has_ies_file: true, x: 2, y: 2, z: 8, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true } as LampInstance;
const desk = { id: 'object-1', name: 'Desk', shape: 'box', enabled: true } as unknown as SceneObject;
const zone = { id: 'zone-1', name: 'Floor', type: 'plane', ref_surface: 'xy', enabled: true } as unknown as CalcZone;
const std = { id: 'WholeRoomFluence', name: 'Whole room fluence', type: 'volume', isStandard: true, enabled: true } as unknown as CalcZone;

function setup(over: Partial<PlanScene> = {}, room: Record<string, unknown> = {}) {
  const actions = { updateLamp: vi.fn(), updateZone: vi.fn(), updateObstacle: vi.fn(), setHidden: vi.fn() } as unknown as PlanActions;
  const onEdit = vi.fn();
  const scene = {
    vertices: rect, units: 'feet', precision: 1, lamps: [lamp], objects: [desk], zones: [zone, std],
    floorplan: null, image: null, roomZ: 9, fixtures: [{ key: 'preset:beacon', label: 'Beacon fixture', group: 'Presets' }],
    room: { ...defaultRoom({ x: 24, y: 20, z: 9 }), ...room },
    hidden: { lamps: new Set<string>(), zones: new Set<string>(), objects: new Set<string>() },
    ...over,
  } as PlanScene;
  render(SummaryPanel, { props: { scene, actions, onEdit } });
  return { actions, onEdit };
}

const kv = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

describe('SummaryPanel', () => {
  it('shows Dimensions, Floor area, Volume and Reflections for a box room', () => {
    setup({}, { shape: 'rectangle', enable_reflectance: true, reflectances: { floor: 0.05, ceiling: 0.08, north: 0.08 } });
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeTruthy();
    expect(kv('Dimensions')).toContain('24 × 20 × 9 ft');
    expect(kv('Floor area')).toContain('480 ft²');
    expect(kv('Volume')).toContain('4,320 ft³');
    expect(kv('Reflections')).toContain('On · R 0.05–0.08');
  });

  it('shows a single reflectance value, or Off', () => {
    setup({}, { enable_reflectance: true, reflectances: { floor: 0.1, ceiling: 0.1 } });
    expect(kv('Reflections')).toContain('On · R 0.1');
    expect(kv('Reflections')).not.toContain('–');
    cleanup();
    setup({}, { enable_reflectance: false });
    expect(kv('Reflections')).toContain('Off');
  });

  it('describes a polygon room by its corner count', () => {
    const five: [number, number][] = [[0, 0], [10, 0], [10, 6], [5, 9], [0, 6]];
    setup({ vertices: five }, { shape: 'polygon' });
    expect(kv('Dimensions')).toContain('5-corner outline · 9 ft high');
  });

  it('section buttons open the matching editor step', async () => {
    const { onEdit } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Structures' }));
    expect(onEdit).toHaveBeenLastCalledWith('room', 'structures');
    await fireEvent.click(screen.getByRole('button', { name: 'Calc zones' }));
    expect(onEdit).toHaveBeenLastCalledWith('zones', undefined);
    await fireEvent.click(screen.getByRole('button', { name: 'Lamps' }));
    expect(onEdit).toHaveBeenLastCalledWith('lamps', undefined);
    await fireEvent.click(screen.getByRole('button', { name: 'Room' }));
    expect(onEdit).toHaveBeenLastCalledWith('room', 'floorplan');
    expect(document.querySelectorAll('button.summary-section').length).toBe(4);
  });

  it('row toggles work from the summary, and clicking a row does nothing', async () => {
    const { actions, onEdit } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Hide Beacon' }));
    expect(actions.setHidden).toHaveBeenCalledWith('lamps', 'lamp-1', true);
    await fireEvent.click(screen.getByRole('button', { name: 'Exclude Beacon from calculations' }));
    expect(actions.updateLamp).toHaveBeenCalledWith('lamp-1', { enabled: false });
    await fireEvent.click(screen.getByText('Beacon'));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Rename Beacon')).toBeNull();
  });

  it('standard zones are listed only while Use standard zones is on', () => {
    setup({}, { useStandardZones: false });
    expect(screen.queryByText('Whole room fluence')).toBeNull();
    expect(screen.getByText('Floor')).toBeTruthy();
    cleanup();
    setup({}, { useStandardZones: true });
    expect(screen.getByText('Whole room fluence')).toBeTruthy();
  });
});
