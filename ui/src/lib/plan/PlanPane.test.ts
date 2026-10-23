import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import { interceptUndo } from '$lib/utils/undoKeys';
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

  it('outline offers Move image once an image is loaded', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(Harness, { props: { ...baseProps, floorplan: placement, image } });
    expect(screen.getByRole('button', { name: 'Move image' })).toBeTruthy();
  });

  it('readonly shows no handles or toolbar and ignores drags', async () => {
    const calls: unknown[][] = [];
    const { container } = render(Harness, { props: { ...baseProps, calls, lamps: [lamp] as any, context: 'lamps', readonly: true } });
    expect(container.querySelector('.plan-toolbar')).toBeNull();
    expect(container.querySelectorAll('circle.vertex')).toHaveLength(0);
    expect(container.querySelectorAll('.mid-handle')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Lamp Beacon' })).toBeNull();
    const plan = stubPlan(container);
    await fireEvent.pointerDown(plan, { clientX: 100, clientY: 400, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 300, clientY: 300, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    await fireEvent.click(plan, { clientX: 200, clientY: 200 });
    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(calls).toHaveLength(0);
    // A read-only pane does not take over Ctrl+Z either
    expect(interceptUndo('undo')).toBe(false);
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
      // The host's shell (the modal today) routes Escape to the controller
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
      const axis = Array.from(svg.querySelectorAll('line.grid-line.axis')).find((l) => l.getAttribute('x1') !== l.getAttribute('x2'))!;
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
