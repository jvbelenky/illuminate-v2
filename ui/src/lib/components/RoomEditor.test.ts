import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import RoomEditor from './RoomEditor.svelte';
import { project, room } from '$lib/stores/project';

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

  it('renders reflectance toggle', () => {
    const { container } = render(RoomEditor);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders form groups', () => {
    const { container } = render(RoomEditor);
    const groups = container.querySelectorAll('.form-group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it('shows X/Y/Z inputs and no floor plan for a rectangle', () => {
    const { container } = render(RoomEditor);
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['X', 'Y', 'Z']);
    expect(container.querySelector('.floor-plan-editor')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Rectangle' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switching to Polygon seeds the outline with the rectangle corners and shows the floor plan', async () => {
    const { container } = render(RoomEditor);
    const before = get(room);
    await fireEvent.click(screen.getByRole('radio', { name: 'Polygon' }));

    const after = get(room);
    expect(after.shape).toBe('polygon');
    expect(after.vertices).toEqual([[0, 0], [before.x, 0], [before.x, before.y], [0, before.y]]);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    // Only the height stays as a plain input; the outline is edited in the plan
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['Z']);
    expect(container.querySelector('.floor-plan-editor svg.plan')).toBeTruthy();
    expect(container.querySelectorAll('.floor-plan-editor .vertex-row').length).toBe(4);
    expect(screen.getByText('Floor plan')).toBeTruthy();
  });

  it('"Add corner" splits the closing wall and the store follows', async () => {
    const { container } = render(RoomEditor);
    await fireEvent.click(screen.getByRole('radio', { name: 'Polygon' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add corner' }));

    const r = get(room);
    expect(r.vertices).toHaveLength(5);
    // Midpoint of the closing edge (0, y) -> (0, 0)
    expect(r.vertices![4]).toEqual([0, r.y / 2]);
    expect(container.querySelectorAll('.floor-plan-editor .vertex-row').length).toBe(5);
    expect(screen.getByText(/5 walls/)).toBeTruthy();
  });

  it('switching back to Rectangle uses the bounding box and drops the vertices', async () => {
    render(RoomEditor);
    await fireEvent.click(screen.getByRole('radio', { name: 'Polygon' }));
    project.updateRoom({ vertices: [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]] });
    await fireEvent.click(screen.getByRole('radio', { name: 'Rectangle' }));

    const r = get(room);
    expect(r.shape).toBe('rectangle');
    expect(r.vertices).toBeUndefined();
    expect(r.x).toBe(6);
    expect(r.y).toBe(4);
  });
});
