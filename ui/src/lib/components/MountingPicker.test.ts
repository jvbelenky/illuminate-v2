import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MountingPicker from './MountingPicker.svelte';

// Lumalier-style wall sheet: most of the light toward phi = 0
const analysis = {
  suggested_axis: 'horizontal_0',
  axis_scores: { down: 0, up: 0, horizontal_0: 0.68, horizontal_90: 0.05, horizontal_180: 0, horizontal_270: 0.06 },
  ies_dimensions: { width: 1.19, length: 0.29, height: 0.33 },
  vertices: [[0, 0, -1]],
  triangles: [],
  extents_by_axis: {},
} as any;

function setup(over: Partial<Record<string, unknown>> = {}) {
  const onAxisChange = vi.fn();
  const r = render(MountingPicker, {
    props: { analysis, axis: 'horizontal_0', onAxisChange, ...over } as any,
  });
  return { ...r, onAxisChange };
}

describe('MountingPicker', () => {
  it('offers ceiling, wall and floor and presses the current mounting', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Ceiling/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Wall/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Floor/ })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('.mount-btn[data-group="wall"]')).not.toBeNull();
  });

  it('tags the mounting the file analysis suggested', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Wall/ }).textContent).toMatch(/detected from file/i);
    expect(screen.getByRole('button', { name: /^Ceiling/ }).textContent).not.toMatch(/detected/i);
  });

  it('a four-way sheet suggests the ceiling', () => {
    setup({ analysis: { ...analysis, suggested_axis: 'down' }, axis: 'down' });
    expect(screen.getByRole('button', { name: /^Ceiling/ }).textContent).toMatch(/detected from file/i);
  });

  it('ceiling and floor map to the down and up axes', async () => {
    const { onAxisChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: /^Ceiling/ }));
    expect(onAxisChange).toHaveBeenCalledWith('down');
    await fireEvent.click(screen.getByRole('button', { name: /^Floor/ }));
    expect(onAxisChange).toHaveBeenCalledWith('up');
  });

  it('wall puts the side opposite the strongest light against the wall', async () => {
    const { onAxisChange } = setup({
      axis: 'down',
      analysis: { ...analysis, axis_scores: { ...analysis.axis_scores, horizontal_0: 0.1, horizontal_180: 0.6 } },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^Wall/ }));
    expect(onAxisChange).toHaveBeenCalledWith('horizontal_180');
  });

  it('the wall-side menu shows the side against the wall and emits the matching axis', async () => {
    const { onAxisChange, unmount } = setup();
    const select = document.querySelector('#wall-side') as HTMLSelectElement;
    expect(select.value).toBe('180');
    await fireEvent.change(select, { target: { value: '90' } });
    expect(onAxisChange).toHaveBeenCalledWith('horizontal_270');
    unmount();
    setup({ axis: 'down' });
    expect(document.querySelector('#wall-side')).toBeNull();
  });
});
