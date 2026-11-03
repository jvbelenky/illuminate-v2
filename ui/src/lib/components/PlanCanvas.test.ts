import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { userSettings } from '$lib/stores/settings';
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
    await fireEvent.wheel(svg, { deltaY: -200, ctrlKey: true, clientX: 0, clientY: 0 });
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
    await fireEvent.dblClick(svg);
    expect(box(svg).w).toBeCloseTo(box(svg).h, 6);
  });

  it('fitInset keeps the outline at least that many pixels from the top and bottom', async () => {
    const { container } = render(PlanCanvas, { props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2, fitInset: 52 } });
    const svg = container.querySelector('svg.plan') as SVGSVGElement;
    await resize(svg, 900, 500);
    const v = box(svg);
    const pxPerUnit = 500 / v.h;
    expect((0 - v.bottom) * pxPerUnit).toBeGreaterThanOrEqual(52 - 1e-6);
    expect((v.bottom + v.h - 6) * pxPerUnit).toBeGreaterThanOrEqual(52 - 1e-6);
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
      expect(radiusPx(svg, 'g.mid-handle circle:not(.mid-hit)') * 2).toBeGreaterThanOrEqual(9 - 1e-6);
    });
  }

  // Pointer targets never shrink below the old fixed scale (a 560 px short side drew 1 px per unit)
  const oldPx = (svg: SVGSVGElement) => Math.min(svg.clientWidth, svg.clientHeight) / 560; // old target pixels per drawn pixel

  it('a large canvas keeps pointer targets at least as big as before', async () => {
    const svg = mountWithScene();
    await resize(svg, 1000, 800);
    const k = oldPx(svg); // 800 / 560
    expect(k).toBeGreaterThan(1);
    expect(radiusPx(svg, 'circle.vertex-hit')).toBeGreaterThanOrEqual(6 * k - 1e-6);
    expect(radiusPx(svg, 'circle.mid-hit')).toBeGreaterThanOrEqual(5 * k - 1e-6);
    const edge = Number(svg.querySelector('line.edge-hit')!.getAttribute('stroke-width')) * screenPerUnit(svg);
    expect(edge).toBeGreaterThanOrEqual(10 * k - 1e-6);
    // The drawn handle stays at its on-screen size
    expect(radiusPx(svg, 'circle.vertex')).toBeCloseTo(6, 4);
  });

  it('the close-polygon threshold is at least the old distance in a large canvas', async () => {
    const onDrawEnd = vi.fn();
    const { container } = render(PlanCanvas, { props: { draft: [[0, 0], [4, 0], [4, 6]] as Vertex[], units: 'meters', precision: 2, drawing: true, tool: 'draw', onDrawEnd } });
    const svg = container.querySelector('svg.plan') as SVGSVGElement;
    await resize(svg, 1000, 800);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const k = oldPx(svg);
    const s = screenPerUnit(svg);
    const [vx, vy] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // Just inside the old threshold (12 px at the old scale) from the first corner
    await fireEvent.click(svg, { clientX: (0 - vx) * s + 11 * k, clientY: (0 - vy) * s, altKey: true });
    expect(onDrawEnd).toHaveBeenCalledWith(true);
  });

  it('a narrow canvas gets the larger drawn sizes for its targets too', async () => {
    const svg = mountWithScene();
    await resize(svg, 333, 801);
    // short side 333 < 560: no separate hit circles, the drawn handle is the target
    expect(svg.querySelector('circle.vertex-hit')).toBeNull();
    expect(radiusPx(svg, 'circle.vertex')).toBeCloseTo(6, 4); // 6 px drawn vs 3.6 px before
    const edge = Number(svg.querySelector('line.edge-hit')!.getAttribute('stroke-width')) * screenPerUnit(svg);
    expect(edge).toBeCloseTo(10, 4); // 10 px vs 5.9 px before
  });
});

describe('PlanCanvas navigation: Hand and Zoom', () => {
  const W = 400;
  const H = 400;
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    localStorage.clear();
    userSettings.update((s) => ({ ...s, planNavMode: 'hand' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    userSettings.update((s) => ({ ...s, planNavMode: 'hand' }));
  });

  async function mountSized(props: Record<string, unknown> = {}) {
    const { container, unmount } = render(PlanCanvas, { props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2, ...props } });
    const svg = container.querySelector('svg.plan') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await resize(svg, W, H);
    return { svg, container, unmount };
  }
  /** The room point under a client point, for the square W x H canvas. */
  function roomAt(svg: SVGSVGElement, cx: number, cy: number): [number, number] {
    const v = box(svg);
    const upp = v.h / H;
    return [v.x + cx * upp, v.bottom + (H - cy) * upp];
  }
  const modeButton = (mode: 'hand' | 'zoom') => document.querySelector(`button.nav-mode[data-mode="${mode}"]`) as HTMLButtonElement;

  it('the view tools are Pan | Zoom, then - | +, then Fit, bottom right', async () => {
    await mountSized();
    expect(screen.getByRole('button', { name: 'Zoom out' }).title).toBe('Zoom out (−)');
    expect(screen.getByRole('button', { name: 'Zoom in' }).title).toBe('Zoom in (+)');
    expect(modeButton('hand').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton('zoom').getAttribute('aria-pressed')).toBe('false');
    expect(modeButton('hand').querySelector('svg')).not.toBeNull();
    expect(modeButton('zoom').querySelector('svg')).not.toBeNull();
    expect(modeButton('hand').title).toBe('Pan (H)');
    expect(modeButton('zoom').title).toBe('Zoom (Z)');
    expect(screen.getByRole('button', { name: 'Pan' })).toBe(modeButton('hand'));
    const fit = screen.getByRole('button', { name: 'Fit' });
    expect(fit.title).toBe('Fit (F)');
    // No units select unless the host asks for one
    expect(document.querySelector('.view-controls select')).toBeNull();
  });

  it('Zoom in / out step the view about its centre, by button and by key', async () => {
    const { svg } = await mountSized();
    const b0 = box(svg);
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const b1 = box(svg);
    expect(b1.h).toBeCloseTo(b0.h / 1.25, 5);
    expect(b1.x + b1.w / 2).toBeCloseTo(b0.x + b0.w / 2, 5);
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(box(svg).h).toBeCloseTo(b0.h, 5);
    await fireEvent.keyDown(window, { key: '-' });
    expect(box(svg).h).toBeCloseTo(b0.h * 1.25, 5);
    await fireEvent.keyDown(window, { key: '+' });
    await fireEvent.keyDown(window, { key: '=' });
    expect(box(svg).h).toBeCloseTo(b0.h / 1.25, 5);
  });

  it('the mode persists in userSettings', async () => {
    const first = await mountSized();
    await fireEvent.click(modeButton('zoom'));
    expect(modeButton('zoom').getAttribute('aria-pressed')).toBe('true');
    expect(modeButton('hand').getAttribute('aria-pressed')).toBe('false');
    expect(get(userSettings).planNavMode).toBe('zoom');
    expect(JSON.parse(localStorage.getItem('illuminate-settings')!).planNavMode).toBe('zoom');
    first.unmount();
    await mountSized();
    expect(modeButton('zoom').getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(modeButton('hand'));
    expect(get(userSettings).planNavMode).toBe('hand');
  });

  it('Hand: wheel pans', async () => {
    const { svg } = await mountSized();
    const v0 = box(svg);
    const upp = v0.h / H;
    await fireEvent.wheel(svg, { deltaX: 40, deltaY: 20, clientX: 200, clientY: 200 });
    const v1 = box(svg);
    expect(v1.h).toBeCloseTo(v0.h, 9);
    expect(v1.x).toBeCloseTo(v0.x + 40 * upp, 9);
    expect(v1.bottom).toBeCloseTo(v0.bottom - 20 * upp, 9);
  });

  it('Zoom: wheel zooms about the pointer', async () => {
    const { svg } = await mountSized();
    await fireEvent.click(modeButton('zoom'));
    const v0 = box(svg);
    const anchor = roomAt(svg, 100, 300);
    await fireEvent.wheel(svg, { deltaX: 0, deltaY: 100, clientX: 100, clientY: 300 });
    const v1 = box(svg);
    expect(v1.h).toBeCloseTo(v0.h * Math.exp(100 * 0.0015), 9);
    const after = roomAt(svg, 100, 300);
    expect(after[0]).toBeCloseTo(anchor[0], 9);
    expect(after[1]).toBeCloseTo(anchor[1], 9);
    // deltaX alone does nothing in Zoom mode
    await fireEvent.wheel(svg, { deltaX: 80, deltaY: 0, clientX: 100, clientY: 300 });
    expect(box(svg)).toEqual(v1);
  });

  it('Ctrl+wheel zooms in either mode', async () => {
    const { svg } = await mountSized();
    for (const mode of ['hand', 'zoom'] as const) {
      await fireEvent.click(modeButton(mode));
      const before = box(svg).h;
      await fireEvent.wheel(svg, { deltaX: 0, deltaY: -100, ctrlKey: true, clientX: 200, clientY: 200 });
      expect(box(svg).h).toBeCloseTo(before * Math.exp(-100 * 0.0015), 9);
      const mid = box(svg).h;
      await fireEvent.wheel(svg, { deltaX: 0, deltaY: -100, metaKey: true, clientX: 200, clientY: 200 });
      expect(box(svg).h).toBeCloseTo(mid * Math.exp(-100 * 0.0015), 9);
    }
  });

  it('Hand: background drag pans', async () => {
    const { svg } = await mountSized();
    const v0 = box(svg);
    const upp = v0.h / H;
    await fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { clientX: 160, clientY: 130, pointerId: 1 });
    await fireEvent.pointerUp(svg, { clientX: 160, clientY: 130, pointerId: 1 });
    const v1 = box(svg);
    expect(v1.h).toBeCloseTo(v0.h, 9);
    expect(v1.x).toBeCloseTo(v0.x - 60 * upp, 9);
    expect(v1.bottom).toBeCloseTo(v0.bottom + 30 * upp, 9);
    expect(svg.querySelector('rect.zoom-box')).toBeNull();
  });

  it('Zoom: background drag zooms to the box', async () => {
    const { svg } = await mountSized();
    await fireEvent.click(modeButton('zoom'));
    const v0 = box(svg);
    // A press that barely moves (under 4 px) is a click: nothing happens
    await fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { clientX: 103, clientY: 102, pointerId: 1 });
    await fireEvent.pointerUp(svg, { clientX: 103, clientY: 102, pointerId: 1 });
    expect(box(svg)).toEqual(v0);
    // A real box: drawn dashed while dragging, then fills the view
    const a = roomAt(svg, 100, 100);
    const b = roomAt(svg, 200, 300);
    await fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { clientX: 200, clientY: 300, pointerId: 1 });
    const rect = svg.querySelector('rect.zoom-box');
    expect(rect).not.toBeNull();
    expect(rect!.getAttribute('stroke-dasharray')).toBeTruthy();
    await fireEvent.pointerUp(svg, { clientX: 200, clientY: 300, pointerId: 1 });
    expect(svg.querySelector('rect.zoom-box')).toBeNull();
    const v1 = box(svg);
    // The box is 100 x 200 px: its taller side fills the square view, centred on it
    expect(v1.h).toBeCloseTo(Math.abs(a[1] - b[1]), 9);
    expect(v1.x + v1.w / 2).toBeCloseTo((a[0] + b[0]) / 2, 9);
    expect(v1.bottom + v1.h / 2).toBeCloseTo((a[1] + b[1]) / 2, 9);
  });

  it('double-click empty space fits', async () => {
    const { svg } = await mountSized({ dblClickCorners: true });
    const fitted = svg.getAttribute('viewBox');
    await fireEvent.wheel(svg, { deltaX: 0, deltaY: -300, ctrlKey: true, clientX: 50, clientY: 50 });
    const zoomed = svg.getAttribute('viewBox');
    expect(zoomed).not.toBe(fitted);
    // A Shift+double-click on a corner keeps its meaning (remove the corner) and does not fit
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Corner 2' }), { shiftKey: true });
    expect(svg.querySelectorAll('circle.vertex')).toHaveLength(3);
    expect(svg.getAttribute('viewBox')).toBe(zoomed);
    await fireEvent.dblClick(svg, { clientX: 390, clientY: 10 });
    const v = box(svg);
    expect(svg.getAttribute('viewBox')).not.toBe(zoomed);
    // Fitted again around the (now three-corner) outline
    expect(v.x).toBeLessThan(0);
    expect(v.x + v.w).toBeGreaterThan(4);
  });

  it('a double-click on a corner never fits, even where corners do not take double-clicks', async () => {
    const { svg } = await mountSized();
    await fireEvent.wheel(svg, { deltaX: 0, deltaY: -300, ctrlKey: true, clientX: 50, clientY: 50 });
    const zoomed = svg.getAttribute('viewBox');
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Corner 2' }));
    expect(svg.getAttribute('viewBox')).toBe(zoomed);
    expect(svg.querySelectorAll('circle.vertex')).toHaveLength(4);
  });

  it('two-finger touch pinch zooms and pans', async () => {
    const { svg } = await mountSized();
    const v0 = box(svg);
    const anchor = roomAt(svg, 200, 200);
    await fireEvent.pointerDown(svg, { clientX: 100, clientY: 200, button: 0, pointerId: 11, pointerType: 'touch' });
    await fireEvent.pointerDown(svg, { clientX: 300, clientY: 200, button: 0, pointerId: 12, pointerType: 'touch' });
    // Spread from 200 px apart to 300: the midpoint moves from (200, 200) to (250, 200)
    await fireEvent.pointerMove(svg, { clientX: 400, clientY: 200, pointerId: 12, pointerType: 'touch' });
    const v1 = box(svg);
    expect(v1.h).toBeCloseTo((v0.h * 200) / 300, 9);
    const under = roomAt(svg, 250, 200);
    expect(under[0]).toBeCloseTo(anchor[0], 9);
    expect(under[1]).toBeCloseTo(anchor[1], 9);
    // Both fingers move down together: a pure pan
    await fireEvent.pointerMove(svg, { clientX: 100, clientY: 260, pointerId: 11, pointerType: 'touch' });
    await fireEvent.pointerMove(svg, { clientX: 400, clientY: 260, pointerId: 12, pointerType: 'touch' });
    const v2 = box(svg);
    expect(v2.h).toBeCloseTo(v1.h, 9);
    const under2 = roomAt(svg, 250, 260);
    expect(under2[0]).toBeCloseTo(anchor[0], 9);
    expect(under2[1]).toBeCloseTo(anchor[1], 9);
    await fireEvent.pointerUp(svg, { clientX: 400, clientY: 260, pointerId: 12, pointerType: 'touch' });
    await fireEvent.pointerUp(svg, { clientX: 100, clientY: 260, pointerId: 11, pointerType: 'touch' });
    // One finger on empty space then follows the mode (Hand: pans)
    const v3 = box(svg);
    await fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 13, pointerType: 'touch' });
    await fireEvent.pointerMove(svg, { clientX: 150, clientY: 100, pointerId: 13, pointerType: 'touch' });
    await fireEvent.pointerUp(svg, { clientX: 150, clientY: 100, pointerId: 13, pointerType: 'touch' });
    expect(box(svg).x).toBeCloseTo(v3.x - 50 * (v3.h / H), 9);
  });

  it('a double-tap on empty space fits', async () => {
    const { svg } = await mountSized();
    const fitted = svg.getAttribute('viewBox');
    await fireEvent.wheel(svg, { deltaX: 0, deltaY: -300, ctrlKey: true, clientX: 50, clientY: 50 });
    expect(svg.getAttribute('viewBox')).not.toBe(fitted);
    for (let i = 0; i < 2; i++) {
      await fireEvent.pointerDown(svg, { clientX: 390, clientY: 10, button: 0, pointerId: 20 + i, pointerType: 'touch' });
      await fireEvent.pointerUp(svg, { clientX: 390, clientY: 10, pointerId: 20 + i, pointerType: 'touch' });
    }
    expect(svg.getAttribute('viewBox')).toBe(fitted);
  });

  const corners = (svg: SVGSVGElement) => [...svg.querySelectorAll('circle.vertex')].map((c) => [c.getAttribute('cx'), c.getAttribute('cy')].join(','));
  const touch = (id: number, x: number, y: number, isPrimary = false) => ({ clientX: x, clientY: y, button: 0, pointerId: id, pointerType: 'touch', isPrimary });

  it('a second finger during a touch edit cancels it: the corner goes back and nothing is applied', async () => {
    const onEdit = vi.fn();
    const { svg } = await mountSized({ onEdit });
    const before = corners(svg);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Corner 2' }), touch(40, 200, 300, true));
    await fireEvent.pointerMove(svg, touch(40, 260, 300));
    expect(corners(svg)).not.toEqual(before);
    // A second finger lands (on another corner): the drag is cancelled, the other corner is not taken
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Corner 3' }), touch(41, 300, 100));
    expect(corners(svg)).toEqual(before);
    // Neither finger does anything more until both lift
    await fireEvent.pointerMove(svg, touch(41, 350, 150));
    await fireEvent.pointerMove(svg, touch(40, 300, 300));
    await fireEvent.pointerUp(svg, touch(41, 350, 150));
    await fireEvent.pointerMove(svg, touch(40, 320, 300));
    await fireEvent.pointerUp(svg, touch(40, 320, 300));
    expect(corners(svg)).toEqual(before);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('a cancelled midpoint drag takes its new corner away again', async () => {
    const onEdit = vi.fn();
    const { svg } = await mountSized({ onEdit });
    const before = corners(svg);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Insert corner on wall 1' }), touch(42, 200, 380, true));
    await fireEvent.pointerMove(svg, touch(42, 200, 340));
    expect(svg.querySelectorAll('circle.vertex')).toHaveLength(5);
    await fireEvent.pointerDown(svg, touch(43, 100, 100));
    await fireEvent.pointerUp(svg, touch(43, 100, 100));
    await fireEvent.pointerUp(svg, touch(42, 200, 340));
    expect(corners(svg)).toEqual(before);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('a single-finger touch drag on a corner still edits', async () => {
    const onEdit = vi.fn();
    const { svg } = await mountSized({ onEdit });
    const before = corners(svg);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Corner 2' }), touch(44, 200, 300, true));
    await fireEvent.pointerMove(svg, touch(44, 260, 300));
    await fireEvent.pointerUp(svg, touch(44, 260, 300));
    expect(corners(svg)).not.toEqual(before);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('only the pointer that started a drag moves it (a finger during a mouse drag is ignored)', async () => {
    const onEdit = vi.fn();
    const { svg } = await mountSized({ onEdit });
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Corner 2' }), { clientX: 200, clientY: 300, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true });
    await fireEvent.pointerMove(svg, { clientX: 240, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    const moved = corners(svg);
    await fireEvent.pointerDown(svg, touch(50, 100, 100, true));
    await fireEvent.pointerMove(svg, touch(50, 20, 20));
    await fireEvent.pointerUp(svg, touch(50, 20, 20));
    expect(corners(svg)).toEqual(moved);
    expect(onEdit).not.toHaveBeenCalled();
    await fireEvent.pointerUp(svg, { clientX: 240, clientY: 300, pointerId: 1, pointerType: 'mouse' });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('a stale finger left behind does not block a later one-finger pan', async () => {
    const { svg } = await mountSized();
    // A finger whose release never arrived
    await fireEvent.pointerDown(svg, touch(60, 50, 50, true));
    const v0 = box(svg);
    await fireEvent.pointerDown(svg, touch(61, 100, 100, true));
    await fireEvent.pointerMove(svg, touch(61, 150, 100));
    await fireEvent.pointerUp(svg, touch(61, 150, 100));
    expect(box(svg).h).toBeCloseTo(v0.h, 9);
    expect(box(svg).x).toBeCloseTo(v0.x - 50 * (v0.h / H), 9);
  });

  it('a finger whose capture is lost is forgotten', async () => {
    const { svg } = await mountSized();
    await fireEvent.pointerDown(svg, touch(70, 50, 50, true));
    // The browser takes the pointer without a release
    await fireEvent(svg, new PointerEvent('lostpointercapture', { pointerId: 70, pointerType: 'touch', bubbles: true }));
    // A non-primary finger now starts on its own (not as the second finger of a pinch)
    const v0 = box(svg);
    await fireEvent.pointerDown(svg, touch(71, 100, 100));
    await fireEvent.pointerMove(svg, touch(71, 150, 100));
    await fireEvent.pointerUp(svg, touch(71, 150, 100));
    expect(box(svg).h).toBeCloseTo(v0.h, 9);
    expect(box(svg).x).toBeCloseTo(v0.x - 50 * (v0.h / H), 9);
  });

  it('the svg takes touch gestures itself', async () => {
    const { svg } = await mountSized();
    // jsdom's CSSStyleDeclaration does not know touch-action, so read the attribute
    expect(svg.getAttribute('style')).toMatch(/touch-action:\s*none/);
  });
});

describe('PlanCanvas typed wall lengths', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  function mountEditable(props: Record<string, unknown> = {}) {
    const onEdit = vi.fn();
    const { container } = render(PlanCanvas, { props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2, onEdit, ...props } });
    const svg = container.querySelector('svg.plan') as SVGSVGElement;
    const points = () => svg.querySelector('polygon.outline')!.getAttribute('points');
    return { svg, container, onEdit, points };
  }
  const lengthInput = () => screen.queryByRole('textbox', { name: /Wall \d+ length/ }) as HTMLInputElement | null;

  it('double-click a wall opens its length, selected; Enter applies it', async () => {
    const { onEdit, points } = mountEditable();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Wall 1' }));
    await tick();
    const input = lengthInput()!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('4.00');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
    await fireEvent.input(input, { target: { value: '5' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(lengthInput()).toBeNull();
    expect(points()).toBe('0,0 5,0 5,-6 0,-6');
    expect(onEdit).toHaveBeenCalledTimes(1);
    // A double-click on a wall no longer adds a corner (the "+" handles do)
    expect(document.querySelectorAll('circle.vertex')).toHaveLength(4);
  });

  it('the length label opens it too, and takes units', async () => {
    const { container, points } = mountEditable();
    const label = [...container.querySelectorAll('text.edge-label')].find((t) => t.textContent === '6.00')!;
    await fireEvent.dblClick(label);
    await tick();
    const input = lengthInput()!;
    expect(input.getAttribute('aria-label')).toBe('Wall 2 length');
    await fireEvent.input(input, { target: { value: '500cm' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(points()).toBe('0,0 4,0 4,-5 0,-5');
  });

  it('Escape cancels without an edit', async () => {
    const { onEdit, points } = mountEditable();
    const before = points();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Wall 1' }));
    await tick();
    const input = lengthInput()!;
    await fireEvent.input(input, { target: { value: '9' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(lengthInput()).toBeNull();
    expect(points()).toBe(before);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('an invalid length stays open, marked invalid', async () => {
    const { onEdit, points } = mountEditable();
    const before = points();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Wall 3' }));
    await tick();
    const input = lengthInput()!;
    // 9 m on the top wall pushes corners below zero
    for (const bad of ['0', 'abc', '-1', '9']) {
      await fireEvent.input(input, { target: { value: bad } });
      expect(input.classList.contains('invalid')).toBe(false);
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(lengthInput()).toBe(input);
      expect(input.classList.contains('invalid')).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    expect(points()).toBe(before);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('read-only canvases (no onEdit) do not open it', async () => {
    mountEditable({ onEdit: undefined });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Wall 1' }));
    await tick();
    expect(lengthInput()).toBeNull();
  });
});

describe('PlanCanvas snapping to the room outline', () => {
  const S = 400;
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  const roomOutline: Vertex[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const square: Vertex[] = [[2, 2], [4, 2], [4, 4], [2, 4]];

  async function mountInRoom() {
    const onEdit = vi.fn();
    const { container, component } = render(PlanCanvas, {
      props: { draft: square.map((v) => [...v] as Vertex), units: 'meters', precision: 2, outline: roomOutline, draggableBody: true, onEdit },
    });
    const svg = container.querySelector('svg.plan') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: S, height: S, right: S, bottom: S, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await resize(svg, S, S);
    (component as unknown as { fitView: (p: Vertex[]) => void }).fitView(roomOutline);
    await tick();
    const v = box(svg);
    const upp = v.h / S;
    const client = (x: number, y: number) => ({ clientX: (x - v.x) / upp, clientY: S - (y - v.bottom) / upp });
    const xs = () => [...svg.querySelectorAll('circle.vertex')].map((c) => Number(c.getAttribute('cx')));
    const ys = () => [...svg.querySelectorAll('circle.vertex')].map((c) => -Number(c.getAttribute('cy')));
    return { svg, onEdit, upp, client, xs, ys };
  }

  it('a body drag near a wall ends flush, with the wall highlighted', async () => {
    const { svg, onEdit, upp, client, xs } = await mountInRoom();
    const from = client(3, 3);
    // The square's right side lands 5 px short of the right wall
    const to = client(3 + (10 - 5 * upp - 4), 3);
    await fireEvent.pointerDown(svg, { ...from, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { ...to, pointerId: 1 });
    expect(Math.max(...xs())).toBeCloseTo(10, 9);
    expect(svg.querySelectorAll('line.outline-guide')).toHaveLength(1);
    await fireEvent.pointerUp(svg, { ...to, pointerId: 1 });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(Math.max(...xs())).toBeCloseTo(10, 9);
    expect(svg.querySelectorAll('.outline-guide')).toHaveLength(0);
  });

  it('in a room corner the shape sits flush to both walls', async () => {
    const { svg, upp, client, xs, ys } = await mountInRoom();
    const from = client(3, 3);
    // Bottom-left corner 4 px right of the left wall and 3 px above the floor
    const to = client(3 - 2 + 4 * upp, 3 - 2 + 3 * upp);
    await fireEvent.pointerDown(svg, { ...from, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { ...to, pointerId: 1 });
    expect(Math.min(...xs())).toBeCloseTo(0, 9);
    expect(Math.min(...ys())).toBeCloseTo(0, 9);
    await fireEvent.pointerUp(svg, { ...to, pointerId: 1 });
  });

  it('a corner dragged near an outline corner lands on it; Alt leaves it free', async () => {
    const { svg, upp, client, xs, ys } = await mountInRoom();
    const corner = screen.getByRole('button', { name: 'Corner 3' });
    const near = client(10 - 4 * upp, 10 - 3 * upp);
    await fireEvent.pointerDown(corner, { ...client(4, 4), button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { ...near, pointerId: 1 });
    expect(xs()[2]).toBeCloseTo(10, 9);
    expect(ys()[2]).toBeCloseTo(10, 9);
    expect(svg.querySelectorAll('circle.outline-guide')).toHaveLength(1);
    await fireEvent.pointerMove(svg, { ...near, pointerId: 1, altKey: true });
    expect(xs()[2]).toBeLessThan(10 - 2 * upp);
    expect(svg.querySelectorAll('.outline-guide')).toHaveLength(0);
    await fireEvent.pointerUp(svg, { ...near, pointerId: 1 });
  });

  it('beyond 10 px the outline does not pull', async () => {
    const { svg, upp, client, xs } = await mountInRoom();
    const from = client(3, 3);
    // Right side 14 px short of the wall
    const to = client(3 + (10 - 14 * upp - 4), 3);
    await fireEvent.pointerDown(svg, { ...from, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(svg, { ...to, pointerId: 1 });
    expect(Math.max(...xs())).toBeLessThan(10 - 10 * upp);
    expect(svg.querySelectorAll('.outline-guide')).toHaveLength(0);
    await fireEvent.pointerUp(svg, { ...to, pointerId: 1 });
  });
});

describe('PlanCanvas typed corners, drawn lengths and names', () => {
  const S = 400;
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function mountView(props: Record<string, unknown> = {}) {
    const onEdit = vi.fn();
    const { container, component } = render(PlanCanvas, {
      props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2, onEdit, ...props },
    });
    const svg = container.querySelector('svg.plan') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: S, height: S, right: S, bottom: S, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await resize(svg, S, S);
    const api = component as unknown as { fitView: (p: Vertex[]) => void; startDraw: () => void };
    api.fitView([[0, 0], [10, 10]]);
    await tick();
    const v = box(svg);
    const upp = v.h / S;
    const client = (x: number, y: number) => ({ clientX: (x - v.x) / upp, clientY: S - (y - v.bottom) / upp });
    const corners = () => [...svg.querySelectorAll('circle.vertex')].map((c) => [Number(c.getAttribute('cx')), 0 - Number(c.getAttribute('cy'))]);
    return { svg, container, onEdit, api, client, corners };
  }
  const field = (name: string) => screen.queryByRole('textbox', { name }) as HTMLInputElement | null;

  it('double-click a corner types its X and Y; Tab moves between them; Enter applies', async () => {
    const { onEdit, corners } = await mountView();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Corner 2' }));
    await tick();
    const x = field('Corner 2 X')!;
    const y = field('Corner 2 Y')!;
    expect(x.value).toBe('4.00');
    expect(y.value).toBe('0.00');
    expect(document.activeElement).toBe(x);
    await fireEvent.keyDown(x, { key: 'Tab' });
    expect(document.activeElement).toBe(y);
    await fireEvent.input(x, { target: { value: '5' } });
    await fireEvent.input(y, { target: { value: '50cm' } });
    await fireEvent.keyDown(y, { key: 'Enter' });
    expect(field('Corner 2 X')).toBeNull();
    expect(corners()[1]).toEqual([5, 0.5]);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('a corner position that breaks the polygon stays open, invalid; Escape cancels', async () => {
    const { onEdit, corners } = await mountView();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Corner 2' }));
    await tick();
    const x = field('Corner 2 X')!;
    // Past the far wall: the outline would cross itself
    await fireEvent.input(x, { target: { value: '-3' } });
    await fireEvent.keyDown(x, { key: 'Enter' });
    expect(field('Corner 2 X')).toBe(x);
    expect(x.classList.contains('invalid')).toBe(true);
    await fireEvent.keyDown(x, { key: 'Escape' });
    expect(field('Corner 2 X')).toBeNull();
    expect(corners()[1]).toEqual([4, 0]);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('while drawing, a typed number places the next corner along the snapped rubber band', async () => {
    const { svg, api, client, corners } = await mountView({ draft: [] });
    api.startDraw();
    await tick();
    await fireEvent.pointerEnter(svg);
    await fireEvent.click(svg, client(2, 2));
    // Nearly level: the rubber band snaps to horizontal
    await fireEvent.pointerMove(svg, { ...client(6, 2.03), pointerId: 1 });
    await fireEvent.keyDown(svg, { key: '5' });
    await tick();
    const input = field('Wall length')!;
    expect(input.value).toBe('5');
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(field('Wall length')).toBeNull();
    expect(corners()).toEqual([[2, 2], [7, 2]]);
    // Escape closes the input only; the drawing goes on
    await fireEvent.pointerMove(svg, { ...client(7, 6), pointerId: 1 });
    await fireEvent.keyDown(svg, { key: '3' });
    await tick();
    await fireEvent.keyDown(field('Wall length')!, { key: 'Escape' });
    expect(field('Wall length')).toBeNull();
    expect(svg.classList.contains('drawing')).toBe(true);
    expect(corners()).toHaveLength(2);
    // Zero is refused
    await fireEvent.keyDown(svg, { key: '0' });
    await tick();
    const zero = field('Wall length')!;
    await fireEvent.keyDown(zero, { key: 'Enter' });
    expect(zero.classList.contains('invalid')).toBe(true);
    await fireEvent.input(zero, { target: { value: '4' } });
    await fireEvent.keyDown(zero, { key: 'Enter' });
    expect(corners()).toEqual([[2, 2], [7, 2], [7, 6]]);
  });

  it("double-click a structure's name label to rename it; an empty name is refused", async () => {
    const onShapeRename = vi.fn();
    const shapes = [{ id: 'object-1', vertices: [[6, 6], [8, 6], [8, 8], [6, 8]] as Vertex[], name: 'Box' }];
    const { container } = await mountView({ shapes, onShapeRename, onShapeClick: () => {} });
    const label = container.querySelector('text.shape-label')!;
    await fireEvent.dblClick(label);
    await tick();
    const name = field('Name')!;
    expect(name.value).toBe('Box');
    expect(name.selectionEnd).toBe(3);
    await fireEvent.input(name, { target: { value: '  ' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(name.classList.contains('invalid')).toBe(true);
    await fireEvent.input(name, { target: { value: 'Shelf' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(onShapeRename).toHaveBeenCalledWith('object-1', 'Shelf');
    expect(field('Name')).toBeNull();
  });
});

describe('PlanCanvas keys in a window', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-test-dialog]').forEach((d) => d.remove());
  });

  it('+ and − zoom the canvas in the front modal window, never the one behind it', async () => {
    const behind = render(PlanCanvas, { props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2 } });
    const back = behind.container.querySelector('svg.plan') as SVGSVGElement;
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('data-test-dialog', '');
    document.body.appendChild(dialog);
    const front = render(PlanCanvas, { target: dialog, props: { draft: room.map((v) => [...v] as Vertex), units: 'meters', precision: 2 } });
    const svg = front.container.querySelector('svg.plan') as SVGSVGElement;
    const backBox = back.getAttribute('viewBox');
    const b0 = box(svg);
    await fireEvent.pointerEnter(svg);
    await fireEvent.keyDown(document.body, { key: '+' });
    expect(box(svg).h).toBeCloseTo(b0.h / 1.25, 5);
    expect(back.getAttribute('viewBox')).toBe(backBox);
    // Focus works as well as the pointer
    await fireEvent.pointerLeave(svg);
    svg.focus();
    await fireEvent.keyDown(svg, { key: '-' });
    expect(box(svg).h).toBeCloseTo(b0.h, 5);
    // The pointer on the canvas behind the window: its keys stay off
    svg.blur();
    await fireEvent.pointerEnter(back);
    await fireEvent.keyDown(document.body, { key: '-' });
    expect(back.getAttribute('viewBox')).toBe(backBox);
  });
});
