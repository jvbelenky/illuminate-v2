import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FootprintModal from './FootprintModal.svelte';
import type { SceneObject } from '$lib/types/project';
import { defaultRoom } from '$lib/types/project';

const room = defaultRoom({ x: 6, y: 4, z: 3 });

/** Give the plan canvas a real size in jsdom so clicks map to room coordinates. */
function stubPlan(container: HTMLElement): SVGSVGElement {
  const plan = container.querySelector('svg.plan') as SVGSVGElement;
  plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return plan;
}

const box: SceneObject = {
  id: 'object-1', name: 'Desk', shape: 'box',
  width: 2, length: 1, height: 0.75,
  x: 3, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0,
  reflectance: 0.1, transmittance: 0.2, enabled: true,
};

function centroidOf(pts: [number, number][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const c = x1 * y2 - x2 * y1;
    a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

describe('FootprintModal', () => {
  it('create mode starts drawing at once; three corners and Enter make a valid footprint', async () => {
    const onApply = vi.fn();
    const { container } = render(FootprintModal, { props: { mode: 'create', room, units: 'meters', onApply, onClose: vi.fn() } });
    expect(container.querySelector('svg.plan.drawing')).toBeTruthy();
    expect(screen.getByText('Draw object')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);

    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 300, clientY: 400 });
    await fireEvent.click(plan, { clientX: 300, clientY: 200 });
    await fireEvent.keyDown(plan, { key: 'Enter' });
    expect(container.querySelector('svg.plan.drawing')).toBeNull();
    expect(container.querySelectorAll('.vertex-row').length).toBe(3);
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const result = onApply.mock.calls[0][0];
    // Local vertices are centred on the footprint's centroid, which becomes the position
    const [lx, ly] = centroidOf(result.vertices);
    expect(lx).toBeCloseTo(0, 6);
    expect(ly).toBeCloseTo(0, 6);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(result.vertices.length).toBe(3);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBe(1); // default 1 m
    expect(result.reflectance).toBe(0);
  });

  it('edit mode pre-fills a box as its four corners and applies the edited properties', async () => {
    const onApply = vi.fn();
    const { container } = render(FootprintModal, { props: { mode: 'edit', object: box, room, units: 'meters', onApply, onClose: vi.fn() } });
    expect(screen.getByText('Convert to polygon')).toBeTruthy();
    expect(container.querySelector('svg.plan.drawing')).toBeNull();
    const rows = container.querySelectorAll('.vertex-row');
    expect(rows.length).toBe(4);
    // World-space corners of a 2 x 1 box centred on (3, 2)
    const xs = Array.from(rows).map((r) => parseFloat((r.querySelectorAll('input')[0] as HTMLInputElement).value)).sort();
    expect(xs).toEqual([2, 2, 4, 4]);

    await fireEvent.change(container.querySelector('#footprint-height') as HTMLInputElement, { target: { value: '1.5' } });
    await fireEvent.change(container.querySelector('#footprint-reflectance') as HTMLInputElement, { target: { value: '0.4' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const result = onApply.mock.calls[0][0];
    expect(result.x).toBeCloseTo(3, 6);
    expect(result.y).toBeCloseTo(2, 6);
    expect(result.width).toBeCloseTo(2, 6);
    expect(result.length).toBeCloseTo(1, 6);
    expect(result.height).toBe(1.5);
    expect(result.reflectance).toBe(0.4);
    expect(result.transmittance).toBe(0.2);
    expect(result.name).toBe('Desk');
  });

  it('edit mode shows the room outline and the other objects, not the edited one', () => {
    const other: SceneObject = { ...box, id: 'object-2', x: 1, y: 1 };
    const { container } = render(FootprintModal, { props: { mode: 'edit', object: box, room, units: 'meters', objects: [box, other], onApply: vi.fn(), onClose: vi.fn() } });
    expect(container.querySelector('polygon.context-outline')).toBeTruthy();
    expect(container.querySelectorAll('polygon.object-footprint').length).toBe(1);
  });

  it('Redraw asks before clearing corners; Cancel calls onClose', async () => {
    const onClose = vi.fn();
    render(FootprintModal, { props: { mode: 'edit', object: box, room, units: 'meters', onApply: vi.fn(), onClose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Redraw' }));
    expect(screen.getByText('Draw the footprint again?')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
