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

describe('PlanCanvas plain grid', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('draws no ruler labels and no outside shading', async () => {
    const svg = mount();
    await resize(svg, 400, 300);
    expect(svg.querySelector('rect.outside')).toBeNull();
    expect(svg.querySelector('text.tick')).toBeNull();
    // Remaining text is only outline annotations (edge lengths, vertex numbers), never grid numbers
    for (const t of svg.querySelectorAll('text')) expect(t.getAttribute('class')).toMatch(/edge-label|vertex-label|shape-label|lamp-label|cursor-label|angle-label/);
  });

  it('keeps minor and major grid lines', async () => {
    const svg = mount();
    await resize(svg, 400, 300);
    const lines = svg.querySelectorAll('line.grid-line');
    const major = svg.querySelectorAll('line.grid-line.major');
    expect(lines.length).toBeGreaterThan(major.length);
    expect(major.length).toBeGreaterThan(0);
  });

  it('keeps the zoom buttons', () => {
    mount();
    expect(screen.getByLabelText('Zoom in')).toBeTruthy();
    expect(screen.getByLabelText('Zoom out')).toBeTruthy();
    expect(screen.getByLabelText('Fit')).toBeTruthy();
  });
});

describe('PlanCanvas on-screen sizes', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  const lamp = { id: 'l1', name: 'Lamp 1', lamp_type: 'krcl_222', x: 2, y: 3, z: 2.5, aimx: 2, aimy: 3, aimz: 0, scaling_factor: 1, enabled: true };
  const shape = { id: 's1', name: 'Shelf', vertices: [[1, 1], [2, 1], [2, 2], [1, 2]] as Vertex[] };

  function mountWithScene() {
    const { container } = render(PlanCanvas, {
      props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2, lamps: [lamp] as never, shapes: [shape] as never },
    });
    return container.querySelector('svg.plan') as SVGSVGElement;
  }

  /** Screen pixels per SVG unit: the short side of the canvas shows view.size units. */
  const screenPerUnit = (svg: SVGSVGElement) => Math.min(svg.clientWidth, svg.clientHeight) / Math.min(box(svg).w, box(svg).h);
  const radiusPx = (svg: SVGSVGElement, sel: string) => Number(svg.querySelector(sel)!.getAttribute('r')) * screenPerUnit(svg);
  const fontPx = (svg: SVGSVGElement, sel: string) => Number(svg.querySelector(sel)!.getAttribute('font-size')) * screenPerUnit(svg);

  // Minimums on screen: text 11 px, lamp markers 12 px across, handles 9 px across
  for (const [w, h] of [[333, 801], [700, 400], [1100, 850]]) {
    it(`draws labels, markers and handles at their minimum sizes in a ${w} x ${h} canvas`, async () => {
      const svg = mountWithScene();
      await resize(svg, w, h);
      expect(fontPx(svg, 'text.lamp-label')).toBeGreaterThanOrEqual(11 - 1e-6);
      expect(fontPx(svg, 'text.edge-label')).toBeGreaterThanOrEqual(11 - 1e-6);
      expect(fontPx(svg, 'text.shape-label')).toBeGreaterThanOrEqual(11 - 1e-6);
      expect(fontPx(svg, 'text.vertex-label')).toBeGreaterThanOrEqual(11 - 1e-6);
      expect(radiusPx(svg, 'circle.lamp') * 2).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(radiusPx(svg, 'circle.vertex') * 2).toBeGreaterThanOrEqual(9 - 1e-6);
      expect(radiusPx(svg, 'g.mid-handle circle') * 2).toBeGreaterThanOrEqual(9 - 1e-6);
    });
  }
});
