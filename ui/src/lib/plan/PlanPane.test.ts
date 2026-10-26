import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import { interceptUndo } from '$lib/utils/undoKeys';
import { FEET_PER_METER, LENGTH_UNITS } from '$lib/utils/unitConversion';
import type { PlanController } from './planController.svelte';

vi.mock('$lib/utils/floorplanDecode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/floorplanDecode')>();
  return {
    ...actual,
    decodeFloorPlanFile: vi.fn(async () => ({ mime: 'image/png', src: 'data:image/png;base64,AAAA', widthPx: 400, heightPx: 200 })),
  };
});

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const baseProps = { vertices: rect, units: 'meters' as const, precision: 1 };

/** The harness logs every action the plan takes; filter them by name. */
function callsOf(calls: unknown[][], name: string): unknown[][] {
  return calls.filter((c) => c[0] === name);
}

/** Render the harness and hand back its controller, which stands in for the editor panel. */
function mount(props: Record<string, unknown> = {}) {
  let ctl!: PlanController;
  const result = render(Harness, { props: { ...baseProps, ...props, onController: (c: PlanController) => (ctl = c) } });
  return { ...result, ctl };
}

/** Give the plan canvas a real size in jsdom so clicks map to room coordinates. */
function stubPlan(container: HTMLElement): SVGSVGElement {
  const plan = container.querySelector('svg.plan') as SVGSVGElement;
  plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return plan;
}

/** Pixel position of a room point on the stubbed 560 px canvas. */
function px(plan: SVGSVGElement, x: number, y: number): [number, number] {
  const [vx, vy, vsize] = plan.getAttribute('viewBox')!.split(' ').map(Number);
  return [((x - vx) / vsize) * 560, ((-y - vy) / vsize) * 560];
}

/** Click Draw, confirming the clear when corners are present. */
async function startNewOutline() {
  await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
  const confirm = screen.queryByRole('button', { name: 'Clear and draw' });
  if (confirm) await fireEvent.click(confirm);
}

/** Draw a triangle on the plan and close it with Enter. */
async function drawTriangle(container: HTMLElement) {
  const plan = stubPlan(container);
  await fireEvent.click(plan, { clientX: 100, clientY: 400 });
  await fireEvent.click(plan, { clientX: 400, clientY: 400 });
  await fireEvent.click(plan, { clientX: 400, clientY: 150 });
  await fireEvent.keyDown(plan, { key: 'Enter' });
}

describe('PlanPane', () => {
  const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };

  it('shows the toolbar for the current context', () => {
    const labels = (container: HTMLElement) => Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.textContent?.trim());
    const { container, unmount } = render(Harness, { props: { ...baseProps, lamps: [lamp] as any, context: 'lamps' } });
    expect(container.querySelector('.plan-pane svg.plan')).not.toBeNull();
    expect(labels(container)).toEqual(['Move', 'Aim', 'Copy', 'Delete']);
    unmount();
    const out = render(Harness, { props: { ...baseProps, context: 'outline' } });
    expect(labels(out.container)).toEqual(['Draw', 'Edit corners']);
    out.unmount();
    const zones = render(Harness, { props: { ...baseProps, context: 'zones' } });
    expect(labels(zones.container)).toEqual(['Copy', 'Delete']);
    zones.unmount();
    const obst = render(Harness, { props: { ...baseProps, context: 'obstacles' } });
    expect(labels(obst.container)).toEqual(['Draw', 'Copy', 'Delete']);
    obst.unmount();
    for (const context of ['reflectance', 'ceiling', 'view'] as const) {
      const r = render(Harness, { props: { ...baseProps, context } });
      expect(r.container.querySelector('.plan-toolbar')).toBeNull();
      expect(r.container.querySelector('svg.plan')).not.toBeNull();
      r.unmount();
    }
  });

  it('draws lamp markers, aim handles and labels at their minimum on-screen sizes', async () => {
    // A 333 x 801 canvas (the narrow Side by side pane): the short side shows view.size units
    class ImmediateObserver {
      cb: () => void;
      constructor(cb: () => void) { this.cb = cb; }
      observe() { this.cb(); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ImmediateObserver);
    const cw = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(333);
    const ch = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(801);
    try {
      const aimed = { ...lamp, aimx: 3, aimy: 3 };
      const { container } = render(Harness, { props: { ...baseProps, lamps: [aimed] as any, context: 'lamps' } });
      await tick();
      const svg = container.querySelector('svg.plan') as SVGSVGElement;
      const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
      const perUnit = 333 / Math.min(vw, vh);
      const r = (sel: string) => Number(svg.querySelector(sel)!.getAttribute('r')) * perUnit;
      expect(r('circle.plan-lamp') * 2).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(r('circle.plan-aim') * 2).toBeGreaterThanOrEqual(9 - 1e-6);
      expect(Number(svg.querySelector('text.plan-lamp-label')!.getAttribute('font-size')) * perUnit).toBeGreaterThanOrEqual(11 - 1e-6);
    } finally {
      cw.mockRestore();
      ch.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('lamp pointer targets are at least their old size in a large canvas and drawn larger in a narrow one', async () => {
    class ImmediateObserver {
      cb: () => void;
      constructor(cb: () => void) { this.cb = cb; }
      observe() { this.cb(); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ImmediateObserver);
    const aimed = { ...lamp, aimx: 3, aimy: 3 };
    const measure = async (w: number, h: number) => {
      const cw = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(w);
      const ch = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(h);
      try {
        const { container, unmount } = render(Harness, { props: { ...baseProps, lamps: [aimed] as any, context: 'lamps' } });
        await tick();
        const svg = container.querySelector('svg.plan') as SVGSVGElement;
        const [, , vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
        const perUnit = Math.min(w, h) / Math.min(vw, vh);
        const r = (sel: string) => { const e = svg.querySelector(sel); return e ? Number(e.getAttribute('r')) * perUnit : null; };
        const out = { lamp: r('circle.plan-lamp'), hit: r('circle.plan-hit:not(.aim)'), aimHit: r('circle.plan-hit.aim'), k: Math.min(w, h) / 560 };
        unmount();
        return out;
      } finally {
        cw.mockRestore();
        ch.mockRestore();
      }
    };
    try {
      // 1000 x 800: the old marker was 9 px x 800/560 with a 5.4 px stroke
      const big = await measure(1000, 800);
      expect(big.hit).toBeGreaterThanOrEqual((9 + 2.7) * big.k - 1e-6);
      expect(big.aimHit).toBeGreaterThanOrEqual(4.2 * big.k - 1e-6);
      // 333 x 801: drawn sizes already exceed the old targets, so no extra hit circles
      const narrow = await measure(333, 801);
      expect(narrow.hit).toBeNull();
      expect(narrow.lamp).toBeCloseTo(9, 4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('outline offers Move image once an image is loaded', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(Harness, { props: { ...baseProps, floorplan: placement, image } });
    expect(screen.getByRole('button', { name: 'Move image' })).toBeTruthy();
  });

  it('readonly draws the plan but shows no handles or toolbar and ignores drags', async () => {
    const calls: unknown[][] = [];
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    const props = { ...baseProps, calls, lamps: [lamp] as any, floorplan: placement, image, context: 'lamps' as const };
    const { container, unmount } = render(Harness, { props: { ...props, readonly: true } });
    // What it does draw: the room outline, the lamp dot and the reference image
    expect(container.querySelector('polygon.context-outline')).not.toBeNull();
    expect(container.querySelectorAll('circle.lamp')).toHaveLength(1);
    expect(container.querySelector('image.plan-image')).not.toBeNull();
    // What it does not: handles, the toolbar, the lamp markers
    expect(container.querySelector('.plan-toolbar')).toBeNull();
    expect(container.querySelectorAll('circle.vertex')).toHaveLength(0);
    expect(container.querySelectorAll('.mid-handle')).toHaveLength(0);
    expect(container.querySelectorAll('circle.plan-lamp')).toHaveLength(0);
    const plan = stubPlan(container);
    await fireEvent.pointerDown(plan, { clientX: 100, clientY: 400, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 300, clientY: 300, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    await fireEvent.click(plan, { clientX: 200, clientY: 200 });
    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(calls).toHaveLength(0);
    expect(interceptUndo('undo')).toBe(false);
    unmount();

    // Control: the same scene, editable, with a lamp selected, does show them
    const edit = render(Harness, { props: { ...props, context: 'outline' } });
    expect(edit.container.querySelectorAll('circle.vertex').length).toBeGreaterThan(0);
    expect(edit.container.querySelector('.plan-toolbar')).not.toBeNull();
    edit.unmount();
    const lampsEdit = render(Harness, { props });
    expect(screen.getByRole('button', { name: 'Lamp Beacon' })).toBeTruthy();
    expect(lampsEdit.container.querySelector('.plan-toolbar')).not.toBeNull();
  });

  it('readonly renders no dialogs, even with a leave pending', async () => {
    const { ctl } = mount({ readonly: true });
    ctl.setVertexCoord(1, 1, 6);
    ctl.requestLeave(() => {});
    ctl.askTrace = true;
    ctl.askSetScale = true;
    await tick();
    expect(ctl.pendingLeave).not.toBeNull();
    expect(screen.queryByText('Outline not saved')).toBeNull();
    expect(screen.queryByText('Trace the room outline')).toBeNull();
    expect(screen.queryByText('Set the scale now?')).toBeNull();
  });

  it('Escape cancels a drawing in a standalone pane, and only once', async () => {
    const { ctl } = mount({ context: 'zones' });
    const spy = vi.spyOn(ctl, 'onEscapeKey');
    ctl.startZoneDraw('plane');
    await tick();
    expect(ctl.drawing).toBe(true);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(ctl.drawing).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Escape is left alone while typing in a field', async () => {
    const { ctl, container } = mount({ context: 'zones' });
    ctl.startZoneDraw('plane');
    await tick();
    const input = document.createElement('input');
    container.appendChild(input);
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(ctl.drawing).toBe(true);
  });

  describe('upload flow', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

    it('upload offers Set scale and Escape dismisses it, leaving the outline alone', async () => {
      const { ctl } = mount();
      await ctl.onFileChosen(new File(['x'], 'plan.png', { type: 'image/png' }));
      await screen.findByLabelText('Floor plan reference image');
      await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Set scale now' }));
      expect(ctl.tool).toBe('custom');
      // The page forwards Escape to the controller (+page.svelte passes handleEscape={false})
      expect(ctl.onEscapeKey()).toBe(true);
      expect(ctl.tool).toBe('edit');
      expect(ctl.draft).toHaveLength(4);
    });

    it('a restored image does not clear the outline; a confirmed scale returns to editing', async () => {
      const { container, ctl } = mount({ floorplan: placement, image });
      expect(ctl.draft).toHaveLength(4);
      ctl.startSetScale();
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 300 });
      await fireEvent.click(plan, { clientX: 300, clientY: 300 });
      const input = await screen.findByLabelText('Measured distance');
      await fireEvent.input(input, { target: { value: '4' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(ctl.tool).toBe('edit');
      expect(ctl.draft).toHaveLength(4);
    });

    it('fits the view with the origin near the bottom-left corner, not centred', () => {
      const { container } = mount();
      const [x, y, size] = (container.querySelector('svg.plan')!.getAttribute('viewBox') ?? '').split(' ').map(Number);
      expect(x).toBeLessThan(0);
      expect(x).toBeGreaterThan(-0.6);
      expect(-(y + size)).toBeGreaterThan(-0.6);
      expect(size).toBeLessThan(7);
    });

    it('placing a corner near the canvas edge does not change the zoom', async () => {
      const { container, ctl } = mount();
      await startNewOutline();
      const plan = stubPlan(container);
      const before = plan.getAttribute('viewBox');
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      await fireEvent.click(plan, { clientX: 556, clientY: 4 });
      expect(ctl.draft).toHaveLength(2);
      expect(plan.getAttribute('viewBox')).toBe(before);
    });

    it('the cursor aligns with an existing corner and shows a guideline', async () => {
      const { container, ctl } = mount();
      await startNewOutline();
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      await fireEvent.click(plan, { clientX: 300, clientY: 400 });
      const firstX = ctl.fmt(ctl.draft[0][0]);
      await fireEvent.pointerMove(plan, { clientX: 107, clientY: 250 });
      expect(container.querySelector('.cursor-label')?.textContent?.startsWith(firstX + ',')).toBe(true);
      expect(container.querySelectorAll('.guide').length).toBe(1);
      await fireEvent.click(plan, { clientX: 107, clientY: 250 });
      await fireEvent.keyDown(plan, { key: 'Enter' });
      expect(container.querySelector('svg.plan.drawing')).toBeNull();
      expect(container.querySelectorAll('.guide').length).toBe(0);
    });

    it('the grid covers a canvas wider than it is tall', () => {
      const { container } = mount();
      const svg = container.querySelector('svg.plan')!;
      const [x, , size] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const axis = Array.from(svg.querySelectorAll('line.grid-line')).find((l) => l.getAttribute('x1') !== l.getAttribute('x2'))!;
      expect(parseFloat(axis.getAttribute('x2')!)).toBeGreaterThan(x + 2 * size);
    });

    it('scrolling pans and Ctrl+scroll (pinch) zooms, in any mode', async () => {
      const { container } = mount();
      const plan = stubPlan(container);
      const read = () => (plan.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const [x0, , size0] = read();
      await fireEvent.wheel(plan, { deltaX: 50, deltaY: 0 });
      const [x1, , size1] = read();
      expect(x1).toBeGreaterThan(x0);
      expect(size1).toBeCloseTo(size0, 9);
      await fireEvent.wheel(plan, { deltaX: 0, deltaY: 100, ctrlKey: true, clientX: 280, clientY: 280 });
      expect(read()[2]).toBeGreaterThan(size0);
    });

    it('Space+drag pans while drawing without placing a corner', async () => {
      const { container, ctl } = mount({ vertices: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
      const plan = stubPlan(container);
      const before = plan.getAttribute('viewBox');
      await fireEvent.pointerEnter(plan);
      await fireEvent.keyDown(window, { key: ' ' });
      await fireEvent.pointerDown(plan, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      await fireEvent.click(plan, { clientX: 260, clientY: 200 });
      await fireEvent.keyUp(window, { key: ' ' });
      expect(plan.getAttribute('viewBox')).not.toBe(before);
      expect(ctl.draft).toHaveLength(0);
    });

    it('grid snapping is light: a corner near a grid line lands on it, elsewhere it stays put', async () => {
      const { container, ctl } = mount({ precision: 2 });
      await startNewOutline();
      const plan = stubPlan(container);
      await fireEvent.pointerMove(plan, { clientX: 119, clientY: 400 });
      expect(container.querySelectorAll('.guide').length).toBe(0);
      await fireEvent.click(plan, { clientX: 119, clientY: 400 });
      await fireEvent.click(plan, { clientX: 140, clientY: 300 });
      const xs = ctl.draft.map((v) => ctl.fmt(v[0]));
      expect(xs[0]).toBe('1.00');
      expect(xs[1]).not.toBe('1.30');
      expect(parseFloat(xs[1])).toBeGreaterThan(1.2);
      expect(parseFloat(xs[1])).toBeLessThan(1.35);
    });

    it('snaps to whole units even when the visible grid is coarser, with a guideline after the first corner', async () => {
      const big: [number, number][] = [[0, 0], [30, 0], [30, 30], [0, 30]];
      const { container, ctl } = mount({ vertices: big, precision: 2 });
      await startNewOutline();
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      await fireEvent.pointerMove(plan, { clientX: 151, clientY: 250 });
      expect(container.querySelectorAll('.guide').length).toBeGreaterThan(0);
      await fireEvent.click(plan, { clientX: 151, clientY: 250 });
      expect(ctl.fmt(ctl.draft[1][0])).toBe('7.00');
    });

    it('uploading over an outline asks whether to clear it; Clear empties the corners (not yet applied), then Set scale opens', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls });
      await ctl.onFileChosen(new File(['x'], 'plan.png', { type: 'image/png' }));
      await screen.findByLabelText('Floor plan reference image');
      expect(screen.getByText('Clear the old outline?')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(screen.queryByText('Clear the old outline?')).toBeNull();
      expect(ctl.draft).toHaveLength(0);
      expect(callsOf(calls, 'setOutline')).toHaveLength(0);
      expect(screen.getByText('Set the scale now?')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
      expect(ctl.tool).toBe('edit');
    });
  });

  describe('after calibration', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

    it('the second scale click snaps to a right angle from the first when nearly straight', async () => {
      const { container, ctl } = mount({ floorplan: placement, image });
      ctl.startSetScale();
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 300 });
      // 200 px right, 10 px up: ~2.9° off horizontal, snapped flat
      await fireEvent.click(plan, { clientX: 300, clientY: 290 });
      const line = container.querySelector('.measure-line')!;
      expect(parseFloat(line.getAttribute('y2')!)).toBeCloseTo(parseFloat(line.getAttribute('y1')!), 6);
    });

    it('walls snap to a right angle only when nearly straight; otherwise the angle is free', async () => {
      const draw = async (alt: boolean, dy: number) => {
        const { container, unmount } = mount({ vertices: [] });
        await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
        const plan = stubPlan(container);
        await fireEvent.click(plan, { clientX: 100, clientY: 400 });
        await fireEvent.pointerMove(plan, { clientX: 300, clientY: 400 - dy, altKey: alt });
        const label = container.querySelector('.angle-label')?.textContent ?? '';
        const dash = container.querySelector('.rubber-band')?.getAttribute('stroke-dasharray') ?? '';
        unmount();
        return { label, dash };
      };
      expect((await draw(false, 10)).label).toBe('0°');
      expect((await draw(false, 20)).label).not.toBe('0°');
      expect((await draw(false, 80)).label).not.toBe('0°');
      expect((await draw(false, 80)).label).not.toBe('45°');
      expect((await draw(true, 10)).label).not.toBe('0°');
      const { dash } = await draw(false, 10);
      expect(dash).not.toBe('');
      expect(parseFloat(dash.split(/[ ,]+/)[0])).toBeLessThan(0.5);
    });
  });

  describe('applies as you go', () => {
    it('a corner drag applies once when it ends; an untouched outline is never re-applied', async () => {
      const calls: unknown[][] = [];
      const { container } = mount({ calls });
      const plan = stubPlan(container);
      const handle = container.querySelectorAll('circle.vertex')[2] as SVGCircleElement;
      await fireEvent.pointerDown(handle, { clientX: 500, clientY: 200, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: 520, clientY: 180, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: 540, clientY: 160, pointerId: 1 });
      expect(callsOf(calls, 'setOutline')).toHaveLength(0);
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      expect(callsOf(calls, 'setOutline')).toHaveLength(1);
      const again = container.querySelectorAll('circle.vertex')[1] as SVGCircleElement;
      await fireEvent.pointerDown(again, { clientX: 500, clientY: 400, button: 0, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      expect(callsOf(calls, 'setOutline')).toHaveLength(1);
    });

    it('an invalid outline is shown but not applied, and leaving offers to keep the saved one', async () => {
      const calls: unknown[][] = [];
      const proceed = vi.fn();
      const { container, ctl } = mount({ calls });
      // Move corner 2 from (6, 0) up to (6, 6): its walls cross the far wall
      ctl.setVertexCoord(1, 1, 6);
      await tick();
      expect(ctl.validationMessage).not.toBeNull();
      expect(container.querySelector('svg.plan.invalid')).not.toBeNull();
      expect(callsOf(calls, 'setOutline')).toHaveLength(0);
      ctl.requestLeave(proceed);
      await tick();
      expect(proceed).not.toHaveBeenCalled();
      expect(screen.getByText('Outline not saved')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Keep saved outline' }));
      expect(proceed).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z while drawing removes the last corner instead of undoing', async () => {
      const { container, ctl } = mount({ vertices: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      await fireEvent.click(plan, { clientX: 300, clientY: 400 });
      expect(ctl.draft).toHaveLength(2);
      expect(interceptUndo('undo')).toBe(true);
      await tick();
      expect(ctl.draft).toHaveLength(1);
      expect(interceptUndo('redo')).toBe(false);
    });

    it('stops intercepting Ctrl+Z when the pane is removed', () => {
      const { unmount } = mount({ vertices: [] });
      unmount();
      expect(interceptUndo('undo')).toBe(false);
    });
  });

  describe('lamps', () => {
    it('dragging a box on empty space selects the lamps inside; Shift-click adds one; Move drags them together', async () => {
      const calls: unknown[][] = [];
      const three = [
        { ...lamp, id: 'a', name: 'A', x: 1, y: 1, aimx: 1, aimy: 1 },
        { ...lamp, id: 'b', name: 'B', x: 2, y: 1, aimx: 2, aimy: 1 },
        { ...lamp, id: 'c', name: 'C', x: 5, y: 3, aimx: 5, aimy: 3 },
      ];
      const { container, ctl } = mount({ calls, lamps: three as any, context: 'lamps' });
      const plan = stubPlan(container);
      const [x0, y0] = px(plan, 0.5, 0.5);
      const [x1, y1] = px(plan, 2.5, 1.5);
      await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1 });
      expect(container.querySelector('rect.marquee')).not.toBeNull();
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      expect([...ctl.selectedLampIds].sort()).toEqual(['a', 'b']);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp C' }), { button: 0, pointerId: 1, shiftKey: true });
      expect([...ctl.selectedLampIds].sort()).toEqual(['a', 'b', 'c']);
      const [ax, ay] = px(plan, 1, 1);
      const [bx] = px(plan, 1.5, 1);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp A' }), { clientX: ax, clientY: ay, button: 0, pointerId: 2 });
      await fireEvent.pointerMove(plan, { clientX: bx, clientY: ay, pointerId: 2 });
      await fireEvent.pointerUp(plan, { pointerId: 2 });
      const ups = Object.fromEntries((callsOf(calls, 'updateLamp') as [string, string, Record<string, number>][]).map((u) => [u[1], u[2]]));
      expect(ups.a.x).toBeCloseTo(1.5, 6);
      expect(ups.b.x).toBeCloseTo(2.5, 6);
      expect(ups.c.x).toBeCloseTo(5.5, 6);
      const [ex, ey] = px(plan, 4, 0.5);
      await fireEvent.pointerDown(plan, { clientX: ex, clientY: ey, button: 0, pointerId: 3 });
      await fireEvent.pointerUp(plan, { pointerId: 3 });
      expect(ctl.selectedLampIds).toHaveLength(0);
    });

    it('Aim points every selected lamp at where the drag ends', async () => {
      const calls: unknown[][] = [];
      const two = [
        { ...lamp, id: 'a', name: 'A', x: 1, y: 1, aimx: 1, aimy: 1 },
        { ...lamp, id: 'b', name: 'B', x: 2, y: 1, aimx: 2, aimy: 1 },
      ];
      const { container, ctl } = mount({ calls, lamps: two as any, context: 'lamps' });
      const plan = stubPlan(container);
      await fireEvent.click(screen.getByRole('button', { name: 'Aim' }));
      expect(screen.getByRole('button', { name: 'Aim' }).classList.contains('active')).toBe(true);
      ctl.selectedLampIds = ['a', 'b'];
      await tick();
      const [ax, ay] = px(plan, 1, 1);
      const [tx, ty] = px(plan, 3, 3);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp A' }), { clientX: ax, clientY: ay, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: tx, clientY: ty, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const ups = callsOf(calls, 'updateLamp') as [string, string, Record<string, number>][];
      expect(ups.map((u) => u[1]).sort()).toEqual(['a', 'b']);
      for (const [, , partial] of ups) {
        expect(partial.aimx).toBeCloseTo(3, 6);
        expect(partial.aimy).toBeCloseTo(3, 6);
      }
    });

    it('dragging the ring moves the lamp and its aim together, applied once at the end', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, lamps: [{ ...lamp, aimx: 3 }] as any, context: 'lamps' });
      const plan = stubPlan(container);
      const ring = screen.getByRole('button', { name: 'Lamp Beacon' });
      const [x0, y0] = px(plan, 2, 2);
      const [x1] = px(plan, 3, 2);
      await fireEvent.pointerDown(ring, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y0, pointerId: 1 });
      expect(callsOf(calls, 'updateLamp')).toHaveLength(0);
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const updates = callsOf(calls, 'updateLamp');
      expect(updates).toHaveLength(1);
      expect(updates[0][1]).toBe('lamp-7');
      const partial = updates[0][2] as Record<string, number>;
      expect(partial.x).toBeCloseTo(3, 6);
      expect(partial.aimx).toBeCloseTo(4, 6);
      expect(partial.y).toBeCloseTo(2, 6);
      expect(ctl.selectedLampIds).toEqual(['lamp-7']);
    });

    it('dragging the dot aims the lamp without moving it, and draws the aim line', async () => {
      const calls: unknown[][] = [];
      const { container } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      const plan = stubPlan(container);
      expect(container.querySelector('line.aim-line')).toBeNull();
      const dot = screen.getByRole('button', { name: 'Aim of Beacon' });
      const [x0, y0] = px(plan, 2, 2);
      const [, y1] = px(plan, 2, 3.5);
      await fireEvent.pointerDown(dot, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x0, clientY: y1, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const [, id, partial] = callsOf(calls, 'updateLamp')[0] as [string, string, Record<string, number>];
      expect(id).toBe('lamp-7');
      expect(Object.keys(partial).sort()).toEqual(['aimx', 'aimy']);
      expect(partial.aimy).toBeCloseTo(3.5, 6);
      await tick();
      expect(container.querySelector('line.aim-line')).not.toBeNull();
    });

    it('the ribbon is greyed out with no lamps; with lamps Move is on by default', () => {
      const none = render(Harness, { props: { ...baseProps, context: 'lamps' } });
      for (const name of ['Move', 'Aim', 'Copy', 'Delete']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
      none.unmount();
      render(Harness, { props: { ...baseProps, lamps: [lamp] as any, context: 'lamps' } });
      const move = screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement;
      expect(move.disabled).toBe(false);
      expect(move.classList.contains('active')).toBe(true);
    });

    it('Delete removes the selected lamp; arrow keys nudge it with its aim', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      ctl.selectLamp('lamp-7');
      await tick();
      await fireEvent.keyDown(window, { key: 'ArrowRight' });
      const [, , partial] = callsOf(calls, 'updateLamp')[0] as [string, string, Record<string, number>];
      expect(partial.x).toBeCloseTo(2.1, 6);
      expect(partial.aimx).toBeCloseTo(2.1, 6);
      await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(calls.at(-1)).toEqual(['removeLamp', 'lamp-7']);
    });

    it('Copy duplicates the selected lamps', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      ctl.selectLamp('lamp-7');
      await tick();
      await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(callsOf(calls, 'copyLamps')).toHaveLength(1);
    });
  });

  describe('calc zones', () => {
    const wholePlane = { id: 'zone-9', name: 'Floor', type: 'plane' as const, ref_surface: 'xy' as const, enabled: true, height: 0, x1: 0, x2: 6, y1: 0, y2: 4, fit_room: true };

    it('Draw plane adds a drawn (not whole-room) plane with its outline and selects it', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, context: 'zones' });
      ctl.startZoneDraw('plane');
      await drawTriangle(container);
      await tick();
      const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
      expect(type).toBe('plane');
      expect(geometry.fit_room).toBe(false);
      expect((geometry.vertices as unknown[]).length).toBe(3);
      expect(ctl.selectedZoneId).toBe('zone-1');
    });

    it('Draw volume closes the same way and passes a footprint', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, context: 'zones' });
      ctl.startZoneDraw('volume');
      await drawTriangle(container);
      await tick();
      const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
      expect(type).toBe('volume');
      expect(geometry).toHaveProperty('x_min');
    });

    it('reshaping a whole-room plane makes it a drawn one', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, zones: [wholePlane] as any, context: 'zones' });
      ctl.selectZone('zone-9');
      await tick();
      const plan = stubPlan(container);
      const handle = container.querySelectorAll('circle.vertex')[2] as SVGCircleElement;
      const [hx, hy] = px(plan, 6, 4);
      const [tx, ty] = px(plan, 5, 3);
      await fireEvent.pointerDown(handle, { clientX: hx, clientY: hy, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: tx, clientY: ty, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const [, id, partial] = callsOf(calls, 'updateZone')[0] as [string, string, Record<string, unknown>];
      expect(id).toBe('zone-9');
      expect(partial.fit_room).toBe(false);
      expect((partial.vertices as unknown[]).length).toBe(4);
    });

    it('Place point puts a calc point where you click; dragging its dot aims it', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, context: 'zones' });
      const plan = stubPlan(container);
      ctl.setPlacing(true);
      await tick();
      const [ax, ay] = px(plan, 2, 2);
      await fireEvent.click(plan, { clientX: ax, clientY: ay });
      await tick();
      const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, number>];
      expect(type).toBe('point');
      expect(geometry.x).toBeCloseTo(2, 6);
      expect(geometry.aim_x).toBeCloseTo(2, 6);
      expect(ctl.onEscapeKey()).toBe(true);
      const dot = screen.getByRole('button', { name: /^Aim of/ });
      const [, by] = px(plan, 2, 3);
      await fireEvent.pointerDown(dot, { clientX: ax, clientY: ay, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: ax, clientY: by, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const [, , partial] = callsOf(calls, 'updateZone')[0] as [string, string, Record<string, number>];
      expect(Object.keys(partial).sort()).toEqual(['aim_x', 'aim_y']);
      expect(partial.aim_y).toBeCloseTo(3, 6);
    });

    it('standard zones stay off the plan; Delete removes the selected zone', async () => {
      const calls: unknown[][] = [];
      const standard = { ...wholePlane, id: 'WholeRoomFluence', name: 'Whole room fluence', isStandard: true, type: 'volume' as const };
      const { ctl } = mount({ calls, zones: [standard, wholePlane] as any, context: 'zones' });
      expect(ctl.userZones.map((z) => z.id)).toEqual(['zone-9']);
      ctl.selectZone('zone-9');
      await tick();
      await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(calls.at(-1)).toEqual(['removeZone', 'zone-9']);
    });
  });
});

// Ported from the retired Plan pop-up suite: the reference image, calibration
// and outline prompts now live on the pane, the controller and the Floorplan part.
describe('PlanPane reference image and calibration', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
  const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };
  const pngFile = () => new File(['x'], 'plan.png', { type: 'image/png' });

  /** Complete Set scale: two clicks and a typed distance. */
  async function calibrate(container: HTMLElement, distance = '4') {
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    const input = await screen.findByLabelText('Measured distance');
    await fireEvent.input(input, { target: { value: distance } });
    await fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('labels each lamp dot with the lamp name, falling back to its id', () => {
    const named = (id: string, name?: string) => ({ ...lamp, id, name });
    const { container } = mount({ lamps: [named('lamp-1', 'Corner unit'), named('lamp-2')] as any });
    const labels = Array.from(container.querySelectorAll('text.lamp-label')).map((t) => t.textContent);
    expect(labels).toEqual(['Corner unit', 'lamp-2']);
    expect(container.querySelectorAll('circle.lamp')).toHaveLength(2);
  });

  it('shows no image layer by default; upload adds it fitted to the room', async () => {
    const { container, ctl } = mount({ part: 'floorplan' });
    expect(container.querySelector('image.plan-image')).toBeNull();
    expect(container.querySelector('.reference-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /Floor plan image/ })).toBeTruthy();
    await ctl.onFileChosen(pngFile());
    const img = await screen.findByLabelText('Floor plan reference image');
    // 400px long edge fitted to 6 m => width 6, height 3
    expect(img.getAttribute('width')).toBe('6');
    expect(img.getAttribute('height')).toBe('3');
    expect(container.querySelector('.reference-panel')).not.toBeNull();
  });

  it('applies each finished edit at once: the upload, the calibration and a new outline', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mount({ calls });
    await ctl.onFileChosen(pngFile());
    await screen.findByLabelText('Floor plan reference image');
    const [, uploaded, img] = callsOf(calls, 'setPlacement')[0] as [string, { widthPx: number; imageId: string }, { id: string; src: string }];
    expect(img.src).toBe('data:image/png;base64,AAAA');
    expect(uploaded.widthPx).toBe(400);
    expect(uploaded.imageId).toBe(img.id);
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale now' }));
    expect(ctl.draft).toHaveLength(4);
    expect(ctl.tool).toBe('custom');
    await calibrate(container);
    expect(ctl.tool).toBe('edit');
    expect(callsOf(calls, 'setPlacement')).toHaveLength(2);
    expect(callsOf(calls, 'setOutline')).toHaveLength(0);
    await startNewOutline();
    await drawTriangle(container);
    const outlines = callsOf(calls, 'setOutline');
    expect(outlines).toHaveLength(1);
    expect(outlines[0][1]).toHaveLength(3);
  });

  it('Remove takes the image away', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'floorplan', calls, floorplan: placement, image });
    expect(screen.getByLabelText('Floor plan reference image')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Floor plan reference image')).toBeNull();
    expect(calls).toEqual([['setPlacement', null, undefined]]);
  });

  it('renders the image in feet and in inches when those are the units', () => {
    const feet = mount({ units: 'feet', floorplan: placement, image });
    // 400 * 0.015 m = 6 m, shown in feet
    expect(parseFloat(screen.getByLabelText('Floor plan reference image').getAttribute('width')!)).toBeCloseTo(6 * FEET_PER_METER, 3);
    feet.unmount();
    mount({ units: 'inches', floorplan: placement, image });
    expect(parseFloat(screen.getByLabelText('Floor plan reference image').getAttribute('width')!)).toBeCloseTo(6 / 0.0254, 3);
  });

  it('offers every length unit and shows the converted outline after switching to centimeters', async () => {
    const calls: unknown[][] = [];
    const { ctl } = mount({ part: 'floorplan', calls });
    await fireEvent.click(screen.getByRole('button', { name: /Geometry/ }));
    const select = screen.getByLabelText('Units') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([...LENGTH_UNITS]);
    await fireEvent.change(select, { target: { value: 'centimeters' } });
    await tick();
    expect(calls).toContainEqual(['changeUnits', 'centimeters']);
    expect(ctl.draft[2][0]).toBe(600);
    expect(ctl.draft[2][1]).toBe(400);
  });

  it('shows the re-upload state when a placement has no image, and mounting changes nothing', () => {
    const calls: unknown[][] = [];
    mount({ part: 'floorplan', calls, floorplan: placement, image: null });
    expect(screen.getByText('Image missing')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('re-uploading the same-size image keeps the calibration and skips set-scale', async () => {
    const calls: unknown[][] = [];
    const calibrated = { imageId: 'img-old', widthPx: 400, heightPx: 200, scale: 0.0321, offsetX: 1.25, offsetY: -0.5, opacity: 0.6 };
    const { ctl } = mount({ calls, floorplan: calibrated, image: null });
    await ctl.onFileChosen(pngFile());
    await screen.findByLabelText('Floor plan reference image');
    // The decoder returns 400x200, the placement's size: no re-fit, no set-scale
    expect(ctl.tool).toBe('edit');
    expect(ctl.askSetScale).toBe(false);
    const [, kept, img] = callsOf(calls, 'setPlacement')[0] as [string, typeof calibrated, { id: string }];
    expect(kept.scale).toBe(calibrated.scale);
    expect(kept.offsetX).toBe(calibrated.offsetX);
    expect(kept.offsetY).toBe(calibrated.offsetY);
    expect(kept.imageId).toBe(img.id);
    expect(kept.imageId).not.toBe('img-old');
  });

  it('uploading while drawing leaves draw mode', async () => {
    const { container, ctl } = mount();
    await startNewOutline();
    expect(container.querySelector('svg.plan.drawing')).not.toBeNull();
    await ctl.onFileChosen(pngFile());
    await screen.findByLabelText('Floor plan reference image');
    expect(container.querySelector('svg.plan.drawing')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale now' }));
    expect(ctl.tool).toBe('custom');
    // Cancelling the drawing restored the outline that was there before
    expect(ctl.draft).toHaveLength(4);
  });

  it('two clicks and a distance rescale the image about the room origin', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mount({ calls, floorplan: placement, image });
    ctl.startSetScale();
    await calibrate(container);
    const [, scaled] = callsOf(calls, 'setPlacement').at(-1) as [string, typeof placement];
    expect(scaled.scale).not.toBeCloseTo(placement.scale, 6);
    expect(scaled.scale).toBeGreaterThan(0);
    expect(scaled.offsetX).toBeCloseTo(0, 9);
    expect(scaled.offsetY).toBeCloseTo(0, 9);
  });

  it('startSetScale again returns to the edit tool', () => {
    const { ctl } = mount({ floorplan: placement, image });
    ctl.startSetScale();
    expect(ctl.tool).toBe('custom');
    ctl.startSetScale();
    expect(ctl.tool).toBe('edit');
  });

  it('click selects the plan (highlight + position readout); a second press drags it; Escape deselects', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mount({ calls, floorplan: placement, image });
    const plan = stubPlan(container);
    const img = screen.getByLabelText('Floor plan reference image');
    expect(container.querySelector('.plan-outline')).toBeNull();
    await fireEvent.pointerDown(img, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    expect(container.querySelector('.plan-outline')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Floorplan position' })).toBeTruthy();
    expect(calls).toEqual([]);
    await fireEvent.pointerDown(img, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
    expect(calls).toEqual([]);
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    const moves = callsOf(calls, 'setPlacement');
    expect(moves).toHaveLength(1);
    const [, moved] = moves[0] as [string, typeof placement];
    expect(moved.offsetX).toBeGreaterThan(0);
    expect(moved.offsetY).toBeCloseTo(0, 6);
    expect(container.querySelectorAll('.plan-readout input').length).toBe(2);
    expect(ctl.onEscapeKey()).toBe(true);
    await tick();
    expect(container.querySelector('.plan-outline')).toBeNull();
  });

  it('changing units keeps an in-progress measurement, converting it to the new units', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mount({ calls, floorplan: placement, image });
    ctl.startSetScale();
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    await fireEvent.input(screen.getByLabelText('Measured distance'), { target: { value: '2' } });
    const line = container.querySelector('line.measure-line')!;
    const x1 = Number(line.getAttribute('x1'));
    const x2 = Number(line.getAttribute('x2'));
    await fireEvent.change(screen.getByLabelText('Distance units'), { target: { value: 'centimeters' } });
    expect(calls).toContainEqual(['changeUnits', 'centimeters']);
    expect((screen.getByLabelText('Measured distance') as HTMLInputElement).value).toBe('200');
    expect(ctl.tool).toBe('custom');
    const moved = container.querySelector('line.measure-line')!;
    expect(Number(moved.getAttribute('x1'))).toBeCloseTo(x1 * 100, 6);
    expect(Number(moved.getAttribute('x2'))).toBeCloseTo(x2 * 100, 6);
  });

  it('changing units keeps the same area on screen instead of refitting', async () => {
    const { container } = mount({ part: 'floorplan', vertices: [], floorplan: placement, image });
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    const before = plan.getAttribute('viewBox')!.split(' ').map(Number);
    await fireEvent.click(screen.getByRole('button', { name: /Geometry/ }));
    await fireEvent.change(screen.getByLabelText('Units'), { target: { value: 'centimeters' } });
    await tick();
    const after = plan.getAttribute('viewBox')!.split(' ').map(Number);
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i] * 100, 6));
  });

  it('draws each object footprint as a polygon, dashed when the object is disabled', () => {
    const objects = [
      { id: 'object-1', shape: 'box' as const, width: 1, length: 1, height: 1, x: 2, y: 3, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0, transmittance: 0, enabled: true },
      { id: 'object-2', shape: 'box' as const, width: 1, length: 1, height: 1, x: 1, y: 1, z: 0, yaw: 45, pitch: 0, roll: 0, reflectance: 0, transmittance: 0, enabled: false },
    ];
    const { container } = mount({ objects });
    const footprints = container.querySelectorAll('polygon.shape');
    expect(footprints).toHaveLength(2);
    expect(footprints[0].classList.contains('disabled')).toBe(false);
    expect(footprints[1].classList.contains('disabled')).toBe(true);
    expect(footprints[0].getAttribute('points')!.trim().split(' ')).toHaveLength(4);
  });

  describe('outline prompts', () => {
    it('Draw asks before clearing existing corners and keeps them on cancel', async () => {
      const { ctl } = mount();
      await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
      expect(screen.getByText('Start a new outline?')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      expect(ctl.draft).toHaveLength(4);
      expect(screen.queryByText('Start a new outline?')).toBeNull();
    });

    it('Draw starts drawing straight away when there are no corners', async () => {
      const { ctl } = mount({ vertices: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
      expect(screen.queryByText('Start a new outline?')).toBeNull();
      expect(ctl.drawing).toBe(true);
    });

    it('after the scale is set with no outline, offers to trace; Start tracing begins drawing', async () => {
      const { container, ctl } = mount({ vertices: [], floorplan: placement, image });
      ctl.startSetScale();
      await calibrate(container);
      expect(screen.getByText('Trace the room outline')).toBeTruthy();
      expect(screen.getByText(/at least three points/)).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Start tracing' }));
      expect(screen.queryByText('Trace the room outline')).toBeNull();
      expect(ctl.drawing).toBe(true);
    });

    it('the trace offer is not shown when an outline already exists', async () => {
      const { container, ctl } = mount({ floorplan: placement, image });
      ctl.startSetScale();
      await calibrate(container);
      expect(screen.queryByText('Trace the room outline')).toBeNull();
    });

    it('skipping the scale with no outline still prompts to trace', async () => {
      const { container, ctl } = mount({ vertices: [] });
      await ctl.onFileChosen(pngFile());
      await screen.findByText('Set the scale now?');
      await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
      expect(screen.getByText('Trace the room outline')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
      expect(screen.queryByText('Trace the room outline')).toBeNull();
      expect(container.querySelector('.rubber-band')).toBeNull();
    });
  });

  describe('obstacles', () => {
    const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };

    it('a drawn obstacle is added at once, full height, and selected', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, context: 'obstacles' });
      ctl.startObstacleDraw();
      await tick();
      await drawTriangle(container);
      await tick();
      const adds = callsOf(calls, 'addObstacle');
      expect(adds).toHaveLength(1);
      expect(adds[0][1]).toMatchObject({ shape: 'extrusion', name: 'Structure 1', z: 0, height: 2.7 });
      expect(ctl.selectedId).toBe('object-1');
    });

    it('moving an obstacle applies when the drag ends; Delete removes it', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, objects: [box], context: 'obstacles' });
      ctl.selectObstacle('object-9');
      await tick();
      const plan = stubPlan(container);
      const [x, y] = px(plan, 2, 2);
      await fireEvent.pointerDown(plan, { clientX: x, clientY: y, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x + 80, clientY: y, pointerId: 1 });
      expect(callsOf(calls, 'updateObstacle')).toHaveLength(0);
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const updates = callsOf(calls, 'updateObstacle');
      expect(updates).toHaveLength(1);
      expect(updates[0][1]).toBe('object-9');
      expect((updates[0][2] as { x: number }).x).toBeGreaterThan(2);
      await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(calls.at(-1)).toEqual(['removeObstacle', 'object-9']);
    });
  });
  describe('keyboard guards', () => {
    /** A modal dialog like Modal.svelte renders, outside the plan. */
    function openModal(): HTMLElement {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      const b = document.createElement('button');
      d.appendChild(b);
      document.body.appendChild(d);
      return d;
    }

    it('Delete does nothing to the selection while a modal dialog is open', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      ctl.selectLamp('lamp-7');
      await tick();
      const modal = openModal();
      try {
        await fireEvent.keyDown(window, { key: 'Delete' });
        await fireEvent.keyDown(modal.querySelector('button')!, { key: 'Delete' });
        await fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(callsOf(calls, 'removeLamp')).toHaveLength(0);
        expect(callsOf(calls, 'updateLamp')).toHaveLength(0);
      } finally {
        modal.remove();
      }
      // Control: with the dialog gone, Delete acts
      await fireEvent.keyDown(window, { key: 'Delete' });
      expect(callsOf(calls, 'removeLamp')).toHaveLength(1);
    });

    it('Ctrl+A inside a dialog leaves the lamp selection alone', async () => {
      const { ctl } = mount({ lamps: [lamp] as any, context: 'lamps' });
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const inner = document.createElement('div');
      inner.tabIndex = 0;
      dialog.appendChild(inner);
      document.body.appendChild(dialog);
      try {
        const notPrevented = await fireEvent.keyDown(inner, { key: 'a', ctrlKey: true });
        expect(notPrevented).toBe(true);
        expect(ctl.selectedLampIds).toEqual([]);
      } finally {
        dialog.remove();
      }
      await fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
      expect(ctl.selectedLampIds).toEqual(['lamp-7']);
    });

    it('Delete with focus in the results panel does nothing', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      ctl.selectLamp('lamp-7');
      await tick();
      const results = document.createElement('aside');
      results.className = 'results-panel';
      const btn = document.createElement('button');
      results.appendChild(btn);
      document.body.appendChild(results);
      try {
        await fireEvent.keyDown(btn, { key: 'Delete' });
        await fireEvent.keyDown(btn, { key: 'Backspace' });
        expect(callsOf(calls, 'removeLamp')).toHaveLength(0);
        expect(ctl.selectedLampIds).toEqual(['lamp-7']);
      } finally {
        results.remove();
      }
    });

    it('Space on a button outside the canvas is not prevented; over the canvas it still pans', async () => {
      const { container } = mount({ vertices: [] });
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        expect(await fireEvent.keyDown(outside, { key: ' ' })).toBe(true);
        // Not over the canvas: a page-level Space is not taken either
        expect(await fireEvent.keyDown(document.body, { key: ' ' })).toBe(true);
        await fireEvent.keyUp(window, { key: ' ' });
      } finally {
        outside.remove();
      }
      await fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
      const plan = stubPlan(container);
      await fireEvent.pointerEnter(plan);
      expect(await fireEvent.keyDown(document.body, { key: ' ' })).toBe(false);
      const before = plan.getAttribute('viewBox');
      await fireEvent.pointerDown(plan, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      await fireEvent.keyUp(window, { key: ' ' });
      expect(plan.getAttribute('viewBox')).not.toBe(before);
    });
  });

  describe('selection scrolls its row into view', () => {
    const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };

    it('a 2D lamp marker click reports the lamp', async () => {
      const onItemSelected = vi.fn();
      const { container } = mount({ lamps: [lamp] as any, context: 'lamps', onItemSelected });
      stubPlan(container);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp Beacon' }), { button: 0, pointerId: 1 });
      expect(onItemSelected).toHaveBeenCalledWith('lamp-7');
    });

    it('a 2D shape click reports the structure', async () => {
      const onItemSelected = vi.fn();
      const { ctl } = mount({ objects: [box], context: 'obstacles', onItemSelected });
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Desk' }), { button: 0, pointerId: 1 });
      expect(ctl.selectedId).toBe('object-9');
      expect(onItemSelected).toHaveBeenCalledWith('object-9');
    });

    it('a toolbar Copy reports the new item; an editor-row select does not', async () => {
      const onItemSelected = vi.fn();
      const { ctl } = mount({ lamps: [lamp] as any, context: 'lamps', onItemSelected });
      ctl.selectLamp('lamp-7');
      await tick();
      expect(onItemSelected).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await tick();
      expect(onItemSelected).toHaveBeenCalledWith(ctl.selectedLampIds[0]);
      expect(ctl.selectedLampIds[0]).not.toBe('lamp-7');
    });

    it('a structure Copy and a zone Copy report the copies', async () => {
      const onItemSelected = vi.fn();
      const obst = mount({ objects: [box], context: 'obstacles', onItemSelected });
      obst.ctl.selectObstacle('object-9');
      await tick();
      await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await tick();
      expect(onItemSelected).toHaveBeenLastCalledWith(obst.ctl.selectedId);
      expect(obst.ctl.selectedId).not.toBe('object-9');
      obst.unmount();
      onItemSelected.mockClear();
      const zone = { id: 'zone-9', name: 'Floor', type: 'plane' as const, ref_surface: 'xy' as const, enabled: true, height: 0, x1: 0, x2: 6, y1: 0, y2: 4, fit_room: true };
      const z = mount({ zones: [zone] as any, context: 'zones', onItemSelected });
      z.ctl.selectZone('zone-9');
      await tick();
      await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await tick();
      expect(onItemSelected).toHaveBeenLastCalledWith(z.ctl.selectedZoneId);
      expect(z.ctl.selectedZoneId).not.toBe('zone-9');
    });
  });

  describe('stale selection after undo', () => {
    it('Delete with a selected lamp that no longer exists sends nothing', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      ctl.selectedLampIds = ['lamp-gone'];
      await tick();
      await fireEvent.keyDown(window, { key: 'Delete' });
      ctl.deleteSelectedLamps();
      expect(callsOf(calls, 'removeLamp')).toHaveLength(0);
    });

    it('a zone selection that no longer exists deletes nothing', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, context: 'zones' });
      ctl.selectedZoneId = 'zone-gone';
      await tick();
      ctl.deleteSelectedZone();
      await fireEvent.keyDown(window, { key: 'Delete' });
      expect(callsOf(calls, 'removeZone')).toHaveLength(0);
    });
  });
  describe('refit on room size changes', () => {
    const vb = (c: HTMLElement) => c.querySelector('svg.plan')!.getAttribute('viewBox');

    it('a typed Width refits the view, even after a zoom', async () => {
      const { container } = mount({ part: 'floorplan' });
      await tick();
      const fitted = vb(container);
      await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(vb(container)).not.toBe(fitted);
      await fireEvent.click(screen.getByRole('button', { name: /Geometry/ }));
      const w = screen.getByLabelText('Width') as HTMLInputElement;
      w.value = '9';
      await fireEvent.change(w);
      await tick();
      await tick();
      expect(vb(container)).toBe(fitted);
    });

    it('a new stored outline refits while the user has not panned or zoomed', async () => {
      const { container, ctl } = mount();
      await tick();
      const size0 = Number(vb(container)!.split(' ')[2]);
      ctl.actions.setOutline([[0, 0], [12, 0], [12, 8], [0, 8]]);
      await tick();
      await tick();
      expect(Number(vb(container)!.split(' ')[2])).toBeGreaterThan(size0 * 1.5);
    });

    it('a new stored outline keeps the view once the user has zoomed', async () => {
      const { container, ctl } = mount();
      await tick();
      await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      const zoomed = vb(container);
      ctl.actions.setOutline([[0, 0], [12, 0], [12, 8], [0, 8]]);
      await tick();
      await tick();
      expect(vb(container)).toBe(zoomed);
    });
  });
});
