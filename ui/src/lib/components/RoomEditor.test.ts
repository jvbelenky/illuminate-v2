import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import RoomEditor from './RoomEditor.svelte';
import { project, room } from '$lib/stores/project';
import { userSettings } from '$lib/stores/settings';
import { LENGTH_UNITS } from '$lib/utils/unitConversion';

/** Click Apply and, when the editor offers to add obstacles, decline so the apply goes through. */
async function clickApply() {
  await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  const skip = screen.queryByRole('button', { name: 'No obstacles to add' });
  if (skip) await fireEvent.click(skip);
}


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

  it('opens the floor-plan modal showing the current outline, and Apply keeps a polygon room', async () => {
    const { container } = render(RoomEditor);
    project.updateRoom({ shape: 'polygon', vertices: [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]] });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan' }));
    expect(document.querySelector('.floor-plan-modal')).toBeTruthy();
    expect(document.querySelectorAll('.floor-plan-modal .vertex-row').length).toBe(6);
    expect(screen.queryByRole('button', { name: 'Fit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New outline' })).toBeTruthy();

    await clickApply();
    const after = get(room);
    expect(after.shape).toBe('polygon');
    expect(after.vertices).toHaveLength(6);
    expect(after.x).toBe(6);
    expect(after.y).toBe(4);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();

    // X/Y/Z stay as inputs (X/Y are the overall extents); the summary describes the polygon
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['X', 'Y', 'Z']);
    expect(container.querySelector('.plan-summary')?.textContent).toMatch(/6 walls/);
  });

  it('New outline clears the shape; fewer than three corners restores the old one on Escape', async () => {
    const { container } = render(RoomEditor);
    project.updateRoom({ shape: 'polygon', vertices: [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]] });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan' }));
    const modal = container.ownerDocument.querySelector('.floor-plan-modal')!;
    expect(modal.querySelectorAll('.vertex-row').length).toBe(6);
    await fireEvent.click(screen.getByRole('button', { name: 'New outline' }));
    // Corners are present, so it asks first
    await fireEvent.click(screen.getByRole('button', { name: 'Clear and draw' }));
    expect(modal.querySelectorAll('.vertex-row').length).toBe(0);
    expect(screen.getByRole('button', { name: 'New outline' })).toBeDisabled();
    // Only one corner placed, then cancel: the six-corner outline is back
    const plan = modal.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    expect(modal.querySelectorAll('.vertex-row').length).toBe(1);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(modal.querySelectorAll('.vertex-row').length).toBe(6);
    expect(screen.queryByRole('button', { name: 'Rectangle' })).toBeNull();
  });

  it('Cancel leaves the room untouched', async () => {
    render(RoomEditor);
    const before = get(room);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add corner' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(get(room)).toEqual(before);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();
  });

  it('New outline starts drawing (disabled meanwhile) and Escape restores the outline without closing the modal', async () => {
    render(RoomEditor);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan' }));
    await fireEvent.click(screen.getByRole('button', { name: 'New outline' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear and draw' }));
    expect((screen.getByRole('button', { name: 'New outline' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelectorAll('.floor-plan-modal .vertex-row').length).toBe(0);

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.floor-plan-modal')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'New outline' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelectorAll('.floor-plan-modal .vertex-row').length).toBe(4);
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

  it('the vertex table edits the draft and Apply commits it', async () => {
    render(RoomEditor);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan' }));
    // Add a corner on the closing wall, then apply
    await fireEvent.click(screen.getByRole('button', { name: 'Add corner' }));
    expect(document.querySelectorAll('.floor-plan-modal .vertex-row').length).toBe(5);
    await clickApply();

    const r = get(room);
    expect(r.shape).toBe('polygon');
    expect(r.vertices).toHaveLength(5);
    // The default 4 x 6 room's longest walls are the 6 m sides; the first one (east) is split
    expect(r.vertices).toContainEqual([4, 3]);
  });

});
