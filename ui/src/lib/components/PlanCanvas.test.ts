import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import PlanCanvas from './PlanCanvas.svelte';
import type { Vertex } from '$lib/utils/roomGeometry';

// A ResizeObserver whose callbacks the test fires by hand
let observers: (() => void)[] = [];
class TestResizeObserver {
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
  }
  observe() {
    observers.push(this.cb);
  }
  unobserve() {}
  disconnect() {
    observers = observers.filter((c) => c !== this.cb);
  }
}

const room: Vertex[] = [[0, 0], [4, 0], [4, 6], [0, 6]];

function mount() {
  const { container } = render(PlanCanvas, { props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2 } });
  return container.querySelector('svg.plan') as SVGSVGElement;
}

async function resize(svg: SVGSVGElement, w: number, h: number) {
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(svg, 'clientHeight', { configurable: true, value: h });
  for (const cb of observers) cb();
  await tick();
}

const box = (svg: SVGSVGElement) => {
  const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  return { x, bottom: -(y + h), w, h };
};

describe('PlanCanvas view', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('takes the canvas shape and fits the outline into it', async () => {
    const svg = mount();
    await resize(svg, 270, 800);
    const v = box(svg);
    expect(v.w / v.h).toBeCloseTo(270 / 800, 3);
    // the whole 4 x 6 room shows, starting a small margin left of and below the origin
    expect(v.x).toBeLessThan(0);
    expect(v.bottom).toBeLessThan(0);
    expect(v.x + v.w).toBeGreaterThan(4);
    expect(v.bottom + v.h).toBeGreaterThan(6);
    // width is the tight side: no more than the room plus its margin
    expect(v.w).toBeLessThan(4 * 1.3);
  });

  it('refits on resize until the user zooms, then keeps the zoom and centre', async () => {
    const svg = mount();
    await resize(svg, 800, 400);
    expect(box(svg).h).toBeLessThan(6 * 1.3);
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomed = box(svg);
    const cx = zoomed.x + zoomed.w / 2;
    const cy = zoomed.bottom + zoomed.h / 2;
    await resize(svg, 400, 400);
    const after = box(svg);
    expect(after.w).toBeCloseTo(zoomed.h, 6);
    expect(after.h).toBeCloseTo(zoomed.h, 6);
    expect(after.x + after.w / 2).toBeCloseTo(cx, 6);
    expect(after.bottom + after.h / 2).toBeCloseTo(cy, 6);
    // Fit refits again for the new shape
    await fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(box(svg).w).toBeCloseTo(box(svg).h, 6);
  });

  it('a hidden canvas (0 x 0) keeps its view', async () => {
    const svg = mount();
    await resize(svg, 600, 300);
    const before = svg.getAttribute('viewBox');
    await resize(svg, 0, 0);
    expect(svg.getAttribute('viewBox')).toBe(before);
  });
});
