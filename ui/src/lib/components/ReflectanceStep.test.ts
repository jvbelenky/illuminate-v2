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

  it('opens the surfaces modal', async () => {
    const open = vi.fn();
    render(ReflectanceStep, { props: { onShowReflectanceSettings: open } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit surfaces…' }));
    expect(open).toHaveBeenCalled();
  });
});
