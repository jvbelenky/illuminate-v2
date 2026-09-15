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

  it('shows X/Y/Z inputs and a rectangle summary for a rectangle', () => {
    const { container } = render(RoomEditor);
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['X', 'Y', 'Z']);
    expect(container.querySelector('.plan-summary')?.textContent).toMatch(/^Rectangle/);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();
  });

  it('opens the floor-plan modal and applying an L preset makes a polygon room', async () => {
    const { container } = render(RoomEditor);
    const before = get(room);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan…' }));
    expect(document.querySelector('.floor-plan-modal')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'L-shape' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const after = get(room);
    expect(after.shape).toBe('polygon');
    expect(after.vertices).toHaveLength(6);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();

    // Only the height stays as a plain input; the summary describes the polygon
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['Z']);
    expect(container.querySelector('.plan-summary')?.textContent).toMatch(/Polygon · 6 walls/);
  });

  it('Cancel leaves the room untouched', async () => {
    render(RoomEditor);
    const before = get(room);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'T-shape' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(get(room)).toEqual(before);
    expect(document.querySelector('.floor-plan-modal')).toBeNull();
  });

  it('applying the Rectangle preset returns to rectangle mode', async () => {
    const { container } = render(RoomEditor);
    project.updateRoom({ shape: 'polygon', vertices: [[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]] });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const r = get(room);
    expect(r.shape).toBe('rectangle');
    expect(r.vertices).toBeUndefined();
    expect(r.x).toBe(6);
    expect(r.y).toBe(4);
    const labels = Array.from(container.querySelectorAll('.input-label')).map((el) => el.textContent);
    expect(labels).toEqual(['X', 'Y', 'Z']);
  });

  it('the vertex table edits the draft and Apply commits it', async () => {
    render(RoomEditor);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit floor plan…' }));
    // Add a corner on the closing wall, then apply
    await fireEvent.click(screen.getByRole('button', { name: 'Add corner' }));
    expect(document.querySelectorAll('.floor-plan-modal .vertex-row').length).toBe(5);
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const r = get(room);
    expect(r.shape).toBe('polygon');
    expect(r.vertices).toHaveLength(5);
  });
});
