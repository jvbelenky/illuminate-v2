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
  yaw: 30, pitch: 0, roll: 0,
  reflectance: 0.1, transmittance: 0.2,
  enabled: true,
};

function renderEditor(object: SceneObject = box) {
  return render(ObjectEditor, {
    props: { object, room: defaultRoom(), onClose: vi.fn() },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ObjectEditor', () => {
  it('renders the store values without mirroring them', () => {
    const { container } = renderEditor();
    expect(parseFloat((container.querySelector('#object-width') as HTMLInputElement).value)).toBe(1.2);
    expect(parseFloat((container.querySelector('#object-x') as HTMLInputElement).value)).toBe(2);
    expect((container.querySelector('#object-yaw') as HTMLInputElement).value).toBe('30.0');
    expect(screen.getByText('Box')).toBeTruthy();
  });

  it('commits a size change through project.updateObject', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    const { container } = renderEditor();
    const width = container.querySelector('#object-width') as HTMLInputElement;
    await fireEvent.change(width, { target: { value: '2.5' } });
    expect(spy).toHaveBeenCalledWith('object-1', { width: 2.5 });
  });

  it('sends reflectance and transmittance together so the backend validates the pair', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    const { container } = renderEditor();
    const reflectance = container.querySelector('#object-reflectance') as HTMLInputElement;
    await fireEvent.change(reflectance, { target: { value: '0.5' } });
    expect(spy).toHaveBeenCalledWith('object-1', { reflectance: 0.5, transmittance: 0.2 });
  });

  it('rejects a reflectance that would push the pair over 1 before any request is made', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    const { container } = renderEditor();
    const reflectance = container.querySelector('#object-reflectance') as HTMLInputElement;
    await fireEvent.change(reflectance, { target: { value: '0.9' } }); // 0.9 + 0.2 > 1
    expect(spy).not.toHaveBeenCalled();
    expect(parseFloat(reflectance.value)).toBe(0.1); // reverted to the store value
  });

  it('shows the footprint summary for an extrusion', () => {
    renderEditor({ ...box, shape: 'extrusion', vertices: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]] });
    expect(screen.getByText(/Polygon, 6 corners/)).toBeTruthy();
  });

  it('reveals pitch and roll under Advanced', async () => {
    const spy = vi.spyOn(project, 'updateObject').mockImplementation(() => {});
    const { container } = renderEditor();
    expect(container.querySelector('#object-pitch')).toBeNull();
    await fireEvent.click(screen.getByText('Advanced'));
    const pitch = container.querySelector('#object-pitch') as HTMLInputElement;
    expect(pitch).toBeTruthy();
    await fireEvent.change(pitch, { target: { value: '15' } });
    expect(spy).toHaveBeenCalledWith('object-1', { pitch: 15 });
  });

  it('deletes after confirmation and closes the editor', async () => {
    const removeSpy = vi.spyOn(project, 'removeObject').mockImplementation(() => {});
    const onClose = vi.fn();
    render(ObjectEditor, { props: { object: box, room: defaultRoom(), onClose } });
    await fireEvent.click(screen.getByText('Delete'));
    // ConfirmDialog renders a second Delete button
    const buttons = screen.getAllByText('Delete');
    await fireEvent.click(buttons[buttons.length - 1]);
    expect(removeSpy).toHaveBeenCalledWith('object-1');
    expect(onClose).toHaveBeenCalled();
  });
});
