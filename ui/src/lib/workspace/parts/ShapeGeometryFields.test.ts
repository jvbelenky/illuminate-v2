import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ShapeGeometryFields from './ShapeGeometryFields.svelte';
import type { Vertex } from '$lib/utils/roomGeometry';
import type { ReferenceMode } from './shapeGeometry';

// A 2 x 1 box from (1, 1) to (3, 2).
const box: Vertex[] = [[1, 1], [3, 1], [3, 2], [1, 2]];
const LABELS = ['Top-left corner', 'Top-right corner', 'Centre', 'Bottom-left corner', 'Bottom-right corner'];

function mount(reference: ReferenceMode, vertices: Vertex[] = box, yaw = 0) {
  const onReferenceChange = vi.fn();
  const onChange = vi.fn();
  const r = render(ShapeGeometryFields, { props: { vertices, yaw, reference, units: 'meters', onChange, onReferenceChange } });
  return { ...r, onReferenceChange, onChange };
}
const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe('ShapeGeometryFields reference picker', () => {
  it('renders five targets in a radiogroup, the chosen one checked', () => {
    mount('corner-tr');
    const group = screen.getByRole('radiogroup', { name: 'Reference' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(LABELS);
    for (const r of radios) expect(r.getAttribute('title')).toBe(r.getAttribute('aria-label'));
    expect(screen.getByRole('radio', { name: 'Top-right corner' }).getAttribute('aria-checked')).toBe('true');
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('clicking a target calls onReferenceChange with its mode', async () => {
    const { onReferenceChange } = mount('centre');
    await fireEvent.click(screen.getByRole('radio', { name: 'Bottom-right corner' }));
    expect(onReferenceChange).toHaveBeenCalledWith('corner-br');
    await fireEvent.click(screen.getByRole('radio', { name: 'Centre' }));
    expect(onReferenceChange).toHaveBeenCalledTimes(1); // already chosen
  });

  it.each([
    ['centre', '2', '1.5'],
    ['corner-bl', '1', '1'],
    ['corner-br', '3', '1'],
    ['corner-tl', '1', '2'],
    ['corner-tr', '3', '2'],
  ] as const)('X/Y show the %s point', (mode, x, y) => {
    mount(mode);
    expect(val('X')).toBe(x);
    expect(val('Y')).toBe(y);
  });

  it("the old 'corner' shows and checks the bottom-left corner", () => {
    mount('corner' as ReferenceMode);
    expect(val('X')).toBe('1');
    expect(screen.getByRole('radio', { name: 'Bottom-left corner' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switching the prop moves X/Y to the new point; Width keeps that corner fixed', async () => {
    const { rerender, onChange } = mount('centre');
    await rerender({ reference: 'corner-tr' });
    expect(val('X')).toBe('3');
    expect(val('Y')).toBe('2');
    const w = screen.getByLabelText('Width') as HTMLInputElement;
    w.value = '4';
    await fireEvent.change(w);
    const [vs] = onChange.mock.calls.at(-1) as [Vertex[], number];
    const xs = vs.map((v) => v[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-1, 3]);
  });

  it('arrow keys move focus between targets', async () => {
    mount('centre');
    const tl = screen.getByRole('radio', { name: 'Top-left corner' });
    tl.focus();
    await fireEvent.keyDown(tl, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Top-right corner');
    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Bottom-right corner');
  });
});
