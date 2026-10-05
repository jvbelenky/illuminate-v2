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
  it('offers down, up and sideways and presses the group of the current axis', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Down/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Up/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Sideways/ })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.axis-btn[data-group="sideways"]')).not.toBeNull();
  });

  it('tags the group the file analysis suggested', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Sideways/ }).textContent).toMatch(/detected from file/i);
    expect(screen.getByRole('button', { name: /^Down/ }).textContent).not.toMatch(/detected/i);
  });

  it('emits the plain axis for down and up', async () => {
    const { onAxisChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /^Up/ }));
    expect(onAxisChange).toHaveBeenCalledWith('up');
    await fireEvent.click(screen.getByRole('button', { name: /^Down/ }));
    expect(onAxisChange).toHaveBeenCalledWith('down');
  });

  it('sideways picks the horizontal with the most power', async () => {
    const { onAxisChange } = setup({
      axis: 'down',
      analysis: { ...analysis, axis_scores: { ...analysis.axis_scores, horizontal_0: 0.1, horizontal_180: 0.6 } },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^Sideways/ }));
    expect(onAxisChange).toHaveBeenCalledWith('horizontal_180');
  });

  it('shows the beam-side select only while sideways, and emits the chosen side', async () => {
    const { onAxisChange, unmount } = setup();
    const select = document.querySelector('#beam-azimuth') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('horizontal_0');
    await fireEvent.change(select, { target: { value: 'horizontal_90' } });
    expect(onAxisChange).toHaveBeenCalledWith('horizontal_90');
    unmount();
    setup({ axis: 'down' });
    expect(document.querySelector('#beam-azimuth')).toBeNull();
  });

  it('has no six-token row or readout sentence', () => {
    setup();
    expect(document.querySelector('[data-axis]')).toBeNull();
    expect(document.querySelector('.axis-readout')).toBeNull();
  });

  it('hides the photometric center depth control for now', () => {
    setup();
    expect(document.querySelector('#photometric-depth')).toBeNull();
    expect(document.querySelector('.depth-face')).toBeNull();
  });
});

// The depth control is hidden until negative depths are supported (SHOW_DEPTH
// in PhotometricAxisPicker.svelte). Re-enable these with it.
describe.skip('PhotometricAxisPicker depth control', () => {
  it('depth presets emit 0 and half the housing height', async () => {
    const { onDepthChange } = setup();
    await fireEvent.click(document.querySelector('.depth-face')!);
    expect(onDepthChange).toHaveBeenCalledWith(0);
    await fireEvent.click(document.querySelector('.depth-centered')!);
    expect(onDepthChange).toHaveBeenCalledWith(0.15);
  });

  it('centered preset is disabled without a housing height and says why', () => {
    setup({ housingHeight: undefined });
    const btn = document.querySelector('.depth-centered')!;
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/housing height/i);
  });

  it('typing a depth emits it', async () => {
    const { onDepthChange } = setup();
    const input = document.querySelector('#photometric-depth') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '0.07' } });
    expect(onDepthChange).toHaveBeenCalledWith(0.07);
  });
});
