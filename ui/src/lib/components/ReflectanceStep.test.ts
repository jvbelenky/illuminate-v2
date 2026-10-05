import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ReflectanceStep from './ReflectanceStep.svelte';

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

import { project, room, objects } from '$lib/stores/project';

function input(): HTMLInputElement {
  return document.getElementById('reflectance-all') as HTMLInputElement;
}

beforeEach(() => {
  project.updateRoom({ shape: 'rectangle', x: 4, y: 6 });
  project.setAllReflectances(0.078);
  for (const o of get(objects)) project.removeObject(o.id);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReflectanceStep', () => {
  it('shows the shared reflectance prefilled', () => {
    render(ReflectanceStep, { props: { onShowReflectanceSettings: vi.fn() } });
    expect(input().value).toBe('0.078');
  });

  it('applies a typed value to every room surface and object', async () => {
    const spy = vi.spyOn(project, 'setAllReflectances');
    render(ReflectanceStep, { props: { onShowReflectanceSettings: vi.fn() } });
    await fireEvent.change(input(), { target: { value: '0.2' } });
    expect(spy).toHaveBeenCalledWith(0.2);
  });

  it('shows "mixed" when surfaces differ and applies a typed value', async () => {
    const spy = vi.spyOn(project, 'setAllReflectances');
    project.updateRoom({ reflectances: { ...get(room).reflectances, floor: 0.5 } });
    render(ReflectanceStep, { props: { onShowReflectanceSettings: vi.fn() } });
    expect(input().placeholder).toBe('mixed');
    expect(input().value).toBe('');
    await fireEvent.change(input(), { target: { value: '0.3' } });
    expect(spy).toHaveBeenCalledWith(0.3);
  });

  it('ignores an out-of-range value typed into the mixed input', async () => {
    const spy = vi.spyOn(project, 'setAllReflectances');
    project.updateRoom({ reflectances: { ...get(room).reflectances, floor: 0.5 } });
    render(ReflectanceStep, { props: { onShowReflectanceSettings: vi.fn() } });
    await fireEvent.change(input(), { target: { value: '7' } });
    expect(spy).not.toHaveBeenCalled();
    expect(input().value).toBe('');
  });

  it('Room walls quickset sets every room surface and leaves objects alone', async () => {
    render(ReflectanceStep, { props: { onShowReflectanceSettings: vi.fn() } });
    const walls = document.getElementById('reflectance-walls') as HTMLInputElement;
    expect(walls.value).toBe('0.078');
    await fireEvent.change(walls, { target: { value: '0.4' } });
    expect(Object.values(get(room).reflectances).every((v) => v === 0.4)).toBe(true);
    // All surfaces now differ from the (absent) objects? No objects: all = walls.
    expect((document.getElementById('reflectance-all') as HTMLInputElement).value).toBe('0.400');
  });

  it('lists each obstacle with R and T quicksets that reset its face overrides', async () => {
    const current = get(project);
    project.loadFromFile({ ...current, objects: [{
      id: 'object-1', name: 'Desk', shape: 'box', width: 1, length: 1, height: 1,
      x: 2, y: 3, z: 0, yaw: 0, pitch: 0, roll: 0,
      reflectance: 0.078, transmittance: 0, enabled: true,
      face_properties: { top: { R: 0.5, T: 0 } },
    }] });
    const spy = vi.spyOn(project, 'updateObject');
    render(ReflectanceStep, { props: { onShowReflectanceSettings: vi.fn() } });
    expect(screen.getByText('Desk')).toBeTruthy();
    const r = document.getElementById('refl-r-object-1') as HTMLInputElement;
    const t = document.getElementById('refl-t-object-1') as HTMLInputElement;
    expect(r.placeholder).toBe('mixed');   // top differs
    expect(t.value).toBe('0.000');
    await fireEvent.change(t, { target: { value: '0.2' } });
    expect(spy).toHaveBeenCalledWith('object-1', { reflectance: 0.078, transmittance: 0.2, face_properties: {} });
    // Clearing the override re-renders R from "mixed" to a plain input.
    const r2 = document.getElementById('refl-r-object-1') as HTMLInputElement;
    expect(r2.placeholder).not.toBe('mixed');
    await fireEvent.change(r2, { target: { value: '0.3' } });
    expect(spy).toHaveBeenCalledWith('object-1', { reflectance: 0.3, transmittance: 0.2, face_properties: {} });
    project.loadFromFile({ ...get(project), objects: [] });
  });

  it('opens the surfaces modal', async () => {
    const open = vi.fn();
    render(ReflectanceStep, { props: { onShowReflectanceSettings: open } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit surfaces…' }));
    expect(open).toHaveBeenCalled();
  });
});
