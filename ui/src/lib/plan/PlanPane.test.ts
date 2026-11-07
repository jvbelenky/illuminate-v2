import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import { interceptUndo } from '$lib/utils/undoKeys';
import { FEET_PER_METER, LENGTH_UNITS } from '$lib/utils/unitConversion';
import { pickMode } from '$lib/stores/pickMode';
import { userSettings } from '$lib/stores/settings';
import type { PlanController } from './planController.svelte';

vi.mock('$lib/utils/floorplanDecode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/floorplanDecode')>();
  return {
    ...actual,
    decodeFloorPlanFile: vi.fn(async () => ({ mime: 'image/png', src: 'data:image/png;base64,AAAA', widthPx: 400, heightPx: 200 })),
  };
});

vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  const web = { vertices: [[0, 0, 0], [0.5, 0, -0.5], [0, 0.5, -0.5], [-0.5, 0, -0.5], [0, -0.5, -0.5]], triangles: [], aim_line: [], surface_points: [], fixture_bounds: null, color: '#cc61ff' };
  return { ...actual, getPhotometricWeb: vi.fn(async () => web), getSessionLampPhotometricWeb: vi.fn(async () => web) };
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

/** Click Draw new outline: it clears the corners and starts drawing straight away. */
async function startNewOutline() {
  await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
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

  it('projects each lamp\'s photometric web under the markers, unless its 2D web is off', async () => {
    const { container, unmount } = render(Harness, { props: { ...baseProps, lamps: [lamp] as any, context: 'lamps' } });
    await waitFor(() => expect(container.querySelector('.plan-web[data-lamp-id="lamp-7"] polygon')).not.toBeNull());
    const svg = container.querySelector('svg.plan')!;
    const all = Array.from(svg.querySelectorAll('*'));
    const web = container.querySelector('.plan-web')!;
    const marker = svg.querySelector('circle.plan-lamp')!;
    expect(all.indexOf(web)).toBeLessThan(all.indexOf(marker));
    unmount();
    const off = render(Harness, { props: { ...baseProps, lamps: [{ ...lamp, show_photometric_web_2d: false }] as any, context: 'lamps' } });
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(off.container.querySelector('.plan-web')).toBeNull();
    off.unmount();
  });

  it('draws a lamp name on the plan unless its 2D label is off', async () => {
    const { container, unmount } = render(Harness, { props: { ...baseProps, lamps: [lamp] as any, context: 'lamps' } });
    await tick();
    expect(container.querySelector('text.plan-lamp-label')?.textContent).toBe('Beacon');
    unmount();
    const off = render(Harness, { props: { ...baseProps, lamps: [{ ...lamp, show_label_2d: false }] as any, context: 'lamps' } });
    await tick();
    expect(off.container.querySelector('circle.plan-lamp')).not.toBeNull();
    expect(off.container.querySelector('text.plan-lamp-label')).toBeNull();
    off.unmount();
  });

  it("draws a zone's and a point's name on the plan unless its 2D label is off", async () => {
    const plane = { id: 'zone-1', name: 'Desk', type: 'plane', surface: 'floor', ref_surface: 'xy', height: 0.8, x1: 1, x2: 3, y1: 1, y2: 2, enabled: true };
    const point = { id: 'zone-2', name: 'Eye', type: 'point', x: 4, y: 3, z: 1.2, aim_x: 4, aim_y: 4, aim_z: 1.2, enabled: true };
    const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('text.plan-lamp-label')).map((t) => t.textContent);
    const on = mount({ zones: [plane, point] as any, context: 'zones' });
    await tick();
    expect(labels(on.container).sort()).toEqual(['Desk', 'Eye']);
    on.unmount();
    const off = mount({ zones: [{ ...plane, show_label_2d: false }, { ...point, show_label_2d: false }] as any, context: 'zones' });
    await tick();
    expect(labels(off.container)).toEqual([]);
    expect(off.container.querySelector('circle.plan-lamp.point')).not.toBeNull();
    off.unmount();
  });

  it('projects the web on a wall view for a lamp in front of it, and in the mini view', async () => {
    const { container, ctl, unmount } = mount({ lamps: [lamp], context: 'lamps' });
    ctl.setSurface('wall:0');
    await waitFor(() => expect(container.querySelector('.plan-web[data-lamp-id="lamp-7"] polygon')).not.toBeNull());
    unmount();
    const mini = render(Harness, { props: { ...baseProps, lamps: [lamp] as any, mini: true } });
    await waitFor(() => expect(mini.container.querySelector('.plan-web[data-lamp-id="lamp-7"] polygon')).not.toBeNull());
    mini.unmount();
  });

  it('shows the toolbar for the current context', () => {
    const labels = (container: HTMLElement) => Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.getAttribute('aria-label'));
    const { container, unmount } = render(Harness, { props: { ...baseProps, lamps: [lamp] as any, context: 'lamps' } });
    expect(container.querySelector('.plan-pane svg.plan')).not.toBeNull();
    expect(labels(container)).toEqual(['Move', 'Aim', 'Copy', 'Delete']);
    unmount();
    const out = render(Harness, { props: { ...baseProps, context: 'outline' } });
    expect(labels(out.container)).toEqual(['Edit vertices', 'Rotate 90°', 'Draw new outline']);
    out.unmount();
    // Structures and zones: nothing selected, no shape tools (their Add cards make them)
    const zones = render(Harness, { props: { ...baseProps, context: 'zones' } });
    expect(zones.container.querySelector('.plan-toolbar')).toBeNull();
    zones.unmount();
    const obst = render(Harness, { props: { ...baseProps, context: 'obstacles' } });
    expect(obst.container.querySelector('.plan-toolbar')).toBeNull();
    obst.unmount();
    const ceil = render(Harness, { props: { ...baseProps, context: 'ceiling' } });
    expect(labels(ceil.container)).toEqual(['Rectangle', 'Polygon', 'Move grid']);
    ceil.unmount();
    for (const context of ['reflectance', 'view'] as const) {
      const r = render(Harness, { props: { ...baseProps, context } });
      expect(r.container.querySelector('.plan-toolbar')).toBeNull();
      expect(r.container.querySelector('svg.plan')).not.toBeNull();
      r.unmount();
    }
  });

  it('a selected calc point has a lamp\'s tools: Move, Aim, Copy, Delete; Move and Aim arm (pressed) and drop; a wall view has no Aim', async () => {
    const pt = { id: 'p1', name: 'Eye', type: 'point' as const, enabled: true, x: 2, y: 1, z: 1.2, aim_x: 4, aim_y: 3, aim_z: 1.2 };
    const tools = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('.plan-toolbar button'));
    const { container, ctl } = mount({ zones: [pt] as any, context: 'zones' });
    ctl.selectZone('p1');
    await tick();
    expect(tools(container).map((b) => b.getAttribute('aria-label'))).toEqual(['Move', 'Aim', 'Copy', 'Delete']);
    expect(tools(container).every((b) => !b.disabled)).toBe(true);
    expect(tools(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', null, null]);
    await fireEvent.click(tools(container)[0]);
    expect(ctl.activeTool).toBe('move');
    expect(tools(container)[0].getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(tools(container)[1]);
    expect(ctl.activeTool).toBe('aim');
    expect(tools(container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', null, null]);
    await fireEvent.click(tools(container)[1]);
    expect(ctl.activeTool).toBeNull();
    // The point's ring and aim dot wear the selection cyan class
    expect(container.querySelector('circle.plan-lamp.point')!.classList.contains('selected')).toBe(true);
    expect(container.querySelector('circle.plan-aim.point')!.classList.contains('selected')).toBe(true);
    ctl.setSurface('wall:0');
    ctl.selectZone('p1');
    await tick();
    expect(tools(container).map((b) => b.getAttribute('aria-label'))).toEqual(['Move', 'Copy', 'Delete']);
    expect(container.querySelector('circle.plan-lamp.point.selected')).not.toBeNull();
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

  it('the outline strip has no Move image with an image loaded (Adjust image… places it)', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    const { container } = render(Harness, { props: { ...baseProps, floorplan: placement, image } });
    expect(screen.queryByRole('button', { name: 'Move image' })).toBeNull();
    expect(Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Edit vertices', 'Rotate 90°', 'Draw new outline']);
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
    expect(edit.container.querySelector('.transform-box')).not.toBeNull();
    expect(edit.container.querySelector('.plan-toolbar')).not.toBeNull();
    edit.unmount();
    const lampsEdit = render(Harness, { props });
    expect(screen.getByRole('button', { name: 'Lamp Beacon' })).toBeTruthy();
    expect(lampsEdit.container.querySelector('.plan-toolbar')).not.toBeNull();
  });

  it('mini renders no toolbar and no Hand/Zoom', async () => {
    const calls: unknown[][] = [];
    const { container } = render(Harness, { props: { ...baseProps, calls, lamps: [lamp] as any, context: 'lamps', mini: true } });
    expect(container.querySelector('.plan-pane svg.plan')).not.toBeNull();
    expect(container.querySelector('.plan-toolbar')).toBeNull();
    expect(container.querySelector('.view-controls')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hand' })).toBeNull();
    expect(container.querySelectorAll('circle.plan-lamp')).toHaveLength(0);
    // A drag pans the view; nothing is edited, and plan keys are left alone
    const plan = stubPlan(container);
    const before = plan.getAttribute('viewBox');
    await fireEvent.pointerDown(plan, { clientX: 100, clientY: 400, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 300, clientY: 300, pointerId: 1 });
    await fireEvent.pointerUp(plan, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(plan.getAttribute('viewBox')).not.toBe(before);
    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(calls).toHaveLength(0);
    // The wheel zooms (it would pan in Hand mode on the main view)
    const [, , size0] = plan.getAttribute('viewBox')!.split(' ').map(Number);
    await fireEvent.wheel(plan, { deltaY: 200, clientX: 280, clientY: 280 });
    const [, , size1] = plan.getAttribute('viewBox')!.split(' ').map(Number);
    expect(size1).not.toBeCloseTo(size0, 5);
  });

  it('mini follows the selection and the hovered row', async () => {
    const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };
    const zone = { id: 'zone-9', name: 'Floor', type: 'plane' as const, ref_surface: 'xy' as const, enabled: true, height: 0, x1: 1, x2: 3, y1: 1, y2: 2 };
    const lamp2 = { ...lamp, id: 'lamp-8', name: 'Other', x: 4 };
    const { container, ctl } = mount({ lamps: [lamp, lamp2] as any, objects: [box], zones: [zone] as any, context: 'lamps', mini: true });
    const lampDot = (i: number) => container.querySelectorAll('circle.lamp')[i] as SVGElement;
    expect(container.querySelectorAll('circle.lamp.selected')).toHaveLength(0);
    expect(container.querySelector('polygon.shape.selected')).toBeNull();
    expect(container.querySelector('polygon.ro-zone')).toBeNull();

    ctl.selectedLampIds = ['lamp-7'];
    ctl.hoverItem('lamps', 'lamp-8', true);
    await tick();
    expect(lampDot(0).classList.contains('selected')).toBe(true);
    expect(lampDot(1).classList.contains('highlighted')).toBe(true);
    expect(lampDot(1).classList.contains('selected')).toBe(false);

    ctl.selectedId = 'object-9';
    await tick();
    expect(container.querySelector('polygon.shape.selected')).not.toBeNull();
    ctl.selectedId = null;
    ctl.hoverItem('objects', 'object-9', true);
    await tick();
    expect(container.querySelector('polygon.shape.highlighted')).not.toBeNull();

    // A zone's footprint shows while it is selected or hovered
    ctl.selectedZoneId = 'zone-9';
    await tick();
    expect(container.querySelector('polygon.ro-zone.selected')).not.toBeNull();
    ctl.selectedZoneId = null;
    ctl.hoverItem('zones', 'zone-9', true);
    await tick();
    expect(container.querySelector('polygon.ro-zone.highlighted')).not.toBeNull();
    ctl.hoverItem('zones', 'zone-9', false);
    await tick();
    expect(container.querySelector('polygon.ro-zone')).toBeNull();
  });

  it('readonly renders no dialogs, even with a leave pending', async () => {
    const { ctl } = mount({ readonly: true });
    ctl.setVertexCoord(1, 1, 6);
    ctl.requestLeave(() => {});
    await tick();
    expect(ctl.pendingLeave).not.toBeNull();
    expect(screen.queryByText('Outline not saved')).toBeNull();
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

  describe('the outline canvas', () => {

    it('fits the view with the origin near the bottom-left corner, not centred', () => {
      const { container } = mount({});
      const [x, y, size] = (container.querySelector('svg.plan')!.getAttribute('viewBox') ?? '').split(' ').map(Number);
      expect(x).toBeLessThan(0);
      expect(x).toBeGreaterThan(-0.6);
      expect(-(y + size)).toBeGreaterThan(-1.2);
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
      await fireEvent.pointerMove(plan, { clientX: 105, clientY: 250 });
      expect(container.querySelector('.cursor-label')?.textContent?.startsWith(firstX + ',')).toBe(true);
      expect(container.querySelectorAll('.guide').length).toBe(1);
      await fireEvent.click(plan, { clientX: 105, clientY: 250 });
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

    it('F fits', async () => {
      const { container } = mount();
      const plan = stubPlan(container);
      await tick();
      const fitted = plan.getAttribute('viewBox');
      await fireEvent.wheel(plan, { deltaX: 0, deltaY: -300, ctrlKey: true, clientX: 100, clientY: 100 });
      const zoomed = plan.getAttribute('viewBox');
      expect(zoomed).not.toBe(fitted);
      // Not while typing, not with Ctrl (the browser's Find), not behind a dialog
      const input = document.createElement('input');
      container.querySelector('.plan-pane')!.appendChild(input);
      await fireEvent.keyDown(input, { key: 'f' });
      expect(plan.getAttribute('viewBox')).toBe(zoomed);
      input.remove();
      await fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      expect(plan.getAttribute('viewBox')).toBe(zoomed);
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      document.body.appendChild(dialog);
      await fireEvent.keyDown(window, { key: 'f' });
      expect(plan.getAttribute('viewBox')).toBe(zoomed);
      dialog.remove();
      await fireEvent.keyDown(window, { key: 'f' });
      expect(plan.getAttribute('viewBox')).toBe(fitted);
      await fireEvent.wheel(plan, { deltaX: 0, deltaY: -300, ctrlKey: true, clientX: 100, clientY: 100 });
      await fireEvent.keyDown(plan, { key: 'F', shiftKey: true });
      expect(plan.getAttribute('viewBox')).toBe(fitted);
    });

    it('Space+drag pans while drawing without placing a corner', async () => {
      const { container, ctl } = mount({ vertices: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
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
      expect(ctl.fmt(ctl.draft[1][0])).toBe('9.00');
    });
  });

  describe('drawing angles', () => {

    it('walls snap to a right angle only when nearly straight; otherwise the angle is free', async () => {
      const draw = async (alt: boolean, dy: number) => {
        const { container, unmount } = mount({ vertices: [] });
        await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
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

  describe('the room outline in its box', () => {
    const labels = (container: HTMLElement) => Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.getAttribute('aria-label'));
    const press = async (plan: SVGSVGElement, target: Element, from: [number, number], to: [number, number], opts: { shiftKey?: boolean; altKey?: boolean } = {}) => {
      const [x0, y0] = px(plan, ...from);
      const [x1, y1] = px(plan, ...to);
      await fireEvent.pointerDown(target, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1, ...opts });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      await tick();
    };
    const extents = (vs: number[][]) => [Math.min(...vs.map((p) => p[0])), Math.max(...vs.map((p) => p[0])), Math.min(...vs.map((p) => p[1])), Math.max(...vs.map((p) => p[1]))];

    it('shows its box, not its corners; the strip offers Edit vertices, Rotate 90° and Draw new outline (no Copy or Delete)', () => {
      const { container } = mount();
      expect(container.querySelector('.transform-box')).not.toBeNull();
      expect(container.querySelectorAll('circle.vertex')).toHaveLength(0);
      expect(container.querySelectorAll('.mid-handle')).toHaveLength(0);
      expect(labels(container)).toEqual(['Edit vertices', 'Rotate 90°', 'Draw new outline']);
    });

    it('dragging inside moves the room: one setOutline on release, lamps and structures left alone', async () => {
      const calls: unknown[][] = [];
      const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };
      const { container } = mount({ calls, lamps: [lamp] as any, objects: [box] });
      const plan = stubPlan(container);
      await press(plan, plan, [3, 2], [4, 3]);
      const outlines = callsOf(calls, 'setOutline');
      expect(outlines).toHaveLength(1);
      expect(extents(outlines[0][1] as number[][])).toEqual([1, 7, 1, 5]);
      expect(calls.filter((c) => c[0] !== 'setOutline')).toEqual([]);
    });

    it('a corner handle resizes about the opposite corner, Shift keeping the ratio', async () => {
      const calls: unknown[][] = [];
      const { container } = mount({ calls });
      const plan = stubPlan(container);
      await press(plan, screen.getByRole('button', { name: 'Resize top-right' }), [6, 4], [9, 4.2], { shiftKey: true });
      const outlines = callsOf(calls, 'setOutline');
      expect(outlines).toHaveLength(1);
      expect(extents(outlines[0][1] as number[][])).toEqual([0, 9, 0, 6]);
    });

    it('the rotate handle turns it a quarter about its centre (moved back to x, y >= 0)', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls });
      const plan = stubPlan(container);
      const knob = screen.getByRole('button', { name: 'Rotate' }).querySelector('circle.tb-knob')!;
      const k: [number, number] = [Number(knob.getAttribute('cx')), -Number(knob.getAttribute('cy'))];
      const c: [number, number] = [3, 2];
      await press(plan, screen.getByRole('button', { name: 'Rotate' }), k, [c[0] - (k[1] - c[1]), c[1]]);
      const outlines = callsOf(calls, 'setOutline');
      expect(outlines).toHaveLength(1);
      expect(extents(outlines[0][1] as number[][])).toEqual([1, 5, 0, 6]);
      expect(ctl.draftYaw).toBe(0);
    });

    it('a double click inside shows its corners; Done (or Esc) goes back to the box', async () => {
      const { container, ctl } = mount();
      const plan = stubPlan(container);
      const [x, y] = px(plan, 3, 2);
      for (let i = 0; i < 2; i++) {
        await fireEvent.pointerDown(plan, { clientX: x, clientY: y, button: 0, pointerId: 1 });
        await fireEvent.pointerUp(plan, { clientX: x, clientY: y, pointerId: 1 });
      }
      await fireEvent.dblClick(plan, { clientX: x, clientY: y });
      await tick();
      expect(ctl.shapeMode).toBe('corners');
      expect(container.querySelectorAll('circle.vertex')).toHaveLength(4);
      expect(container.querySelector('.transform-box')).toBeNull();
      expect(labels(container)).toEqual(['Done']);
      await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(ctl.shapeMode).toBe('select');
      expect(container.querySelector('.transform-box')).not.toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: 'Edit vertices' }));
      expect(ctl.shapeMode).toBe('corners');
      await fireEvent.keyDown(window, { key: 'Escape' });
      await tick();
      expect(ctl.shapeMode).toBe('select');
    });

    it('one finger inside the room pans the view (the room fills a phone); a mouse drag moves it', async () => {
      const calls: unknown[][] = [];
      const { container } = mount({ calls });
      const plan = stubPlan(container);
      const before = plan.getAttribute('viewBox');
      const [x, y] = px(plan, 3, 2);
      await fireEvent.pointerDown(plan, { clientX: x, clientY: y, button: 0, pointerId: 5, pointerType: 'touch' });
      await fireEvent.pointerMove(plan, { clientX: x + 60, clientY: y, pointerId: 5, pointerType: 'touch' });
      await fireEvent.pointerUp(plan, { clientX: x + 60, clientY: y, pointerId: 5, pointerType: 'touch' });
      expect(plan.getAttribute('viewBox')).not.toBe(before);
      expect(callsOf(calls, 'setOutline')).toHaveLength(0);
    });

    it('moving the room leaves the floor plan image where it is', async () => {
      const calls: unknown[][] = [];
      const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
      const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
      const { container, ctl } = mount({ calls, floorplan: placement, image });
      const plan = stubPlan(container);
      // A press on the image inside the room is the room's
      await press(plan, screen.getByLabelText('Floor plan reference image'), [2, 1], [3, 1]);
      expect(callsOf(calls, 'setOutline')).toHaveLength(1);
      expect(callsOf(calls, 'setPlacement')).toHaveLength(0);
      expect(ctl.planSelected).toBe(false);
    });
  });

  describe('applies as you go', () => {
    it('a corner drag applies once when it ends; an untouched outline is never re-applied', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls });
      ctl.editCorners();
      await tick();
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
      await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
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
    it('a plain drag on empty space follows the view mode (Hand pans) and draws no box', async () => {
      const three = [
        { ...lamp, id: 'a', name: 'A', x: 1, y: 1, aimx: 1, aimy: 1 },
        { ...lamp, id: 'b', name: 'B', x: 2, y: 1, aimx: 2, aimy: 1 },
      ];
      const { container, ctl } = mount({ lamps: three as any, context: 'lamps' });
      const plan = stubPlan(container);
      const before = plan.getAttribute('viewBox');
      const [x0, y0] = px(plan, 0.5, 0.5);
      const [x1, y1] = px(plan, 2.5, 1.5);
      await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1 });
      expect(container.querySelector('rect.marquee')).toBeNull();
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      expect(plan.getAttribute('viewBox')).not.toBe(before);
      expect(ctl.selectedLampIds).toHaveLength(0);
    });

    it('Shift-dragging a box on empty space selects the lamps inside; Shift-click adds one; Move drags them together', async () => {
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
      await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1, shiftKey: true });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1 });
      expect(container.querySelector('rect.marquee')).not.toBeNull();
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      expect([...ctl.selectedLampIds].sort()).toEqual(['a', 'b']);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp C' }), { button: 0, pointerId: 1, shiftKey: true });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
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
      expect(screen.getByRole('button', { name: 'Aim' }).getAttribute('aria-pressed')).toBe('true');
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
      await tick();
      expect(screen.getByRole('button', { name: 'Aim' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('Move is one-shot: a drag on empty space moves the selection, then the tool is off', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      const plan = stubPlan(container);
      ctl.selectLamp('lamp-7');
      await tick();
      const move = screen.getByRole('button', { name: 'Move' });
      expect(move.getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(move);
      expect(move.getAttribute('aria-pressed')).toBe('true');
      expect(plan.dataset.toolCursor).toBe('move');
      const [x0, y0] = px(plan, 4, 1);
      const [x1] = px(plan, 5, 1);
      await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y0, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const ups = callsOf(calls, 'updateLamp') as [string, string, Record<string, number>][];
      expect(ups).toHaveLength(1);
      expect(ups[0][2].x).toBeCloseTo(3, 6);
      await tick();
      expect(move.getAttribute('aria-pressed')).toBe('false');
      expect(plan.dataset.toolCursor).toBeUndefined();
      expect(ctl.selectedLampIds).toEqual(['lamp-7']);
    });

    it('dragging the ring moves the lamp alone (its aim point stays), applied once at the end', async () => {
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
      expect(partial).not.toHaveProperty('aimx');
      expect(partial.y).toBeCloseTo(2, 6);
      expect(ctl.selectedLampIds).toEqual(['lamp-7']);
    });

    it('a second finger during a touch drag of a lamp cancels it: nothing is applied, no undo step', async () => {
      const calls: unknown[][] = [];
      const two = [{ ...lamp, aimx: 3 }, { ...lamp, id: 'lamp-8', name: 'Other', x: 4, y: 3, aimx: 4, aimy: 3 }];
      const { container, ctl } = mount({ calls, lamps: two as any, context: 'lamps' });
      const plan = stubPlan(container);
      const t = (id: number, x: number, y: number, isPrimary = false) => ({ clientX: x, clientY: y, button: 0, pointerId: id, pointerType: 'touch', isPrimary });
      const [x0, y0] = px(plan, 2, 2);
      const [x1] = px(plan, 3, 2);
      const [ox, oy] = px(plan, 4, 3);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp Beacon' }), t(1, x0, y0, true));
      await fireEvent.pointerMove(plan, t(1, x1, y0));
      expect(ctl.markerDrag).not.toBeNull();
      // The second finger lands on the other lamp: the drag is dropped and that lamp is not taken
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp Other' }), t(2, ox, oy));
      expect(ctl.markerDrag).toBeNull();
      await fireEvent.pointerMove(plan, t(2, ox + 40, oy));
      await fireEvent.pointerMove(plan, t(1, x1 + 40, y0));
      await fireEvent.pointerUp(plan, t(2, ox + 40, oy));
      await fireEvent.pointerUp(plan, t(1, x1 + 40, y0));
      expect(callsOf(calls, 'updateLamp')).toHaveLength(0);
      expect(ctl.markerDrag).toBeNull();
      expect(ctl.selectedLampIds).toEqual(['lamp-7']);
    });

    it('a single-finger touch drag of a lamp still moves it', async () => {
      const calls: unknown[][] = [];
      const { container } = mount({ calls, lamps: [{ ...lamp, aimx: 3 }] as any, context: 'lamps' });
      const plan = stubPlan(container);
      const [x0, y0] = px(plan, 2, 2);
      const [x1] = px(plan, 3, 2);
      await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp Beacon' }), { clientX: x0, clientY: y0, button: 0, pointerId: 1, pointerType: 'touch', isPrimary: true });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y0, pointerId: 1, pointerType: 'touch' });
      await fireEvent.pointerUp(plan, { clientX: x1, clientY: y0, pointerId: 1, pointerType: 'touch' });
      const updates = callsOf(calls, 'updateLamp');
      expect(updates).toHaveLength(1);
      expect((updates[0][2] as Record<string, number>).x).toBeCloseTo(3, 6);
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

    it('the ribbon is greyed out with no lamps; with lamps no tool is on until chosen', () => {
      const none = render(Harness, { props: { ...baseProps, context: 'lamps' } });
      for (const name of ['Move', 'Aim', 'Copy', 'Delete']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
      none.unmount();
      render(Harness, { props: { ...baseProps, lamps: [lamp] as any, context: 'lamps' } });
      const move = screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement;
      expect(move.disabled).toBe(false);
      expect(move.getAttribute('aria-pressed')).toBe('false');
    });

    it('Delete removes the selected lamp; arrow keys nudge it, its aim point staying', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
      ctl.selectLamp('lamp-7');
      await tick();
      await fireEvent.keyDown(window, { key: 'ArrowRight' });
      const [, , partial] = callsOf(calls, 'updateLamp')[0] as [string, string, Record<string, number>];
      expect(partial.x).toBeCloseTo(2.1, 6);
      expect(partial).not.toHaveProperty('aimx');
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

    it('Draw with a plane or volume open redraws its outline instead of adding a zone', async () => {
      const volume = { id: 'zone-8', name: 'Vol', type: 'volume' as const, enabled: true, x_min: 0, x_max: 6, y_min: 0, y_max: 4, z_min: 0, z_max: 2.7, fit_room: true };
      for (const [zone, kind] of [[wholePlane, 'plane'], [volume, 'volume']] as const) {
        const calls: unknown[][] = [];
        const { container, ctl, unmount } = mount({ calls, zones: [zone] as any, context: 'zones' });
        ctl.selectZone(zone.id);
        await tick();
        ctl.startZoneDraw(kind);
        await drawTriangle(container);
        await tick();
        expect(callsOf(calls, 'addZone')).toHaveLength(0);
        const [, id, partial] = callsOf(calls, 'updateZone').at(-1) as [string, string, Record<string, unknown>];
        expect(id).toBe(zone.id);
        expect(partial.fit_room).toBe(false);
        expect((partial.vertices as unknown[]).length).toBe(3);
        unmount();
      }
    });

    it('Rotate 90° turns a plane; one the turn carries out of the room is cut to it', async () => {
      const small = { ...wholePlane, id: 'zone-3', x1: 1, x2: 3, y1: 1, y2: 2, fit_room: false };
      for (const [zone, want] of [[small, [1.5, 2.5, 0.5, 2.5]], [wholePlane, [1, 5, 0, 4]]] as const) {
        const calls: unknown[][] = [];
        const { ctl, unmount } = mount({ calls, zones: [zone] as any, context: 'zones' });
        ctl.selectZone(zone.id);
        await tick();
        ctl.rotateSelected90();
        const [, id, partial] = callsOf(calls, 'updateZone').at(-1) as [string, string, Record<string, unknown>];
        expect(id).toBe(zone.id);
        expect([partial.x1, partial.x2, partial.y1, partial.y2]).toEqual(want);
        expect(partial.fit_room).toBe(false);
        unmount();
      }
    });

    it("Redraw outline hides the plane's outline while drawing; Escape brings it back", async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, zones: [wholePlane] as any, context: 'zones' });
      ctl.selectZone('zone-9');
      await tick();
      ctl.startZoneDraw('plane');
      await tick();
      expect(ctl.drawing).toBe(true);
      expect(container.querySelector('polygon.plan-zone[aria-label="Zone Floor"]')).toBeNull();
      ctl.canvas?.cancelDraw();
      await tick();
      expect(ctl.drawing).toBe(false);
      expect(ctl.selectedZoneId).toBe('zone-9');
      expect(ctl.draft).toEqual([[0, 0], [6, 0], [6, 4], [0, 4]]);
      expect(callsOf(calls, 'updateZone')).toHaveLength(0);
    });

    it('reshaping a whole-room plane makes it a drawn one', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, zones: [wholePlane] as any, context: 'zones' });
      ctl.selectZone('zone-9');
      ctl.editCorners();
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

    it('a selected plane shows its box; Edit vertices in the strip shows its corners until Done', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, zones: [wholePlane] as any, context: 'zones' });
      const labels = () => Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.getAttribute('aria-label'));
      ctl.selectZone('zone-9');
      await tick();
      expect(labels()).toEqual(['Edit vertices', 'Rotate 90°', 'Copy', 'Delete']);
      expect(container.querySelector('.transform-box')).not.toBeNull();
      expect(container.querySelectorAll('circle.vertex')).toHaveLength(0);
      await fireEvent.click(screen.getByRole('button', { name: 'Edit vertices' }));
      expect(labels()).toEqual(['Done']);
      const done = screen.getByRole('button', { name: 'Done' });
      expect(done.getAttribute('aria-pressed')).toBe('true');
      expect(container.querySelector('.transform-box')).toBeNull();
      const plan = stubPlan(container);
      const handle = container.querySelectorAll('circle.vertex')[2] as SVGCircleElement;
      const [hx, hy] = px(plan, 6, 4);
      const [tx, ty] = px(plan, 5, 3);
      await fireEvent.pointerDown(handle, { clientX: hx, clientY: hy, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: tx, clientY: ty, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      await tick();
      expect(callsOf(calls, 'updateZone')).toHaveLength(1);
      // Still editing corners until Done
      expect(labels()).toEqual(['Done']);
      await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(labels()).toEqual(['Edit vertices', 'Rotate 90°', 'Copy', 'Delete']);
      expect(ctl.selectedZoneId).toBe('zone-9');
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

    const wallPlane = { id: 'zone-w', name: 'Wall A', type: 'plane' as const, enabled: true, surface: 'wall:1', fit_room: true, normal_offset: 0, flip: false };

    it('a wall plane is a line on the floor; clicking it opens its wall with the plane as the editable outline', async () => {
      const { container, ctl } = mount({ zones: [wallPlane] as any, context: 'zones' });
      const line = container.querySelector('line.wall-plane[aria-label="Zone Wall A"]') as SVGLineElement;
      expect(line).not.toBeNull();
      expect([line.getAttribute('x1'), line.getAttribute('x2')]).toEqual(['6', '6']);
      await fireEvent.pointerDown(line, { button: 0, pointerId: 1 });
      await tick();
      expect(ctl.surface).toBe('wall:1');
      expect(ctl.selectedZoneId).toBe('zone-w');
      expect(container.querySelector('.transform-box')).not.toBeNull();
      ctl.editCorners();
      await tick();
      expect(container.querySelectorAll('circle.vertex')).toHaveLength(4);
    });

    it("dragging a wall plane's corner in its wall view stores the outline in wall coordinates", async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, zones: [wallPlane] as any, context: 'zones' });
      ctl.selectZone('zone-w');
      await tick();
      ctl.editCorners();
      await tick();
      const plan = stubPlan(container);
      // Canvas (0, 2.7) is the wall's far top corner: along 4, up 2.7
      const handle = Array.from(container.querySelectorAll('circle.vertex')).find((c) => Number(c.getAttribute('cx')) === 0 && Math.abs(Number(c.getAttribute('cy')) + 2.7) < 1e-9) as SVGCircleElement;
      expect(handle).toBeTruthy();
      const [hx, hy] = px(plan, 0, 2.7);
      const [tx, ty] = px(plan, 1, 2);
      await fireEvent.pointerDown(handle, { clientX: hx, clientY: hy, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: tx, clientY: ty, pointerId: 1, altKey: true });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      const [, id, partial] = callsOf(calls, 'updateZone')[0] as [string, string, { wall_vertices: [number, number][]; fit_room: boolean }];
      expect(id).toBe('zone-w');
      expect(partial.fit_room).toBe(false);
      const moved = partial.wall_vertices.find(([a, u]) => Math.abs(a - 3) < 0.05 && Math.abs(u - 2) < 0.05);
      expect(moved).toBeTruthy();
      expect(partial.wall_vertices).toContainEqual([0, 0]);
    });

    it('Draw on a wall adds a plane on that wall', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, context: 'zones' });
      ctl.setSurface('wall:1');
      await tick();
      ctl.startShapeDraw('polygon');
      await tick();
      expect(screen.getByRole('button', { name: 'Polygon' }).getAttribute('aria-pressed')).toBe('true');
      await drawTriangle(container);
      await tick();
      const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
      expect(type).toBe('plane');
      expect(geometry).toMatchObject({ surface: 'wall:1', fit_room: false });
      expect((geometry.wall_vertices as unknown[]).length).toBe(3);
      expect(geometry).not.toHaveProperty('vertices');
    });

    it('Place on a wall view: a click sets the mirrored world position at the point depth', async () => {
      const calls: unknown[][] = [];
      const pt = { id: 'p1', name: 'Point', type: 'point' as const, enabled: true, x: 3, y: 1.2, z: 1, aim_x: 3, aim_y: 1.2, aim_z: 2 };
      const { container, ctl } = mount({ calls, zones: [pt] as any, context: 'zones' });
      ctl.setSurface('wall:1');
      ctl.selectZone('p1');
      await tick();
      pickMode.set({ type: 'point_position' });
      await tick();
      await tick();
      const plan = stubPlan(container);
      const [cx, cy] = px(plan, 1.5, 2);
      await fireEvent.pointerMove(plan, { clientX: cx, clientY: cy });
      expect(container.querySelector('circle.ghost')).toBeTruthy();
      await fireEvent.click(plan, { clientX: cx, clientY: cy, altKey: true });
      const [, id, partial] = callsOf(calls, 'updateZone')[0] as [string, string, { x: number; y: number; z: number }];
      expect(id).toBe('p1');
      expect(partial.x).toBeCloseTo(3, 1);
      expect(partial.y).toBeCloseTo(2.5, 1);
      expect(partial.z).toBeCloseTo(2, 1);
      pickMode.set(null);
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
describe('PlanPane reference image', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
  const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };

  it('labels each lamp dot with the lamp name, falling back to its id', () => {
    const named = (id: string, name?: string) => ({ ...lamp, id, name });
    const { container } = mount({ lamps: [named('lamp-1', 'Corner unit'), named('lamp-2')] as any });
    const labels = Array.from(container.querySelectorAll('text.lamp-label')).map((t) => t.textContent);
    expect(labels).toEqual(['Corner unit', 'lamp-2']);
    expect(container.querySelectorAll('circle.lamp')).toHaveLength(2);
  });

  it('Remove (once confirmed) takes the image away', async () => {
    const calls: unknown[][] = [];
    mount({ part: 'floorplan', calls, floorplan: placement, image });
    expect(screen.getByLabelText('Floor plan reference image')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove the floor plan file?' })).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Floor plan reference image')).toBeNull();
    expect(calls).toEqual([['setPlacement', null, undefined]]);
  });

  it('turns a rotated image about its centre, and Fit takes in its turned corners', () => {
    const { ctl } = mount({ floorplan: { ...placement, rotation: 10 }, image });
    // 400 x 200 px at 0.015 m: a 6 x 3 m rectangle centred on (3, 1.5); SVG y is flipped
    expect(screen.getByLabelText('Floor plan reference image').getAttribute('transform')).toBe('rotate(10 3 -1.5)');
    const xs = ctl.imageFitPoints.map((p) => p[0]);
    expect(ctl.imageFitPoints).toHaveLength(4);
    expect(Math.min(...xs)).toBeLessThan(0);
  });

  it('an unrotated image has no transform', () => {
    mount({ floorplan: placement, image });
    expect(screen.getByLabelText('Floor plan reference image').getAttribute('transform')).toBeNull();
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
    await fireEvent.click(screen.getByRole('button', { name: 'Vertices' }));
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
    expect(screen.getByText('File missing')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('click selects the plan (highlight + position readout); a second press drags it; Escape deselects', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mount({ calls, floorplan: placement, image });
    // Inside the room the outline's box takes presses; editing vertices, the image does
    ctl.editCorners();
    await tick();
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

  it('changing units keeps the same area on screen instead of refitting', async () => {
    const { container } = mount({ part: 'floorplan', vertices: [], floorplan: placement, image });
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    const before = plan.getAttribute('viewBox')!.split(' ').map(Number);
    await fireEvent.click(screen.getByRole('button', { name: 'Vertices' }));
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

  describe('Draw new outline', () => {
    it('Draw starts drawing at once with corners present, and cancelling restores them', async () => {
      const { ctl } = mount();
      await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(ctl.drawing).toBe(true);
      ctl.cancelDraw();
      expect(ctl.drawing).toBe(false);
      expect(ctl.draft).toHaveLength(4);
    });

    it('Draw starts drawing straight away when there are no corners', async () => {
      const { ctl } = mount({ vertices: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(ctl.drawing).toBe(true);
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

    it('a selected structure has a box: the rotate handle turns it a quarter, a corner handle widens it; one update each', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, objects: [box], context: 'obstacles' });
      ctl.selectObstacle('object-9');
      await tick();
      const plan = stubPlan(container);
      const labels = () => Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.getAttribute('aria-label'));
      expect(labels()).toEqual(['Edit vertices', 'Rotate 90°', 'Copy', 'Delete']);
      const move = async (target: Element, from: [number, number], to: [number, number], altKey = false) => {
        const [x0, y0] = px(plan, ...from);
        const [x1, y1] = px(plan, ...to);
        await fireEvent.pointerDown(target, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
        await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1, altKey });
        await fireEvent.pointerUp(plan, { pointerId: 1 });
        await tick();
      };
      // A corner handle: the top-right corner out by half a unit along x
      await move(screen.getByRole('button', { name: 'Resize top-right' }), [2.5, 2.5], [3, 2.5], true);
      let [, id, partial] = callsOf(calls, 'updateObstacle').at(-1) as [string, string, Record<string, number>];
      expect(id).toBe('object-9');
      expect(partial.width).toBeCloseTo(1.5, 6);
      expect(partial.length).toBeCloseTo(1, 6);
      expect(partial).not.toHaveProperty('shape');
      // The rotate handle, a quarter turn counter-clockwise about the box's centre
      const knob = screen.getByRole('button', { name: 'Rotate' }).querySelector('circle.tb-knob')!;
      const k: [number, number] = [Number(knob.getAttribute('cx')), -Number(knob.getAttribute('cy'))];
      const c: [number, number] = [2.25, 2];
      await move(screen.getByRole('button', { name: 'Rotate' }), k, [c[0] - (k[1] - c[1]), c[1]]);
      [, id, partial] = callsOf(calls, 'updateObstacle').at(-1) as [string, string, Record<string, number>];
      expect(partial.yaw).toBe(90);
      expect(partial.width).toBeCloseTo(1.5, 6);
      expect(callsOf(calls, 'updateObstacle')).toHaveLength(2);
      // Rotate 90° in the strip: a quarter more
      await fireEvent.click(screen.getByRole('button', { name: 'Rotate 90°' }));
      expect((callsOf(calls, 'updateObstacle').at(-1)![2] as Record<string, number>).yaw).toBe(180);
    });

    it('a press on an unselected structure selects it; dragging on from that press moves it, a click does not', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, objects: [box], context: 'obstacles' });
      const plan = stubPlan(container);
      const [x, y] = px(plan, 2, 2);
      // A click: selected, nothing moved
      await fireEvent.pointerDown(container.querySelector('polygon.shape')!, { clientX: x, clientY: y, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x + 2, clientY: y, pointerId: 1 });
      await fireEvent.pointerUp(plan, { clientX: x + 2, clientY: y, pointerId: 1 });
      await tick();
      expect(ctl.selectedId).toBe('object-9');
      expect(callsOf(calls, 'updateObstacle')).toHaveLength(0);
      // Deselect, then press and drag in one gesture
      ctl.selectObstacle(null);
      await tick();
      await fireEvent.pointerDown(container.querySelector('polygon.shape')!, { clientX: x, clientY: y, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x + 80, clientY: y, pointerId: 1 });
      await fireEvent.pointerUp(plan, { clientX: x + 80, clientY: y, pointerId: 1 });
      await tick();
      expect(ctl.selectedId).toBe('object-9');
      const updates = callsOf(calls, 'updateObstacle');
      expect(updates).toHaveLength(1);
      expect((updates[0][2] as { x: number }).x).toBeGreaterThan(2);
    });

    it('a double click on the selected structure shows its corners; Esc goes back to its box', async () => {
      const { container, ctl } = mount({ objects: [box], context: 'obstacles' });
      const plan = stubPlan(container);
      // The first press selects it through its shape, the second lands on its body
      const shape = container.querySelector('polygon.shape') as SVGPolygonElement;
      const [x, y] = px(plan, 2, 2);
      await fireEvent.pointerDown(shape, { clientX: x, clientY: y, button: 0, pointerId: 1 });
      await fireEvent.pointerUp(plan, { clientX: x, clientY: y, pointerId: 1 });
      await tick();
      expect(ctl.selectedId).toBe('object-9');
      expect(container.querySelector('.transform-box')).not.toBeNull();
      await fireEvent.pointerDown(plan, { clientX: x, clientY: y, button: 0, pointerId: 1 });
      await fireEvent.pointerUp(plan, { clientX: x, clientY: y, pointerId: 1 });
      await fireEvent.dblClick(plan, { clientX: x, clientY: y });
      await tick();
      expect(ctl.shapeMode).toBe('corners');
      expect(container.querySelectorAll('circle.vertex')).toHaveLength(4);
      expect(container.querySelector('.transform-box')).toBeNull();
      await fireEvent.keyDown(window, { key: 'Escape' });
      await tick();
      expect(ctl.shapeMode).toBe('select');
      expect(ctl.selectedId).toBe('object-9');
      expect(container.querySelector('.transform-box')).not.toBeNull();
    });

    it('Rectangle drags out a new structure, selected with its box', async () => {
      const calls: unknown[][] = [];
      const { container, ctl } = mount({ calls, context: 'obstacles' });
      const plan = stubPlan(container);
      ctl.startShapeDraw('rect');
      await tick();
      expect(screen.getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe('true');
      const [x0, y0] = px(plan, 1, 1);
      const [x1, y1] = px(plan, 3, 2);
      await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1 });
      expect(container.querySelector('rect.rect-draw')).not.toBeNull();
      await fireEvent.pointerUp(plan, { clientX: x1, clientY: y1, pointerId: 1 });
      await tick();
      await tick();
      const adds = callsOf(calls, 'addObstacle');
      expect(adds).toHaveLength(1);
      expect(adds[0][1]).toMatchObject({ width: 2, length: 1 });
      expect(ctl.selectedId).toBe('object-1');
      expect(ctl.shapeMode).toBe('select');
      expect(container.querySelector('.transform-box')).not.toBeNull();
    });

    it('the Delete key removes the selected structure', async () => {
      const calls: unknown[][] = [];
      const { ctl } = mount({ calls, objects: [box], context: 'obstacles' });
      ctl.selectObstacle('object-9');
      await tick();
      await fireEvent.keyDown(document.querySelector('[data-plan-scope]') as HTMLElement, { key: 'Delete' });
      expect(calls.at(-1)).toEqual(['removeObstacle', 'object-9']);
    });

    it("a structure's name always shows in 2D (Show label is for the 3D view)", () => {
      for (const context of ['obstacles', 'lamps'] as const) {
        const m = mount({ objects: [box], context });
        expect([...m.container.querySelectorAll('text.shape-label')].map((t) => t.textContent)).toEqual(['Desk']);
        m.unmount();
      }
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
      await fireEvent.click(screen.getByRole('button', { name: 'Draw new outline' }));
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
      await fireEvent.wheel(container.querySelector('svg.plan')!, { deltaY: -200, ctrlKey: true });
      expect(vb(container)).not.toBe(fitted);
      await fireEvent.click(screen.getByRole('button', { name: 'Vertices' }));
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
      await fireEvent.wheel(container.querySelector('svg.plan')!, { deltaY: -200, ctrlKey: true });
      const zoomed = vb(container);
      ctl.actions.setOutline([[0, 0], [12, 0], [12, 8], [0, 8]]);
      await tick();
      await tick();
      expect(vb(container)).toBe(zoomed);
    });
  });
});

describe('PlanPane ceiling context', () => {
  // A 10 × 8 ft room with 2 × 2 ft tiles from the bottom-left corner: tile centres at odd feet
  const room: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const detector = { id: 'ceiling-1', kind: 'smoke' as const, name: 'Hall detector', x: 3, y: 3 };
  const keep = { id: 'ceiling-2', kind: 'keep' as const, name: 'Duct', vertices: [[6, 4], [8, 4], [8, 6], [6, 6]] as [number, number][], yaw: 0 };
  const ceiling = { tileSize: '2x2' as const, align: 'bl' as const, offset: [0, 0] as [number, number], ceilingShown: true, tilesShown: true, itemsShown: true, items: [detector, keep] };
  const mountCeiling = (props: Record<string, unknown> = {}) => mount({ vertices: room, units: 'feet', context: 'ceiling', ceiling, ...props });

  /** Drag from one room point to another, pressing on `target` (default: the canvas). */
  async function drag(plan: SVGSVGElement, from: [number, number], to: [number, number], opts: { target?: Element; altKey?: boolean } = {}) {
    const [x0, y0] = px(plan, ...from);
    const [x1, y1] = px(plan, ...to);
    await fireEvent.pointerDown(opts.target ?? plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1, altKey: opts.altKey ?? false });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
  }

  it('draws the tile grid clipped to the room, and the items; structures are left out', () => {
    const L: [number, number][] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]];
    const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };
    const { container } = mountCeiling({ vertices: L, objects: [box] });
    const lines = Array.from(container.querySelectorAll('line.tile-line'));
    expect(lines.length).toBeGreaterThan(0);
    // x = 6 runs only through the lower arm
    const x6 = lines.filter((l) => l.getAttribute('x1') === '6');
    expect(x6.map((l) => [l.getAttribute('y1'), l.getAttribute('y2')])).toEqual([['0', '-4']]);
    expect(screen.getByRole('button', { name: 'Hall detector' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Duct' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desk' })).toBeNull();
  });

  it('dragging a detector snaps to a tile centre', async () => {
    const calls: unknown[][] = [];
    const onItemSelected = vi.fn();
    const { container, ctl } = mountCeiling({ calls, onItemSelected });
    const plan = stubPlan(container);
    await drag(plan, [3, 3], [6.4, 4.7], { target: screen.getByRole('button', { name: 'Hall detector' }) });
    expect(ctl.selectedCeilingId).toBe('ceiling-1');
    expect(onItemSelected).toHaveBeenCalledWith('ceiling-1');
    const ups = callsOf(calls, 'updateCeilingItem');
    expect(ups).toEqual([['updateCeilingItem', 'ceiling-1', { x: 7, y: 5 }]]);
  });

  it('Alt places freely', async () => {
    const calls: unknown[][] = [];
    const { container } = mountCeiling({ calls });
    const plan = stubPlan(container);
    await drag(plan, [3, 3], [6.4, 4.7], { target: screen.getByRole('button', { name: 'Hall detector' }), altKey: true });
    const [, id, partial] = callsOf(calls, 'updateCeilingItem')[0] as [string, string, { x: number; y: number }];
    expect(id).toBe('ceiling-1');
    expect(partial.x).toBeCloseTo(6.4, 1);
    expect(partial.y).toBeCloseTo(4.7, 1);
  });

  it('a detector cannot be dragged out of the room', async () => {
    const calls: unknown[][] = [];
    const { container } = mountCeiling({ calls });
    const plan = stubPlan(container);
    await drag(plan, [3, 3], [12.5, 3], { target: screen.getByRole('button', { name: 'Hall detector' }) });
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([]);
  });

  it('Move grid drags the grid', async () => {
    const calls: unknown[][] = [];
    const { container } = mountCeiling({ calls });
    const plan = stubPlan(container);
    const tool = screen.getByRole('button', { name: 'Move grid' });
    await fireEvent.click(tool);
    expect(tool.getAttribute('aria-pressed')).toBe('true');
    await drag(plan, [5, 5], [5.52, 4.49]);
    const [, partial] = callsOf(calls, 'updateCeiling')[0] as [string, { offset: [number, number] }];
    expect(partial.offset[0]).toBeCloseTo(0.5, 6);
    expect(partial.offset[1]).toBeCloseTo(-0.5, 6);
    // One-shot: the tool is off again, and the next drag navigates
    await tick();
    expect(tool.getAttribute('aria-pressed')).toBe('false');
    await drag(plan, [5, 5], [6, 6]);
    expect(callsOf(calls, 'updateCeiling')).toHaveLength(1);
  });

  it('Escape or a second click cancels Move grid without a change', async () => {
    const calls: unknown[][] = [];
    const { container } = mountCeiling({ calls });
    const plan = stubPlan(container);
    const tool = screen.getByRole('button', { name: 'Move grid' });
    await fireEvent.click(tool);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(tool.getAttribute('aria-pressed')).toBe('false');
    await drag(plan, [5, 5], [6, 6]);
    await fireEvent.click(tool);
    expect(tool.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(tool);
    expect(tool.getAttribute('aria-pressed')).toBe('false');
    await drag(plan, [5, 5], [6, 6]);
    expect(callsOf(calls, 'updateCeiling')).toEqual([]);
  });

  it('a tool sets the canvas cursor over Zoom mode until its gesture ends', async () => {
    userSettings.update((s) => ({ ...s, planNavMode: 'zoom' }));
    try {
      const { container } = mountCeiling();
      const plan = stubPlan(container);
      expect(plan.classList.contains('zoom-mode')).toBe(true);
      expect(plan.dataset.toolCursor).toBeUndefined();
      await fireEvent.click(screen.getByRole('button', { name: 'Move grid' }));
      expect(plan.dataset.toolCursor).toBe('move');
      const [x0, y0] = px(plan, 5, 5);
      const [x1, y1] = px(plan, 6, 6);
      await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1 });
      expect(plan.dataset.toolCursor).toBe('move');
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      expect(plan.dataset.toolCursor).toBeUndefined();
      expect(plan.classList.contains('zoom-mode')).toBe(true);
    } finally {
      userSettings.update((s) => ({ ...s, planNavMode: 'hand' }));
    }
  });

  it('Delete removes the selected item; Ctrl+D copies it; the toolbar has Copy and Delete', async () => {
    const calls: unknown[][] = [];
    const onItemSelected = vi.fn();
    const { container, ctl } = mountCeiling({ calls, onItemSelected });
    ctl.selectCeilingItem('ceiling-1');
    await tick();
    const labels = Array.from(container.querySelectorAll('.plan-toolbar button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Copy', 'Delete']);
    await fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(callsOf(calls, 'copyCeilingItem')).toEqual([['copyCeilingItem', 'ceiling-1']]);
    expect(ctl.selectedCeilingId).toBe('ceiling-3');
    expect(onItemSelected).toHaveBeenLastCalledWith('ceiling-3');
    await fireEvent.keyDown(window, { key: 'Delete' });
    expect(callsOf(calls, 'removeCeilingItem')).toEqual([['removeCeilingItem', 'ceiling-3']]);
    expect(ctl.selectedCeilingId).toBeNull();
  });

  it('a keep-out area edits like a structure footprint: drag the body', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mountCeiling({ calls });
    const plan = stubPlan(container);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Duct' }), { button: 0, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    expect(ctl.selectedCeilingId).toBe('ceiling-2');
    await tick();
    // The selected area is the canvas's draft, in select mode: its box with eight resize handles and a rotate handle
    expect(screen.getAllByRole('button', { name: /^Resize / })).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^Vertex \d$/ })).toHaveLength(0);
    await drag(plan, [7, 5], [8, 5]);
    const [, id, partial] = callsOf(calls, 'updateCeilingItem').at(-1) as [string, string, { vertices: [number, number][] }];
    expect(id).toBe('ceiling-2');
    const xs = partial.vertices.map((v) => v[0]);
    expect(Math.min(...xs)).toBeCloseTo(7, 6);
    expect(Math.max(...xs)).toBeCloseTo(9, 6);
    // Edit vertices: corners and "+" handles
    ctl.editCorners();
    await tick();
    expect(screen.getAllByRole('button', { name: /^Vertex \d$/ })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^Insert vertex/ })).toHaveLength(4);
  });

  it('a keep-out area turns with its rotate handle and resizes from a handle; each is one update with its yaw', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mountCeiling({ calls });
    const plan = stubPlan(container);
    ctl.selectCeilingItem('ceiling-2');
    await tick();
    // The rotate knob, dragged a quarter turn round the centre (7, 5)
    const knob = screen.getByRole('button', { name: 'Rotate' }).querySelector('circle.tb-knob')!;
    const k: [number, number] = [Number(knob.getAttribute('cx')), -Number(knob.getAttribute('cy'))];
    await drag(plan, k, [7 - (k[1] - 5), 5], { target: screen.getByRole('button', { name: 'Rotate' }) });
    let [, id, partial] = callsOf(calls, 'updateCeilingItem').at(-1) as [string, string, { vertices: [number, number][]; yaw: number }];
    expect(id).toBe('ceiling-2');
    expect(partial.yaw).toBe(90);
    const xs = partial.vertices.map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 6);
    await tick();
    // The right edge (now the box's own bottom, y going down) dragged out by half a unit
    const before = callsOf(calls, 'updateCeilingItem').length;
    const sq = screen.getByRole('button', { name: 'Resize top' }).querySelector('rect.tb-square')!;
    const h: [number, number] = [Number(sq.getAttribute('x')) + Number(sq.getAttribute('width')) / 2, -(Number(sq.getAttribute('y')) + Number(sq.getAttribute('height')) / 2)];
    await drag(plan, h, [h[0] - 0.5, h[1]], { target: screen.getByRole('button', { name: 'Resize top' }), altKey: true });
    expect(callsOf(calls, 'updateCeilingItem')).toHaveLength(before + 1);
    [, id, partial] = callsOf(calls, 'updateCeilingItem').at(-1) as [string, string, { vertices: [number, number][]; yaw: number }];
    expect(partial.yaw).toBe(90);
    const xs2 = partial.vertices.map((v) => v[0]);
    expect(Math.max(...xs2) - Math.min(...xs2)).toBeCloseTo(2.5, 6);
  });

  it('Shift+double-clicking a corner of a keep-out area removes it; double-clicking an edge types its length', async () => {
    const calls: unknown[][] = [];
    const five = { ...keep, vertices: [[6, 4], [8, 4], [8, 6], [7, 7], [6, 6]] as [number, number][] };
    const { container, ctl } = mountCeiling({ calls, ceiling: { ...ceiling, items: [detector, five] } });
    const plan = stubPlan(container);
    ctl.selectCeilingItem('ceiling-2');
    ctl.editCorners();
    await tick();
    await fireEvent.wheel(plan, { deltaY: -200, ctrlKey: true, clientX: 300, clientY: 300 });
    const zoomed = plan.getAttribute('viewBox');
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Vertex 4' }), { shiftKey: true });
    let partial = callsOf(calls, 'updateCeilingItem').at(-1)![2] as { vertices: [number, number][] };
    expect(partial.vertices).toHaveLength(4);
    const [ex, ey] = px(plan, 7, 4);
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Wall 1' }), { clientX: ex, clientY: ey });
    await tick();
    const input = screen.getByRole('textbox', { name: 'Wall 1 length' }) as HTMLInputElement;
    expect(input.value).toMatch(/^2(\.0+)?$/);
    await fireEvent.input(input, { target: { value: '1.5' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    partial = callsOf(calls, 'updateCeilingItem').at(-1)![2] as { vertices: [number, number][] };
    // The far corners follow the wall: still four corners, now 1.5 wide
    expect(partial.vertices).toHaveLength(4);
    expect(Math.max(...partial.vertices.map((v) => v[0])) - Math.min(...partial.vertices.map((v) => v[0]))).toBeCloseTo(1.5, 6);
    // Corner and edge double-clicks keep their meaning: neither fits the view
    expect(plan.getAttribute('viewBox')).toBe(zoomed);
    // A double-click on empty space fits
    await fireEvent.dblClick(plan, { clientX: 5, clientY: 5 });
    expect(plan.getAttribute('viewBox')).not.toBe(zoomed);
  });

  it('items stay in the room: a copy at a wall goes the other way; a nudge out of the room does nothing', async () => {
    const calls: unknown[][] = [];
    const atWall = { ...detector, x: 9, y: 3 };
    const { ctl } = mountCeiling({ calls, ceiling: { ...ceiling, items: [atWall, keep] } });
    ctl.selectCeilingItem('ceiling-1');
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    const copy = ctl.ceiling.items.find((i) => i.id === ctl.selectedCeilingId)!;
    expect(copy.kind === 'keep' ? null : [copy.x, copy.y]).toEqual([7, 3]);
    // Arrow keys move the original by the snap step, but never past the wall
    ctl.selectCeilingItem('ceiling-1');
    await tick();
    for (let i = 0; i < 6; i++) await fireEvent.keyDown(window, { key: 'ArrowRight' });
    const xs = (callsOf(calls, 'updateCeilingItem') as [string, string, { x: number }][]).map((c) => c[2].x);
    expect(xs).toEqual([9.25, 9.5, 9.75, 10]);
  });

  it('a keep-out area dragged out of the room snaps back', async () => {
    const calls: unknown[][] = [];
    const { container, ctl } = mountCeiling({ calls });
    const plan = stubPlan(container);
    ctl.selectCeilingItem('ceiling-2');
    await tick();
    await drag(plan, [7, 5], [10, 5]);
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([]);
    expect(ctl.draft.map((v) => v[0]).sort((a, b) => a - b)).toEqual([6, 6, 8, 8]);
    // A corner dragged past the wall snaps back too
    ctl.editCorners();
    await tick();
    await drag(plan, [8, 6], [12, 6], { target: screen.getByRole('button', { name: 'Vertex 3' }) });
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([]);
    // Inside the room it applies
    await drag(plan, [7, 5], [8, 5]);
    expect(callsOf(calls, 'updateCeilingItem')).toHaveLength(1);
  });

  it('a keep-out area left partly outside the room still edits, so it can be brought back in', async () => {
    const calls: unknown[][] = [];
    const stranded = { ...keep, vertices: [[8, 4], [12, 4], [12, 6], [8, 6]] as [number, number][] };
    const { container, ctl } = mountCeiling({ calls, ceiling: { ...ceiling, items: [detector, stranded] } });
    const plan = stubPlan(container);
    ctl.selectCeilingItem('ceiling-2');
    await tick();
    // Still partly outside after the move: applied
    await drag(plan, [9, 5], [8, 5]);
    let partial = callsOf(calls, 'updateCeilingItem').at(-1)![2] as { vertices: [number, number][] };
    expect(Math.max(...partial.vertices.map((v) => v[0]))).toBeCloseTo(11, 6);
    ctl.editCorners();
    await tick();
    // A corner pulled back to the wall: applied
    await drag(plan, [11, 4], [10, 4], { target: screen.getByRole('button', { name: 'Vertex 2' }) });
    expect(callsOf(calls, 'updateCeilingItem')).toHaveLength(2);
  });

  it('a point item left outside the room nudges back toward it, not farther out', async () => {
    const calls: unknown[][] = [];
    const out = { ...detector, x: 11, y: 3 };
    const { ctl } = mountCeiling({ calls, ceiling: { ...ceiling, items: [out, keep] } });
    ctl.selectCeilingItem('ceiling-1');
    await tick();
    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    await fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([]);
    await fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(callsOf(calls, 'updateCeilingItem')).toEqual([['updateCeilingItem', 'ceiling-1', { x: 10.75, y: 3 }]]);
  });

  it('a selected keep-out area is drawn in the selection colour; a hidden one has no handles', async () => {
    const { container, ctl, unmount } = mountCeiling();
    ctl.selectCeilingItem('ceiling-2');
    await tick();
    const outline = container.querySelector('polygon.outline')!;
    expect(outline.classList.contains('selected-area')).toBe(true);
    expect(outline.getAttribute('stroke-dasharray')).toBeTruthy();
    unmount();
    for (const hidden of [
      { items: [detector, { ...keep, hidden: true }] },
      { itemsShown: false },
      { ceilingShown: false },
    ]) {
      const m = mountCeiling({ ceiling: { ...ceiling, ...hidden } });
      m.ctl.selectCeilingItem('ceiling-2');
      await tick();
      expect(screen.queryAllByRole('button', { name: /^Vertex \d$/ })).toHaveLength(0);
      expect(m.container.querySelector('polygon.outline')).toBeNull();
      m.unmount();
    }
  });

  describe('surface switcher', () => {
    const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };
    it('one dropdown: Plan view, then each wall; choosing Wall 2 sets wall:1', async () => {
      const { ctl } = mount();
      const pick = screen.getByRole('combobox', { name: '2D view' }) as HTMLSelectElement;
      expect([...pick.options].map((o) => o.textContent)).toEqual(['Plan view', 'Wall 1', 'Wall 2', 'Wall 3', 'Wall 4']);
      expect(pick.value).toBe('floor');
      await fireEvent.change(pick, { target: { value: 'wall:1' } });
      expect(ctl.surface).toBe('wall:1');
      expect(pick.value).toBe('wall:1');
      await fireEvent.change(pick, { target: { value: 'floor' } });
      expect(ctl.surface).toBe('floor');
    });

    it('is hidden when mini', () => {
      mount({ mini: true });
      expect(screen.queryByRole('combobox', { name: '2D view' })).toBeNull();
    });

    it('wall view draws the wall outline and neighbour labels and no reference image', async () => {
      const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
      const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
      const near = { ...lamp, id: 'lamp-n', name: 'Near', x: 2, y: 1, z: 2.5 };
      const behind = { ...lamp, id: 'lamp-b', name: 'Behind', x: 2, y: -1, z: 2 };
      const box = { id: 'obj-1', name: 'Shelf', shape: 'box', x: 4, y: 2, z: 0.5, width: 1, length: 1, height: 1, yaw: 0, reflectance: 0.1, transmittance: 0, enabled: true };
      const { container, ctl } = mount({ floorplan: placement, image, lamps: [near, behind], objects: [box], roomZ: 3 });
      expect(container.querySelector('image.plan-image')).not.toBeNull();
      await fireEvent.change(screen.getByRole('combobox', { name: '2D view' }), { target: { value: 'wall:0' } });
      await tick();
      expect(ctl.surface).toBe('wall:0');
      // The elevation of wall 1 (6 long), up to the 3 m ceiling
      expect(container.querySelector('polygon.context-outline')!.getAttribute('points')).toBe('0,0 6,0 6,-3 0,-3');
      // Seen from inside: the next wall on the left, the previous one on the right
      expect(container.querySelector('.wall-neighbour.left')?.textContent).toBe('Wall 2');
      expect(container.querySelector('.wall-neighbour.right')?.textContent).toBe('Wall 4');
      expect(container.querySelector('image.plan-image')).toBeNull();
      // Nothing of the floor plan to edit: no corner handles
      expect(container.querySelectorAll('circle.vertex')).toHaveLength(0);
      expect(container.querySelectorAll('.mid-handle')).toHaveLength(0);
      // The lamp in front shows at (length - along, up), faded by its depth; the one behind does not
      const dots = container.querySelectorAll('circle.lamp');
      expect(dots).toHaveLength(1);
      expect(Number(dots[0].getAttribute('cx'))).toBeCloseTo(4);
      expect(Number(dots[0].getAttribute('cy'))).toBeCloseTo(-2.5);
      expect(Number((dots[0] as SVGElement).style.opacity)).toBeCloseTo(0.75);
      // The structure spans its along-range (mirrored) and its bottom and top
      const shelf = container.querySelector('polygon.shape') as SVGPolygonElement;
      const pts = shelf.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number));
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(1.5);
      expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(2.5);
      expect(Math.min(...pts.map((p) => -p[1]))).toBeCloseTo(0.5);
      expect(Math.max(...pts.map((p) => -p[1]))).toBeCloseTo(1.5);
      expect(Number(shelf.style.opacity)).toBeLessThan(1);
      // Back on the plan view, the plan is as before
      await fireEvent.change(screen.getByRole('combobox', { name: '2D view' }), { target: { value: 'floor' } });
      await tick();
      expect(container.querySelector('image.plan-image')).not.toBeNull();
      expect(container.querySelector('.transform-box')).not.toBeNull();
      expect(container.querySelector('.wall-neighbour')).toBeNull();
    });

    it('wall view ignores clicks and drags on the canvas', async () => {
      const calls: unknown[][] = [];
      const { container } = mount({ calls, lamps: [{ ...lamp, y: 1 }], context: 'lamps' });
      await fireEvent.change(screen.getByRole('combobox', { name: '2D view' }), { target: { value: 'wall:0' } });
      await tick();
      expect(container.querySelectorAll('circle.plan-lamp')).toHaveLength(0);
      expect(container.querySelector('.plan-toolbar')).toBeNull();
      const plan = stubPlan(container);
      await fireEvent.pointerDown(plan, { clientX: 100, clientY: 400, button: 0, pointerId: 1 });
      await fireEvent.pointerMove(plan, { clientX: 300, clientY: 300, pointerId: 1 });
      await fireEvent.pointerUp(plan, { pointerId: 1 });
      await fireEvent.click(plan, { clientX: 200, clientY: 200 });
      expect(calls).toHaveLength(0);
    });
  });
});

describe('PlanPane typing on the plan', () => {
  const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };
  const field = (name: string) => screen.queryByRole('textbox', { name }) as HTMLInputElement | null;

  it('double-click a lamp to type its X, Y and Z; the aim point stays', async () => {
    const calls: unknown[][] = [];
    mount({ calls, lamps: [lamp] as any, context: 'lamps' });
    await tick();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Lamp Beacon' }));
    await tick();
    const z = field('Beacon Z')!;
    expect(field('Beacon X')!.value).toBe('2.0');
    expect(field('Beacon Y')!.value).toBe('2.0');
    expect(z.value).toBe('2.5');
    await fireEvent.input(field('Beacon X')!, { target: { value: '2.5' } });
    await fireEvent.input(z, { target: { value: '300cm' } });
    await fireEvent.keyDown(z, { key: 'Enter' });
    expect(field('Beacon Z')).toBeNull();
    const [, id, partial] = callsOf(calls, 'updateLamp').at(-1) as [string, string, Record<string, number>];
    expect(id).toBe('lamp-7');
    expect(partial).toEqual({ x: 2.5, y: 2, z: 3 });
  });

  it('double-click a calc point (or its aim dot) to type its X, Y and Z; the aim point stays', async () => {
    const calls: unknown[][] = [];
    const pt = { id: 'p1', name: 'Eye', type: 'point' as const, enabled: true, x: 2, y: 1, z: 1.2, aim_x: 4, aim_y: 3, aim_z: 1.2 };
    mount({ calls, zones: [pt] as any, context: 'zones' });
    await tick();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Point Eye' }));
    await tick();
    expect(field('Eye X')!.value).toBe('2.0');
    expect(field('Eye Y')!.value).toBe('1.0');
    const z = field('Eye Z')!;
    expect(z.value).toBe('1.2');
    await fireEvent.input(field('Eye Y')!, { target: { value: '2' } });
    await fireEvent.input(z, { target: { value: '1.5' } });
    await fireEvent.keyDown(z, { key: 'Enter' });
    expect(field('Eye Z')).toBeNull();
    const [, id, partial] = callsOf(calls, 'updateZone').at(-1) as [string, string, Record<string, number>];
    expect(id).toBe('p1');
    expect(partial).toEqual({ x: 2, y: 2, z: 1.5 });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Aim of Eye' }));
    await tick();
    expect(field('Eye X')).not.toBeNull();
  });

  it('a bad lamp value stays open, invalid; Escape cancels', async () => {
    const calls: unknown[][] = [];
    mount({ calls, lamps: [lamp] as any, context: 'lamps' });
    await tick();
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Lamp Beacon' }));
    await tick();
    const x = field('Beacon X')!;
    await fireEvent.input(x, { target: { value: 'left' } });
    await fireEvent.keyDown(x, { key: 'Enter' });
    expect(x.classList.contains('invalid')).toBe(true);
    await fireEvent.keyDown(x, { key: 'Escape' });
    expect(field('Beacon X')).toBeNull();
    expect(callsOf(calls, 'updateLamp')).toHaveLength(0);
  });

  it("double-click a lamp's, a zone's or a structure's name label to rename it", async () => {
    const calls: unknown[][] = [];
    const { container, unmount } = mount({ calls, lamps: [lamp] as any, context: 'lamps' });
    await tick();
    await fireEvent.dblClick(container.querySelector('text.plan-lamp-label')!);
    await tick();
    const name = field('Name')!;
    expect(name.value).toBe('Beacon');
    await fireEvent.input(name, { target: { value: '' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(name.classList.contains('invalid')).toBe(true);
    await fireEvent.input(name, { target: { value: 'Front' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(callsOf(calls, 'updateLamp').at(-1)).toEqual(['updateLamp', 'lamp-7', { name: 'Front' }]);
    unmount();

    const zone = { id: 'zone-9', name: 'Desk plane', type: 'plane' as const, ref_surface: 'xy' as const, enabled: true, height: 0, x1: 1, x2: 3, y1: 1, y2: 2 };
    const zc: unknown[][] = [];
    const zones = mount({ calls: zc, zones: [zone] as any, context: 'zones' });
    await tick();
    await fireEvent.dblClick(zones.container.querySelector('text.plan-lamp-label')!);
    await tick();
    await fireEvent.input(field('Name')!, { target: { value: 'Bench' } });
    await fireEvent.keyDown(field('Name')!, { key: 'Enter' });
    expect(callsOf(zc, 'updateZone').at(-1)).toEqual(['updateZone', 'zone-9', { name: 'Bench' }]);
    zones.unmount();

    const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };
    const oc: unknown[][] = [];
    const obst = mount({ calls: oc, objects: [box], context: 'obstacles' });
    await tick();
    await fireEvent.dblClick(obst.container.querySelector('text.shape-label')!);
    await tick();
    await fireEvent.input(field('Name')!, { target: { value: 'Table' } });
    await fireEvent.keyDown(field('Name')!, { key: 'Enter' });
    expect(callsOf(oc, 'updateObstacle').at(-1)).toEqual(['updateObstacle', 'object-9', { name: 'Table' }]);
    obst.unmount();
  });
});

describe('PlanPane view options (one setting for 2D and 3D)', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
  const svgOf = (c: HTMLElement) => c.querySelector('svg.plan')!;

  it('Show Grid: the 3D grid, cell and section lines in the 3D colours, faded with distance; off, none', async () => {
    const on = mount();
    await tick();
    const svg = svgOf(on.container);
    const cells = svg.querySelectorAll('line.grid-line:not(.major)');
    const sections = svg.querySelectorAll('line.grid-line.major');
    expect(cells.length).toBeGreaterThan(0);
    expect(sections.length).toBeGreaterThan(0);
    // Sections on multiples of 5 m
    for (const l of sections) {
      const v = l.getAttribute('x1') === l.getAttribute('x2') ? Number(l.getAttribute('x1')) : -Number(l.getAttribute('y1'));
      expect(Math.abs(v / 5 - Math.round(v / 5))).toBeLessThan(1e-6);
    }
    expect(['#4a4a6a', '#b0b0b0']).toContain(cells[0].getAttribute('stroke'));
    expect(['#6a6a8a', '#909090']).toContain(sections[0].getAttribute('stroke'));
    expect(svg.querySelector('g.view-grid')?.getAttribute('mask')).toMatch(/^url\(#plan-grid-fade-/);
    on.unmount();
    const off = mount({ room: { showGrid: false } });
    await tick();
    expect(svgOf(off.container).querySelector('line.grid-line')).toBeNull();
    off.unmount();
  });

  it('the plan draws no dimension rulers and no XYZ marker, whatever the View menu says', async () => {
    const on = mount({ room: { showDimensions: true, showXYZMarker: true } });
    await tick();
    const svg = svgOf(on.container);
    expect(svg.querySelector('.rulers, text.ruler-label, g.xyz-marker')).toBeNull();
    on.unmount();
    const { container, ctl } = mount({ room: { showDimensions: true, showXYZMarker: true } });
    ctl.setSurface('wall:0');
    await tick();
    expect(svgOf(container).querySelector('.rulers, text.ruler-label, g.xyz-marker')).toBeNull();
  });

  it('Show Floor Plan Image: off hides it on the plan, except where the Floorplan part edits it', async () => {
    const lampsCtx = mount({ floorplan: placement, image, context: 'lamps', room: { showFloorPlanImage: false } });
    await tick();
    expect(lampsCtx.container.querySelector('image.plan-image')).toBeNull();
    lampsCtx.unmount();
    const outline = mount({ floorplan: placement, image, room: { showFloorPlanImage: false } });
    await tick();
    expect(outline.container.querySelector('image.plan-image')).not.toBeNull();
    outline.unmount();
    const ro = mount({ floorplan: placement, image, readonly: true, room: { showFloorPlanImage: false } });
    await tick();
    expect(ro.container.querySelector('image.plan-image')).toBeNull();
    ro.unmount();
    const shown = mount({ floorplan: placement, image, context: 'lamps' });
    await tick();
    expect(shown.container.querySelector('image.plan-image')).not.toBeNull();
    shown.unmount();
  });

  it('items hidden with their eye are left out of the plan, as in 3D', async () => {
    const lamp = { id: 'lamp-1', name: 'Beacon', lamp_type: 'krcl_222' as const, x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };
    const lamp2 = { ...lamp, id: 'lamp-2', name: 'Other', x: 4 };
    const plane = { id: 'zone-1', name: 'Desk', type: 'plane', surface: 'floor', ref_surface: 'xy', height: 0.8, x1: 1, x2: 3, y1: 1, y2: 2, enabled: true };
    const point = { id: 'zone-2', name: 'Eye', type: 'point', x: 4, y: 3, z: 1.2, aim_x: 4, aim_y: 4, aim_z: 1.2, enabled: true };
    const hidden = { lamps: ['lamp-1'], zones: ['zone-1', 'zone-2'], objects: [] };
    const lamps = mount({ lamps: [lamp, lamp2] as any, context: 'lamps', hidden });
    await tick();
    expect(Array.from(lamps.container.querySelectorAll('circle.plan-lamp')).map((c) => c.getAttribute('aria-label'))).toEqual(['Lamp Other']);
    lamps.unmount();
    const zones = mount({ zones: [plane, point] as any, context: 'zones', hidden });
    await tick();
    expect(zones.container.querySelector('polygon.plan-zone')).toBeNull();
    expect(zones.container.querySelector('circle.plan-lamp.point')).toBeNull();
    zones.unmount();
    // The room context draws the lamps for context: hidden ones are left out, and a 2D label off hides the name
    const room = mount({ lamps: [lamp, { ...lamp2, show_label_2d: false }] as any, hidden });
    await tick();
    expect(room.container.querySelectorAll('circle.lamp').length).toBe(1);
    expect(room.container.querySelector('text.lamp-label')).toBeNull();
    room.unmount();
  });
});
