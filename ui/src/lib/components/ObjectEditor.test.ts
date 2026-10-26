import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ObjectEditor from './ObjectEditor.svelte';
import type { SceneObject } from '$lib/types/project';
import { defaultRoom } from '$lib/types/project';

// Mock the lamp library store (project.ts imports it transitively).
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

const box: SceneObject = {
  id: 'object-1',
  name: 'Desk',
  shape: 'box',
  width: 1.2, length: 0.6, height: 0.75,
  x: 2, y: 3, z: 0,
  yaw: 0, pitch: 0, roll: 0,
  reflectance: 0.1, transmittance: 0.2,
  enabled: true,
};

function renderEditor(object: SceneObject = box) {
  return render(ObjectEditor, {
    props: { object, room: defaultRoom() },
  });
}

const num = (label: string) => parseFloat((screen.getByLabelText(label) as HTMLInputElement).value);

async function openGeometry() {
  await fireEvent.click(screen.getByRole('button', { name: 'Geometry' }));
}

/** The last partial sent to project.updateObject. */
function lastUpdate(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls[spy.mock.calls.length - 1] as [string, Partial<SceneObject>];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ObjectEditor', () => {
  it('only Bottom/Top/Floor to ceiling are visible by default', () => {
    const { container } = renderEditor();
    expect(num('Bottom')).toBe(0);
    expect(num('Top')).toBe(0.75);
    expect((screen.getByLabelText('Floor to ceiling') as HTMLInputElement).checked).toBe(false);

    expect(screen.getByRole('button', { name: 'Geometry' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Display' }).getAttribute('aria-expanded')).toBe('false');
    for (const label of ['X', 'Y', 'Reference', 'Width', 'Length', 'Rotation', 'Pitch', 'Roll', 'Show label']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    // Gone: the shape line, Edit on plan, Surfaces, hints and the footer
    expect(screen.queryByText(/Box|Polygon/)).toBeNull();
    expect(screen.queryByText(/Edit on plan/)).toBeNull();
    expect(screen.queryByText(/Reflectance|Transmittance/)).toBeNull();
    expect(container.querySelector('.hint')).toBeNull();
    for (const name of ['Delete', 'Copy', 'Close']) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('Floor to ceiling greys out Bottom and Top at the floor and the ceiling', () => {
    const room = defaultRoom();
    render(ObjectEditor, { props: { object: { ...box, z: 0, height: room.z }, room } });
    expect((screen.getByLabelText('Floor to ceiling') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Bottom') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Top') as HTMLInputElement).disabled).toBe(true);
    expect(num('Top')).toBe(room.z);
  });

  it('Reference Corner reports the start corner and keeps it fixed when Width changes', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    const { rerender } = renderEditor();
    await openGeometry();
    expect((screen.getByLabelText('Reference') as HTMLSelectElement).value).toBe('centre');
    await fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'corner' } });
    expect(num('X')).toBeCloseTo(1.4, 6);
    expect(num('Y')).toBeCloseTo(2.7, 6);

    await fireEvent.change(screen.getByLabelText('Width'), { target: { value: '2' } });
    const [id, partial] = lastUpdate(spy);
    expect(id).toBe('object-1');
    expect(partial.shape).toBeUndefined(); // still a box
    expect(partial.width).toBeCloseTo(2, 6);
    expect(partial.length).toBeCloseTo(0.6, 6);
    expect(partial.x).toBeCloseTo(2.4, 6);
    expect(partial.y).toBeCloseTo(3, 6);

    // Rotated a quarter turn, the start corner turns with the structure
    await rerender({ object: { ...box, yaw: 90 }, room: defaultRoom() });
    expect(num('X')).toBeCloseTo(2.3, 6);
    expect(num('Y')).toBeCloseTo(2.4, 6);
  });

  it('Centre keeps the centre fixed', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    renderEditor({ ...box, yaw: 30 });
    await openGeometry();
    expect(num('X')).toBeCloseTo(2, 6);
    expect(num('Y')).toBeCloseTo(3, 6);
    await fireEvent.change(screen.getByLabelText('Length'), { target: { value: '1.5' } });
    const [, partial] = lastUpdate(spy);
    expect(partial).toMatchObject({ yaw: 30 });
    expect(partial.x).toBeCloseTo(2, 6);
    expect(partial.y).toBeCloseTo(3, 6);
    expect(partial.width).toBeCloseTo(1.2, 6);
    expect(partial.length).toBeCloseTo(1.5, 6);
  });

  it('Rotation, Pitch and Roll commit their angles', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    renderEditor();
    await openGeometry();
    await fireEvent.change(screen.getByLabelText('Rotation'), { target: { value: '45' } });
    expect(lastUpdate(spy)[1]).toMatchObject({ yaw: 45 });
    expect(lastUpdate(spy)[1].x).toBeCloseTo(2, 6);
    await fireEvent.change(screen.getByLabelText('Pitch'), { target: { value: '15' } });
    expect(spy).toHaveBeenLastCalledWith('object-1', { pitch: 15 });
    await fireEvent.change(screen.getByLabelText('Roll'), { target: { value: '-10' } });
    expect(spy).toHaveBeenLastCalledWith('object-1', { roll: -10 });
  });

  it('moving a corner of a box makes it a polygon; the corners are world positions', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    renderEditor();
    await openGeometry();
    expect(num('Corner 1 X')).toBeCloseTo(1.4, 6);
    expect(num('Corner 1 Y')).toBeCloseTo(2.7, 6);
    await fireEvent.change(screen.getByLabelText('Corner 3 X'), { target: { value: '3' } });
    const [, partial] = lastUpdate(spy);
    expect(partial.shape).toBe('extrusion');
    expect(partial.vertices).toHaveLength(4);
    expect(partial.yaw).toBe(0);
  });

  it('moving a rotated polygon keeps its yaw and its own polygon', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    const l: SceneObject = { ...box, shape: 'extrusion', vertices: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], width: 2, length: 2, yaw: 30 };
    renderEditor(l);
    await openGeometry();
    expect(screen.getByLabelText('Corner 6 X')).toBeTruthy();
    const shownX = num('X');
    await fireEvent.change(screen.getByLabelText('X'), { target: { value: String(shownX + 1) } });
    const [, partial] = lastUpdate(spy);
    expect(partial).toMatchObject({ yaw: 30, width: 2, length: 2 });
    expect(partial.x).toBeCloseTo(3, 2); // moved by one (the shown X is rounded)
    expect(partial.y).toBe(3);
    // Only moved: it keeps its own polygon
    expect(partial.vertices).toBeUndefined();
    expect(partial.shape).toBeUndefined();
  });

  it('Display › Show label sets the structure label', async () => {
    const spy = vi.spyOn(project, 'setLabel').mockImplementation(() => {});
    renderEditor();
    await fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    const check = screen.getByLabelText('Show label') as HTMLInputElement;
    expect(check.checked).toBe(false);
    await fireEvent.click(check);
    expect(spy).toHaveBeenCalledWith('objects', 'object-1', true);
  });
});
