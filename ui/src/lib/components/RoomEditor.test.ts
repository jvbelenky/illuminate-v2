import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import RoomEditor from './RoomEditor.svelte';
import { project, room } from '$lib/stores/project';
import { userSettings } from '$lib/stores/settings';
import { LENGTH_UNITS } from '$lib/utils/unitConversion';

describe('RoomEditor', () => {
  beforeEach(() => {
    // Every test starts from a rectangular room
    if (get(room).shape !== 'rectangle') {
      project.updateRoom({ shape: 'rectangle', x: 4, y: 6 });
    }
  });

  it('renders room editor', () => {
    const { container } = render(RoomEditor);
    expect(container.querySelector('.room-editor')).toBeTruthy();
  });

  it('renders dimensions label', () => {
    render(RoomEditor);
    expect(screen.getByText('Dimensions')).toBeTruthy();
  });

  it('renders units selector', () => {
    const { container } = render(RoomEditor);
    const selects = container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('offers every length unit in the units select', () => {
    const { container } = render(RoomEditor);
    const select = container.querySelector('select.units-select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([...LENGTH_UNITS]);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['m', 'cm', 'mm', 'ft', 'in']);
  });

  it('labels the summary with the current unit', async () => {
    userSettings.update((s) => ({ ...s, units: 'centimeters' }));
    try {
      const { container } = render(RoomEditor);
      await tick();
      expect(container.querySelector('.plan-summary')?.textContent).toMatch(/cm²/);
      expect(container.querySelector('.plan-summary')?.textContent).toMatch(/cm³/);
      expect((container.querySelector('select.units-select') as HTMLSelectElement).value).toBe('centimeters');
    } finally {
      userSettings.update((s) => ({ ...s, units: 'meters' }));
    }
  });

  it('no longer carries the reflections toggle (it lives in the Reflectance step)', () => {
    const { container } = render(RoomEditor);
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  it('renders form groups', () => {
    const { container } = render(RoomEditor);
    const groups = container.querySelectorAll('.form-group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it('shows X/Y/Z inputs and a rectangle summary for a rectangle', () => {
    const { container } = render(RoomEditor);
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['X', 'Y', 'Z']);
    expect(container.querySelector('.plan-summary')?.textContent).toMatch(/m²/);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();
  });

  it('changing X on a polygon room stretches the outline', async () => {
    const { container } = render(RoomEditor);
    project.updateRoom({ shape: 'polygon', vertices: [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]] });
    await tick(); // let the inputs re-render before editing one
    const xInput = container.querySelectorAll('.dim-inputs input')[0] as HTMLInputElement;
    xInput.value = '12';
    await fireEvent.change(xInput);

    const r = get(room);
    expect(r.shape).toBe('polygon');
    expect(r.x).toBe(12);
    expect(r.vertices).toEqual([[0, 0], [12, 0], [12, 2], [6, 2], [6, 4], [0, 4]]);
  });

  it('Edit and the thumbnail open the Plan editor (the page hosts it)', async () => {
    const onEditPlan = vi.fn();
    const { container } = render(RoomEditor, { props: { onEditPlan } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan' }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
    const thumb = container.querySelector('.plan-group button, .plan-group [role="button"], .plan-group svg') as Element;
    await fireEvent.click(thumb);
    expect(onEditPlan).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();
  });

  it('summarises a polygon room by its walls, keeping X/Y/Z inputs', async () => {
    const { container } = render(RoomEditor, { props: { onEditPlan: vi.fn() } });
    project.updateRoom({ shape: 'polygon', vertices: [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]] });
    await tick();
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['X', 'Y', 'Z']);
    expect(container.querySelector('.plan-summary')?.textContent).toMatch(/6 walls/);
  });
});
