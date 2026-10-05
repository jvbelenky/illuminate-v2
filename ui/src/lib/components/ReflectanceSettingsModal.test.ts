import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import type { SceneObject } from '$lib/types/project';

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

// No WebGL in jsdom: the Canvas renders nothing and the preview is replaced
// by a stub that exposes its onSelect callback for the click test.
vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }) };
});
let previewSelect: ((key: string) => void) | undefined;
vi.mock('./ReflectancePreview3D.svelte', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return {
    default: new Proxy(Stub, {
      apply(target, thisArg, args: unknown[]) {
        const props = (args[1] as { onSelect?: (key: string) => void }) ?? {};
        previewSelect = props.onSelect;
        return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
      },
    }),
  };
});
vi.mock('$lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('$lib/api/client')>('$lib/api/client');
  return { ...actual, getReflectanceSurfaces: vi.fn(async () => ({ surfaces: {} })) };
});

import ReflectanceSettingsModal from './ReflectanceSettingsModal.svelte';
import { project, room, objects } from '$lib/stores/project';

const box: SceneObject = {
  id: 'object-1', name: 'Desk', shape: 'box',
  width: 1.2, length: 0.6, height: 0.75,
  x: 2, y: 3, z: 0, yaw: 0, pitch: 0, roll: 0,
  reflectance: 0.078, transmittance: 0, enabled: true,
  face_properties: {}, face_spacings: {}, face_num_points: {},
};

function seedObject(obj: SceneObject) {
  // Local-only seed: with no backend session, loadFromFile is a plain store set.
  const current = get(project);
  project.loadFromFile({ ...current, objects: [...current.objects.filter((o) => o.id !== obj.id), obj] });
}

beforeEach(() => {
  project.updateRoom({ shape: 'rectangle', x: 4, y: 6 });
  project.loadFromFile({ ...get(project), objects: [] });
  project.setAllReflectances(0.078);
  previewSelect = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderModal() {
  return render(ReflectanceSettingsModal, { props: { onClose: vi.fn() } });
}

describe('ReflectanceSettingsModal', () => {
  it('lists room surfaces open and obstacles collapsed, with no resolution fields by default', () => {
    seedObject(box);
    renderModal();
    expect(screen.getByText('Floor')).toBeTruthy();
    expect(screen.getByText('Desk')).toBeTruthy();
    expect(screen.queryByText('Top')).toBeNull();
    expect(screen.queryByText('X points')).toBeNull();
    // Advanced is always open; grid resolution is opt-in inside it
    expect(screen.getByText('Max iterations')).toBeTruthy();
    expect(screen.getByText('Room walls')).toBeTruthy();
    expect(screen.getAllByText('Absorbance').length).toBeGreaterThan(0);
  });

  it('quickset R on the room group applies to every room surface', async () => {
    renderModal();
    const input = document.getElementById('refl-room-all') as HTMLInputElement;
    await fireEvent.change(input, { target: { value: '0.2' } });
    expect(Object.values(get(room).reflectances).every((v) => v === 0.2)).toBe(true);
  });

  it('editing one room surface leaves the others and shows the group as mixed', async () => {
    renderModal();
    const floorRow = document.querySelector('[data-plane="floor"]')!;
    await fireEvent.change(floorRow.querySelector('input')!, { target: { value: '0.5' } });
    expect(get(room).reflectances.floor).toBe(0.5);
    expect(get(room).reflectances.ceiling).toBe(0.078);
    await tick();
    expect(screen.getByPlaceholderText('mixed')).toBeTruthy();
  });

  it('expanding an obstacle shows its faces and a face edit becomes a sparse override', async () => {
    seedObject(box);
    const spy = vi.spyOn(project, 'updateObject');
    renderModal();
    await fireEvent.click(screen.getByRole('button', { name: /Desk/ }));
    expect(screen.getByText('Top')).toBeTruthy();
    expect(screen.getByText('Side 4')).toBeTruthy();
    const topRow = document.querySelector('[data-plane="object-1:top"]')!;
    const [rInput] = Array.from(topRow.querySelectorAll('input'));
    await fireEvent.change(rInput, { target: { value: '0.5' } });
    expect(spy).toHaveBeenCalledWith('object-1', { face_properties: { top: { R: 0.5, T: 0 } } });
  });

  it('object quickset resets face overrides and sends the pair', async () => {
    seedObject({ ...box, face_properties: { top: { R: 0.5, T: 0 } } });
    const spy = vi.spyOn(project, 'updateObject');
    renderModal();
    // R differs across faces → the header R is "mixed"; T is shared.
    const t = document.getElementById('refl-obj-object-1-t') as HTMLInputElement;
    await fireEvent.change(t, { target: { value: '0.1' } });
    expect(spy).toHaveBeenCalledWith('object-1', { reflectance: 0.078, transmittance: 0.1, face_properties: {} });
  });

  it('a face R is capped so R + T stays at most 1', async () => {
    seedObject({ ...box, face_properties: { top: { R: 0.2, T: 0.7 } } });
    const spy = vi.spyOn(project, 'updateObject');
    renderModal();
    await fireEvent.click(screen.getByRole('button', { name: /Desk/ }));
    const topRow = document.querySelector('[data-plane="object-1:top"]')!;
    const [rInput] = Array.from(topRow.querySelectorAll('input'));
    await fireEvent.change(rInput, { target: { value: '0.5' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('Edit grid resolution reveals resolution fields on every row and the mode switch', async () => {
    seedObject(box);
    renderModal();
    expect(screen.queryByRole('button', { name: /instead/ })).toBeNull();
    await fireEvent.click(screen.getByLabelText('Edit grid resolution'));
    expect(screen.getAllByText(/X points|X spacing/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /instead/ })).toBeTruthy();
  });

  it('room rows show a greyed transmittance and the absorbance that is left', () => {
    project.updateRoom({ reflectances: { ...get(room).reflectances, floor: 0.25 } });
    renderModal();
    const floorRow = document.querySelector('[data-plane="floor"]')!;
    const inputs = Array.from(floorRow.querySelectorAll('input'));
    expect(inputs[1].disabled).toBe(true);
    expect(floorRow.querySelector('.computed-cell')!.textContent).toBe('0.750');
  });

  it('clicking a face in the preview expands its obstacle and focuses its reflectance input', async () => {
    seedObject(box);
    renderModal();
    expect(previewSelect).toBeDefined();
    previewSelect!('object-1:wall_2');
    await tick();
    await tick();
    const row = document.querySelector('[data-plane="object-1:wall_2"]');
    expect(row).toBeTruthy();
    expect(row!.classList.contains('highlighted')).toBe(true);
    expect(document.activeElement).toBe(row!.querySelector('input'));
  });

  it('grid resolution editing is off by default', () => {
    renderModal();
    const toggle = screen.getByLabelText('Edit grid resolution') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });
});
