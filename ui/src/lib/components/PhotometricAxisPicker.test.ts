import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PhotometricAxisPicker from './PhotometricAxisPicker.svelte';

// jsdom has no WebGL: stub the Threlte canvas and the scene.
vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }), useTask: () => {} };
});
vi.mock('./PhotometricAxisScene.svelte', async () => ({
  default: (await import('./test/Stub.svelte')).default,
}));

const analysis = {
  suggested_axis: 'horizontal_0',
  axis_scores: { down: 0, up: 0, horizontal_0: 0.85, horizontal_90: 0.04, horizontal_180: 0, horizontal_270: 0.04 },
  ies_dimensions: { width: 1.94, length: 1.26, height: 0.42 },
  vertices: [[0, 0, -1]],
  triangles: [],
  extents_by_axis: {
    down: { length: 1.26, width: 1.94, height: 0.42 },
    up: { length: 1.26, width: 1.94, height: 0.42 },
    horizontal_0: { length: 0.42, width: 1.94, height: 1.26 },
    horizontal_90: { length: 0.42, width: 1.26, height: 1.94 },
    horizontal_180: { length: 0.42, width: 1.94, height: 1.26 },
    horizontal_270: { length: 0.42, width: 1.26, height: 1.94 },
  },
} as any;

function setup(over: Partial<Record<string, unknown>> = {}) {
  const onAxisChange = vi.fn();
  const onDepthChange = vi.fn();
  const r = render(PhotometricAxisPicker, {
    props: {
      analysis, axis: 'horizontal_0', depth: undefined,
      housingWidth: undefined, housingLength: undefined, housingHeight: 0.3,
      units: 'meters', onAxisChange, onDepthChange, ...over,
    } as any,
  });
  return { ...r, onAxisChange, onDepthChange };
}

describe('PhotometricAxisPicker', () => {
  it('marks the current axis pressed and dims zero-score handles', () => {
    setup();
    expect(screen.getByRole('button', { name: /^0°/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Down/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Down/ }).className).toMatch(/dim/);
  });

  it('emits the clicked axis', async () => {
    const { onAxisChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /^Up/ }));
    expect(onAxisChange).toHaveBeenCalledWith('up');
  });

  it('shows the readout for the axis', () => {
    setup();
    expect(document.querySelector('.axis-readout')!.textContent).toMatch(/0°/);
  });

  it('depth presets emit 0 and half the housing height', async () => {
    const { onDepthChange } = setup();
    await fireEvent.click(document.querySelector('.depth-face')!);
    expect(onDepthChange).toHaveBeenCalledWith(0);
    await fireEvent.click(document.querySelector('.depth-centered')!);
    expect(onDepthChange).toHaveBeenCalledWith(0.15);
  });

  it('centered preset is disabled without a housing height', () => {
    setup({ housingHeight: undefined });
    expect(document.querySelector('.depth-centered')).toBeDisabled();
  });

  it('typing a depth emits it', async () => {
    const { onDepthChange } = setup();
    const input = document.querySelector('#photometric-depth') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '0.07' } });
    expect(onDepthChange).toHaveBeenCalledWith(0.07);
  });
});
