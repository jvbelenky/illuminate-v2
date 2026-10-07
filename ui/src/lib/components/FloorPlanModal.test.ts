import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import FloorPlanModal from './test/FloorPlanModalHarness.svelte';
import { FEET_PER_METER, LENGTH_UNITS } from '$lib/utils/unitConversion';
import { interceptUndo } from '$lib/utils/undoKeys';

vi.mock('$lib/utils/floorplanDecode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/floorplanDecode')>();
  return {
    ...actual,
    decodeFloorPlanFile: vi.fn(async () => ({ mime: 'image/png', src: 'data:image/png;base64,AAAA', widthPx: 400, heightPx: 200 })),
  };
});

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const baseProps = { vertices: rect, units: 'meters' as const, precision: 1, onClose: vi.fn() };

/** The harness logs every action the plan takes; filter them by name. */
function callsOf(calls: unknown[][], name: string): unknown[][] {
  return calls.filter((c) => c[0] === name);
}

/** Give the plan canvas a real size in jsdom so clicks map to room coordinates. */
function stubPlan(container: HTMLElement): SVGSVGElement {
  const plan = container.querySelector('svg.plan') as SVGSVGElement;
  plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return plan;
}

/** Complete the Set scale step: two clicks and a typed distance. */
async function calibrate(container: HTMLElement, distance = '4') {
  const plan = stubPlan(container);
  await fireEvent.click(plan, { clientX: 100, clientY: 300 });
  await fireEvent.click(plan, { clientX: 300, clientY: 300 });
  const input = await screen.findByLabelText('Measured distance');
  await fireEvent.input(input, { target: { value: distance } });
  await fireEvent.keyDown(input, { key: 'Enter' });
}

/** Click "New outline", confirming the clear when corners are present. */
async function clickNewOutline() {
  await fireEvent.click(screen.getByRole('button', { name: 'New outline' }));
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

const DRAW_HINT = 'Esc cancels, Enter completes, Ctrl+Z removes the last corner';

describe('FloorPlanModal reference image', () => {
  it('labels each lamp dot with the lamp name, falling back to its id', () => {
    const lamp = (id: string, name?: string) => ({
      id, name, x: 1, y: 2, z: 2.5, aimx: 1, aimy: 2, aimz: 0, enabled: true,
    });
    const { container } = render(FloorPlanModal, {
      props: { ...baseProps, lamps: [lamp('lamp-1', 'Corner unit'), lamp('lamp-2')] as any },
    });
    const labels = Array.from(container.querySelectorAll('text.lamp-label')).map((t) => t.textContent);
    expect(labels).toEqual(['Corner unit', 'lamp-2']);
    expect(container.querySelectorAll('circle.lamp')).toHaveLength(2);
  });

  it('shows no image layer or reference panel by default', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    expect(container.querySelector('image.plan-image')).toBeNull();
    expect(container.querySelector('.reference-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /Upload floorplan/ })).toBeTruthy();
  });

  it('upload adds the image layer with an initial placement fitted to the room', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'plan.png', { type: 'image/png' });
    await fireEvent.change(input, { target: { files: [file] } });
    const img = await screen.findByLabelText('Floor plan reference image');
    // 400px long edge fitted to 6 m => width 6, height 3 (display units)
    expect(img.getAttribute('width')).toBe('6');
    expect(img.getAttribute('height')).toBe('3');
    expect(container.querySelector('.reference-panel')).not.toBeNull();
  });

  it('applies each finished edit at once: the upload, the calibration and a new outline', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    const [, uploaded, image] = callsOf(calls, 'setPlacement')[0] as [string, { widthPx: number; imageId: string }, { id: string; src: string }];
    expect(image.src).toBe('data:image/png;base64,AAAA');
    expect(uploaded.widthPx).toBe(400);
    expect(uploaded.imageId).toBe(image.id);
    // An outline is present, so the upload asks before touching it; Keep leaves it alone
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale now' }));
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(true);
    await calibrate(container);
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    expect(callsOf(calls, 'setPlacement')).toHaveLength(2);
    expect(callsOf(calls, 'setOutline')).toHaveLength(0);
    // Draw a new outline over it in whatever order suits
    await clickNewOutline();
    await drawTriangle(container);
    const outlines = callsOf(calls, 'setOutline');
    expect(outlines).toHaveLength(1);
    expect(outlines[0][1]).toHaveLength(3);
  });

  it('Remove takes the image away', async () => {
    const calls: unknown[][] = [];
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, calls, floorplan: placement, image } });
    expect(screen.getByLabelText('Floor plan reference image')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Floor plan reference image')).toBeNull();
    expect(calls).toEqual([['setPlacement', null, undefined]]);
  });

  it('renders the image in feet when units are feet', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, units: 'feet', floorplan: placement, image } });
    const img = screen.getByLabelText('Floor plan reference image');
    // 400 * 0.015 m = 6 m, shown in feet
    expect(parseFloat(img.getAttribute('width')!)).toBeCloseTo(6 * FEET_PER_METER, 3);
  });

  it('renders the image in inches when units are inches', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, units: 'inches', floorplan: placement, image } });
    const img = screen.getByLabelText('Floor plan reference image');
    // 400 * 0.015 m = 6 m = 236.22 in
    expect(parseFloat(img.getAttribute('width')!)).toBeCloseTo(6 / 0.0254, 3);
  });

  it('offers every length unit and shows the converted outline after switching to centimeters', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls } });
    const unitsSelect = container.querySelector('select.units-select') as HTMLSelectElement;
    expect(Array.from(unitsSelect.options).map((o) => o.value)).toEqual([...LENGTH_UNITS]);
    await fireEvent.change(unitsSelect, { target: { value: 'centimeters' } });
    await tick();
    expect(calls).toContainEqual(['changeUnits', 'centimeters']);
    // the 6 x 4 m rectangle comes back as 600 x 400 cm
    const rows = Array.from(container.querySelectorAll('.vertex-row'));
    const inputs = rows[2].querySelectorAll('input');
    expect(parseFloat((inputs[0] as HTMLInputElement).value)).toBe(600);
    expect(parseFloat((inputs[1] as HTMLInputElement).value)).toBe(400);
  });

  it('shows the re-upload state when a placement has no image', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image: null } });
    expect(screen.getByText(/upload it again to restore/i)).toBeTruthy();
  });

  it('opening and closing changes nothing, so a placement without its image is kept', async () => {
    const calls: unknown[][] = [];
    const onClose = vi.fn();
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    render(FloorPlanModal, { props: { ...baseProps, onClose, calls, floorplan: placement, image: null } });
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('re-uploading the same-size image keeps the calibration and skips set-scale', async () => {
    const calls: unknown[][] = [];
    // A restored project whose image could not be brought back: the placement is
    // calibrated, the image is gone, and the user re-uploads the same file.
    const placement = { imageId: 'img-old', widthPx: 400, heightPx: 200, scale: 0.0321, offsetX: 1.25, offsetY: -0.5, opacity: 0.6 };
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, floorplan: placement, image: null } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // The decoder returns 400x200, the placement's size, so no re-fit and no set-scale
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    expect(container.querySelector('.plan-hint')?.textContent).not.toMatch(/Click two points/);
    const [, kept, image] = callsOf(calls, 'setPlacement')[0] as [string, typeof placement, { id: string }];
    expect(kept.scale).toBe(placement.scale);
    expect(kept.offsetX).toBe(placement.offsetX);
    expect(kept.offsetY).toBe(placement.offsetY);
    expect(kept.imageId).toBe(image.id);
    expect(kept.imageId).not.toBe('img-old');
  });

  it('uploading while drawing leaves draw mode', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await clickNewOutline();
    expect(container.querySelector('svg.plan.drawing')).not.toBeNull();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // Draw mode and the image tools are mutually exclusive; the restored outline prompts Keep/Clear
    expect(container.querySelector('svg.plan.drawing')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale now' }));
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(true);
    // Cancelling the drawing restored the outline that was there before
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(container.querySelector('.plan-hint')?.textContent).toMatch(/Click two points/);
  });
});

describe('FloorPlanModal calibration', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('two clicks and a distance rescale the image about the room origin', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    // jsdom has no layout: stub the rect so clicks land on known room coordinates
    // (the view is fitted to the 6x4 room + image).
    await calibrate(container);
    const [, scaled] = callsOf(calls, 'setPlacement').at(-1) as [string, typeof placement];
    // The new scale must make the clicked span equal 4 m
    expect(scaled.scale).not.toBeCloseTo(placement.scale, 6);
    expect(scaled.scale).toBeGreaterThan(0);
    // The room origin stays fixed, so a plan anchored at (0,0) stays there and nothing goes negative
    expect(scaled.offsetX).toBeCloseTo(0, 9);
    expect(scaled.offsetY).toBeCloseTo(0, 9);
  });

  it('click selects the plan (highlight + position readout); a second press drags it; Escape deselects', async () => {
    const calls: unknown[][] = [];
    const onClose = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onClose, calls, floorplan: placement, image } });
    const plan = stubPlan(container);
    const img = screen.getByLabelText('Floor plan reference image');
    expect(container.querySelector('.plan-outline')).toBeNull();
    // First press selects without moving
    await fireEvent.pointerDown(img, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    expect(container.querySelector('.plan-outline')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Floorplan position' })).toBeTruthy();
    expect(calls).toEqual([]);
    // Now a drag moves it, applied once when it ends
    await fireEvent.pointerDown(img, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
    expect(calls).toEqual([]);
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    const moves = callsOf(calls, 'setPlacement');
    expect(moves).toHaveLength(1);
    const [, moved] = moves[0] as [string, typeof placement];
    expect(moved.offsetX).toBeGreaterThan(0);
    expect(moved.offsetY).toBeCloseTo(0, 6);
    // The side panel no longer carries X/Y rows; the readout does
    expect(container.querySelectorAll('.reference-panel input[type="text"]').length).toBe(0);
    expect(container.querySelectorAll('.plan-readout input').length).toBe(2);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.plan-outline')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('changing units keeps an in-progress measurement, converting it to the new units', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    const distance = screen.getByLabelText('Measured distance') as HTMLInputElement;
    await fireEvent.input(distance, { target: { value: '2' } });
    const line = container.querySelector('line.measure-line')!;
    const x1 = Number(line.getAttribute('x1'));
    const x2 = Number(line.getAttribute('x2'));
    // The popover has its own units menu, so the known length can be typed in any unit
    await fireEvent.change(screen.getByLabelText('Distance units'), { target: { value: 'centimeters' } });
    expect(calls).toContainEqual(['changeUnits', 'centimeters']);
    expect((screen.getByLabelText('Measured distance') as HTMLInputElement).value).toBe('200');
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(true);
    // The measured points are converted along with everything else
    const moved = container.querySelector('line.measure-line')!;
    expect(Number(moved.getAttribute('x1'))).toBeCloseTo(x1 * 100, 6);
    expect(Number(moved.getAttribute('x2'))).toBeCloseTo(x2 * 100, 6);
  });

  it('changing units keeps the same area on screen instead of refitting', async () => {
    // A fresh plan with no outline: a refit would fall back to a one-unit square
    const { container } = render(FloorPlanModal, { props: { ...baseProps, vertices: [], floorplan: placement, image } });
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    const before = plan.getAttribute('viewBox')!.split(' ').map(Number);
    const unitsSelect = container.querySelector('select.units-select') as HTMLSelectElement;
    await fireEvent.change(unitsSelect, { target: { value: 'centimeters' } });
    const after = plan.getAttribute('viewBox')!.split(' ').map(Number);
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i] * 100, 6));
  });
});

describe('FloorPlanModal after calibration', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
  it('the second scale click snaps to a right angle from the first when nearly straight', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    // 200 px right, 10 px up: ~2.9° off horizontal, snapped flat
    await fireEvent.click(plan, { clientX: 300, clientY: 290 });
    const line = container.querySelector('.measure-line')!;
    expect(parseFloat(line.getAttribute('y2')!)).toBeCloseTo(parseFloat(line.getAttribute('y1')!), 6);
  });

  it('clicking the active Set scale button returns to the edit tool', async () => {
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    const scale = screen.getByRole('button', { name: 'Set scale' });
    await fireEvent.click(scale);
    expect(scale.classList.contains('active')).toBe(true);
    await fireEvent.click(scale);
    expect(scale.classList.contains('active')).toBe(false);
  });

  it('walls snap to a right angle only when nearly straight; otherwise the angle is free', async () => {
    const draw = async (alt: boolean, dy: number) => {
      const { container, unmount } = render(FloorPlanModal, { props: baseProps });
      await clickNewOutline();
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      await fireEvent.pointerMove(plan, { clientX: 300, clientY: 400 - dy, altKey: alt });
      const label = container.querySelector('.angle-label')?.textContent ?? '';
      const dash = container.querySelector('.rubber-band')?.getAttribute('stroke-dasharray') ?? '';
      unmount();
      return { label, dash };
    };
    // 200 px right, 10 px up ≈ 2.9° off the axis: a slightly wobbly right angle, snapped
    expect((await draw(false, 10)).label).toBe('0°');
    // ≈ 5.7°: a deliberate slant, left alone (the window is 4°)
    expect((await draw(false, 20)).label).not.toBe('0°');
    // ≈ 21.8°: clearly not a right angle, left alone (no 45° snapping either)
    expect((await draw(false, 80)).label).not.toBe('0°');
    expect((await draw(false, 80)).label).not.toBe('45°');
    // Alt frees even a nearly straight wall
    expect((await draw(true, 10)).label).not.toBe('0°');
    // Dashes are sized in screen pixels, not room units
    const { dash } = await draw(false, 10);
    expect(dash).not.toBe('');
    expect(parseFloat(dash.split(/[ ,]+/)[0])).toBeLessThan(0.5);
  });
});

describe('FloorPlanModal toolbar signposting', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('offers New, Upload floorplan and Set scale, then undo and redo', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const labels = Array.from(container.querySelectorAll('.toolbar button.tool')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(labels).toEqual(['New outline', 'Upload floorplan…', 'Set scale', 'Undo', 'Redo']);
    expect(container.querySelector('.group-label')).toBeNull();
  });

  it('shows Set scale disabled until an image is loaded', () => {
    const { unmount } = render(FloorPlanModal, { props: baseProps });
    expect(screen.getByRole('button', { name: 'Set scale' })).toBeDisabled();
    unmount();
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    expect(screen.getByRole('button', { name: 'Set scale' })).toBeEnabled();
  });

  it('shows a next-step hint for every state', async () => {
    const { container, unmount } = render(FloorPlanModal, { props: baseProps });
    const hint = () => container.querySelector('.plan-hint')?.textContent ?? '';
    expect(hint()).toBe('');
    await clickNewOutline();
    expect(hint()).toBe(DRAW_HINT);
    unmount();
    const r = render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    const hint2 = () => r.container.querySelector('.plan-hint')?.textContent ?? '';
    expect(hint2()).toMatch(/Drag corners/);
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    expect(hint2()).toMatch(/Click two points/);
  });
});

describe('FloorPlanModal upload flow', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('upload offers Set scale and Escape dismisses it, leaving the outline alone', async () => {
    const onClose = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onClose } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale now' }));
    expect(container.querySelector('.plan-hint')?.textContent).toMatch(/Click two points/);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a restored image does not clear the outline; a confirmed scale returns to editing', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    await calibrate(container);
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
  });

  it('fits the view with the origin near the bottom-left corner, not centred', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const [x, y, size] = (container.querySelector('svg.plan')!.getAttribute('viewBox') ?? '').split(' ').map(Number);
    // 6 x 4 room: the window is just over 6 wide, starts a small margin left of x = 0,
    // and its bottom (SVG y is flipped) sits a small margin below y = 0
    expect(x).toBeLessThan(0);
    expect(x).toBeGreaterThan(-0.6);
    expect(-(y + size)).toBeGreaterThan(-0.6);
    expect(size).toBeLessThan(7);
  });

  it('placing a corner near the canvas edge does not change the zoom', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await clickNewOutline();
    const plan = stubPlan(container);
    const before = plan.getAttribute('viewBox');
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 556, clientY: 4 });
    expect(container.querySelectorAll('.vertex-row').length).toBe(2);
    expect(plan.getAttribute('viewBox')).toBe(before);
  });

  it('the cursor aligns with an existing corner and shows a guideline', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await clickNewOutline();
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 300, clientY: 400 });
    const firstX = (container.querySelectorAll('.vertex-row input')[0] as HTMLInputElement).value;
    // 7 px right of the first corner's x: grid snapping alone would give the next 0.1 step
    await fireEvent.pointerMove(plan, { clientX: 107, clientY: 250 });
    expect(container.querySelector('.cursor-label')?.textContent?.startsWith(firstX + ',')).toBe(true);
    expect(container.querySelectorAll('.guide').length).toBe(1);
    // Closing the outline clears the guideline
    await fireEvent.click(plan, { clientX: 107, clientY: 250 });
    await fireEvent.keyDown(plan, { key: 'Enter' });
    expect(container.querySelector('svg.plan.drawing')).toBeNull();
    expect(container.querySelectorAll('.guide').length).toBe(0);
  });

  it('the grid covers a canvas wider than it is tall', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const svg = container.querySelector('svg.plan')!;
    const [x, , size] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const axis = Array.from(svg.querySelectorAll('line.grid-line.axis')).find((l) => l.getAttribute('x1') !== l.getAttribute('x2'))!;
    // The x axis runs well past the right edge of a 2:1 canvas (x + 2 * size)
    expect(parseFloat(axis.getAttribute('x2')!)).toBeGreaterThan(x + 2 * size);
  });

  it('scrolling pans and Ctrl+scroll (pinch) zooms, in any mode', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await clickNewOutline();
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
    const { container } = render(FloorPlanModal, { props: baseProps });
    await clickNewOutline();
    const plan = stubPlan(container);
    const before = plan.getAttribute('viewBox');
    await fireEvent.keyDown(window, { key: ' ' });
    await fireEvent.pointerDown(plan, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    await fireEvent.click(plan, { clientX: 260, clientY: 200 });
    await fireEvent.keyUp(window, { key: ' ' });
    expect(plan.getAttribute('viewBox')).not.toBe(before);
    expect(container.querySelectorAll('.vertex-row').length).toBe(0);
  });

  it('grid snapping is light: a corner near a grid line lands on it, elsewhere it stays put', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, precision: 2 } });
    await clickNewOutline();
    const plan = stubPlan(container);
    // The 6 x 4 room fits a ~6.84-wide view starting at -0.42, so the x = 1 grid line
    // sits near px 116; 3 px to its right snaps (quietly, for a first corner), 24 px to its right is free
    await fireEvent.pointerMove(plan, { clientX: 119, clientY: 400 });
    expect(container.querySelectorAll('.guide').length).toBe(0);
    await fireEvent.click(plan, { clientX: 119, clientY: 400 });
    await fireEvent.click(plan, { clientX: 140, clientY: 300 });
    const xs = Array.from(container.querySelectorAll('.vertex-row')).map((r) => (r.querySelector('input') as HTMLInputElement).value);
    expect(xs[0]).toBe('1.00');
    expect(xs[1]).not.toBe('1.30');
    expect(parseFloat(xs[1])).toBeGreaterThan(1.2);
    expect(parseFloat(xs[1])).toBeLessThan(1.35);
  });

  it('snaps to whole units even when the visible grid is coarser, with a guideline after the first corner', async () => {
    // A 30 x 30 room makes the auto grid 5 units; whole units must still snap
    const big: [number, number][] = [[0, 0], [30, 0], [30, 30], [0, 30]];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, vertices: big, precision: 2 } });
    await clickNewOutline();
    const plan = stubPlan(container);
    // view ≈ 34.2 wide from -2.1: x = 7 sits near px 149; 2 px right of it
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.pointerMove(plan, { clientX: 151, clientY: 250 });
    expect(container.querySelectorAll('.guide').length).toBeGreaterThan(0);
    await fireEvent.click(plan, { clientX: 151, clientY: 250 });
    const x = (container.querySelectorAll('.vertex-row')[1].querySelector('input') as HTMLInputElement).value;
    expect(x).toBe('7.00');
  });

  it('uploading over an outline asks whether to clear it; Clear empties the corners (not yet applied), then Set scale opens', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    expect(screen.getByText('Clear the old outline?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Clear the old outline?')).toBeNull();
    expect(container.querySelectorAll('.vertex-row').length).toBe(0);
    // The stored outline stays until a new one is traced
    expect(callsOf(calls, 'setOutline')).toHaveLength(0);
    // Then it offers to set the scale; Later leaves the editor idle, Set scale now opens the tool
    expect(screen.getByText('Set the scale now?')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
  });
});

describe('FloorPlanModal object context', () => {
  it('draws each object footprint as a polygon, dashed when the object is disabled', () => {
    const objects = [
      { id: 'object-1', shape: 'box' as const, width: 1, length: 1, height: 1, x: 2, y: 3, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0, transmittance: 0, enabled: true },
      { id: 'object-2', shape: 'box' as const, width: 1, length: 1, height: 1, x: 1, y: 1, z: 0, yaw: 45, pitch: 0, roll: 0, reflectance: 0, transmittance: 0, enabled: false },
    ];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, objects } });
    // On the Outline step obstacles are dimmed host shapes; disabled ones are dashed
    const footprints = container.querySelectorAll('polygon.shape');
    expect(footprints).toHaveLength(2);
    expect(footprints[0].classList.contains('disabled')).toBe(false);
    expect(footprints[1].classList.contains('disabled')).toBe(true);
    // Four corners per box
    expect(footprints[0].getAttribute('points')!.trim().split(' ')).toHaveLength(4);
  });
});

describe('FloorPlanModal outline prompts', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('"New outline" asks before clearing existing corners and keeps them on cancel', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'New outline' }));
    expect(screen.getByText('Start a new outline?')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(screen.queryByText('Start a new outline?')).toBeNull();
  });

  it('"New outline" starts drawing straight away when there are no corners', async () => {
    render(FloorPlanModal, { props: { ...baseProps, vertices: [] } });
    await fireEvent.click(screen.getByRole('button', { name: 'New outline' }));
    expect(screen.queryByText('Start a new outline?')).toBeNull();
    expect(screen.getByText(DRAW_HINT)).toBeTruthy();
  });

  it('after the scale is set with no outline, offers to trace; Start tracing begins drawing', async () => {
    const { container } = render(FloorPlanModal, {
      props: { ...baseProps, vertices: [], floorplan: placement, image },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    await calibrate(container);
    expect(screen.getByText('Trace the room outline')).toBeTruthy();
    expect(screen.getByText(/at least three points/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Start tracing' }));
    expect(screen.queryByText('Trace the room outline')).toBeNull();
    expect(screen.getByText(DRAW_HINT)).toBeTruthy();
  });

  it('the trace offer is not shown when an outline already exists', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    await calibrate(container);
    expect(screen.queryByText('Trace the room outline')).toBeNull();
  });

  it('skipping the scale with no outline still prompts to trace', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, vertices: [] } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'plan.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    await fireEvent.change(input);
    await waitFor(() => expect(screen.queryByText('Set the scale now?')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByText('Trace the room outline')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Trace the room outline')).toBeNull();
    expect(container.querySelector('.rubber-band')).toBeNull();
  });
});

describe('FloorPlanModal applies as you go', () => {
  it('a corner drag applies once when it ends; an untouched outline is never re-applied', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls } });
    const plan = stubPlan(container);
    const handle = container.querySelectorAll('circle.vertex')[2] as SVGCircleElement;
    await fireEvent.pointerDown(handle, { clientX: 500, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 520, clientY: 180, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 540, clientY: 160, pointerId: 1 });
    expect(callsOf(calls, 'setOutline')).toHaveLength(0);
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    expect(callsOf(calls, 'setOutline')).toHaveLength(1);
    // A press and release without moving changes nothing
    const again = container.querySelectorAll('circle.vertex')[1] as SVGCircleElement;
    await fireEvent.pointerDown(again, { clientX: 500, clientY: 400, button: 0, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    expect(callsOf(calls, 'setOutline')).toHaveLength(1);
  });

  it('a corner typed into the table applies at once', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls } });
    const x = container.querySelectorAll('.vertex-row')[1].querySelector('input') as HTMLInputElement;
    await fireEvent.input(x, { target: { value: '7' } });
    await fireEvent.change(x, { target: { value: '7' } });
    await fireEvent.blur(x);
    const outlines = callsOf(calls, 'setOutline');
    expect(outlines).toHaveLength(1);
    expect((outlines[0][1] as number[][]).some(([vx]) => vx === 7)).toBe(true);
  });

  it('an invalid outline is shown but not applied, and Done offers to keep the saved one', async () => {
    const calls: unknown[][] = [];
    const onClose = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onClose, calls } });
    // Move corner 2 from (6, 0) up to (6, 6): its walls cross the far wall
    const y = container.querySelectorAll('.vertex-row')[1].querySelectorAll('input')[1] as HTMLInputElement;
    await fireEvent.change(y, { target: { value: '6' } });
    await fireEvent.blur(y);
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/);
    expect(callsOf(calls, 'setOutline')).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Outline not saved')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keep saved outline' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Z while drawing removes the last corner instead of undoing', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, vertices: [] } });
    await fireEvent.click(screen.getByRole('button', { name: 'New outline' }));
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 300, clientY: 400 });
    expect(container.querySelectorAll('.vertex-row').length).toBe(2);
    expect(interceptUndo('undo')).toBe(true);
    await tick();
    expect(container.querySelectorAll('.vertex-row').length).toBe(1);
    // Redo is never taken over
    expect(interceptUndo('redo')).toBe(false);
  });
});

describe('FloorPlanModal steps', () => {
  it('Next walks Outline, Obstacles, Lamps, Reflectance; Back returns; Done closes on the last step', async () => {
    const onClose = vi.fn();
    render(FloorPlanModal, { props: { ...baseProps, onClose } });
    const current = () => screen.getByRole('navigation', { name: 'Plan steps' }).querySelector('[aria-current="step"]')?.textContent;
    expect(current()).toMatch(/Outline/);
    await fireEvent.click(screen.getByRole('button', { name: 'Next: Obstacles' }));
    expect(current()).toMatch(/Obstacles/);
    // Nothing to add: Next skips on
    await fireEvent.click(screen.getByRole('button', { name: 'Next: Lamps' }));
    expect(current()).toMatch(/Lamps/);
    await fireEvent.click(screen.getByRole('button', { name: 'Next: Calc zones' }));
    expect(current()).toMatch(/Calc zones/);
    await fireEvent.click(screen.getByRole('button', { name: 'Next: Reflectance' }));
    expect(current()).toMatch(/Reflectance/);
    expect(screen.getByText('All surfaces')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(current()).toMatch(/Calc zones/);
    await fireEvent.click(screen.getByRole('button', { name: 'Next: Reflectance' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the step rail jumps to any step and keeps plain names', async () => {
    render(FloorPlanModal, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'Reflectance' }));
    expect(screen.getByText('All surfaces')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    expect(screen.getByRole('button', { name: 'New outline' })).toBeTruthy();
  });
});

describe('FloorPlanModal obstacles', () => {
  const box = { id: 'object-9', name: 'Desk', shape: 'box' as const, width: 1, length: 1, height: 0.75, x: 2, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, reflectance: 0.1, transmittance: 0, enabled: true };

  it('a drawn obstacle is added at once, full height, and selected', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, initialStep: 'obstacles', armDraw: true } });
    await tick();
    await drawTriangle(container);
    await tick();
    const adds = callsOf(calls, 'addObstacle');
    expect(adds).toHaveLength(1);
    expect(adds[0][1]).toMatchObject({ shape: 'extrusion', name: 'Obstacle 1', z: 0, height: 2.7 });
    expect(screen.getByRole('option', { name: /Obstacle 1/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('moving an obstacle applies when the drag ends; Delete removes it', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, objects: [box], initialStep: 'obstacles', initialObstacleId: 'object-9' } });
    await tick();
    const plan = stubPlan(container);
    // The 1 x 1 box centred at (2, 2): press inside it and drag right
    const [vx, vy, vsize] = plan.getAttribute('viewBox')!.split(' ').map(Number);
    const toPx = (x: number, y: number) => [((x - vx) / vsize) * 560, ((-y - vy) / vsize) * 560];
    const [px, py] = toPx(2, 2);
    await fireEvent.pointerDown(plan, { clientX: px, clientY: py, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: px + 80, clientY: py, pointerId: 1 });
    expect(callsOf(calls, 'updateObstacle')).toHaveLength(0);
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    const updates = callsOf(calls, 'updateObstacle');
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toBe('object-9');
    expect((updates[0][2] as { x: number }).x).toBeGreaterThan(2);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.at(-1)).toEqual(['removeObstacle', 'object-9']);
    expect(screen.getByText(/No obstacles yet/)).toBeTruthy();
  });

  it('property edits apply to the obstacle, with reflectance and transmittance together', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, objects: [box], initialStep: 'obstacles', initialObstacleId: 'object-9' } });
    await tick();
    const t = container.querySelector('#obstacle-transmittance') as HTMLInputElement;
    await fireEvent.change(t, { target: { value: '0.3' } });
    await fireEvent.blur(t);
    expect(calls).toContainEqual(['updateObstacle', 'object-9', { reflectance: 0.1, transmittance: 0.3 }]);
    const name = container.querySelector('#obstacle-name') as HTMLInputElement;
    await fireEvent.change(name, { target: { value: 'Bench' } });
    expect(calls).toContainEqual(['updateObstacle', 'object-9', { name: 'Bench' }]);
  });
});

describe('FloorPlanModal lamps', () => {
  const lamp = { id: 'lamp-7', name: 'Beacon', lamp_type: 'krcl_222' as const, preset_id: 'beacon', x: 2, y: 2, z: 2.5, aimx: 2, aimy: 2, aimz: 0, scaling_factor: 1, enabled: true };

  /** Pixel position of a room point on the stubbed 560 px canvas. */
  function px(plan: SVGSVGElement, x: number, y: number): [number, number] {
    const [vx, vy, vsize] = plan.getAttribute('viewBox')!.split(' ').map(Number);
    return [((x - vx) / vsize) * 560, ((-y - vy) / vsize) * 560];
  }

  it('Add lamp: a fixture reveals the placements; each placement adds a lamp placed automatically and selects it', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, initialStep: 'lamps' } });
    // No lamps: the ribbon's tools are greyed out; no placements until a fixture is chosen
    for (const name of ['Move', 'Aim', 'Copy', 'Delete']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('group', { name: 'Placement' })).toBeNull();
    await fireEvent.change(screen.getByLabelText('Fixture'), { target: { value: 'preset:ushio_b1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Corner' }));
    await tick();
    expect(callsOf(calls, 'addPlacedLamp')[0]).toEqual(['addPlacedLamp', 'preset:ushio_b1', 'corner']);
    expect(container.querySelector('.stub-lamp-panel')?.textContent).toMatch(/Lamp 1/);
    // Lamps exist: Move is on by default
    const move = screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement;
    expect(move.disabled).toBe(false);
    expect(move.classList.contains('active')).toBe(true);
    expect(container.querySelectorAll('circle.plan-lamp:not(.ghost)')).toHaveLength(1);
  });

  it('dragging a box on empty space selects the lamps inside; Shift-click adds one; Move drags them together', async () => {
    const calls: unknown[][] = [];
    const three = [
      { ...lamp, id: 'a', name: 'A', x: 1, y: 1, aimx: 1, aimy: 1 },
      { ...lamp, id: 'b', name: 'B', x: 2, y: 1, aimx: 2, aimy: 1 },
      { ...lamp, id: 'c', name: 'C', x: 5, y: 3, aimx: 5, aimy: 3 },
    ];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, lamps: three as any, initialStep: 'lamps' } });
    const plan = stubPlan(container);
    const [x0, y0] = px(plan, 0.5, 0.5);
    const [x1, y1] = px(plan, 2.5, 1.5);
    await fireEvent.pointerDown(plan, { clientX: x0, clientY: y0, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: x1, clientY: y1, pointerId: 1 });
    expect(container.querySelector('rect.marquee')).not.toBeNull();
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    expect(screen.getByText(/2 lamps selected\. Move/)).toBeTruthy();
    // Shift-click adds the third
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp C' }), { button: 0, pointerId: 1, shiftKey: true });
    expect(screen.getByText(/3 lamps selected\. Move/)).toBeTruthy();
    // Dragging one moves all three by the same amount, as one batch of updates
    const [ax, ay] = px(plan, 1, 1);
    const [bx] = px(plan, 1.5, 1);
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Lamp A' }), { clientX: ax, clientY: ay, button: 0, pointerId: 2 });
    await fireEvent.pointerMove(plan, { clientX: bx, clientY: ay, pointerId: 2 });
    await fireEvent.pointerUp(plan, { pointerId: 2 });
    const ups = Object.fromEntries((callsOf(calls, 'updateLamp') as [string, string, Record<string, number>][]).map((u) => [u[1], u[2]]));
    expect(ups.a.x).toBeCloseTo(1.5, 6);
    expect(ups.b.x).toBeCloseTo(2.5, 6);
    expect(ups.c.x).toBeCloseTo(5.5, 6);
    // A click on empty space clears the selection
    const [ex, ey] = px(plan, 4, 0.5);
    await fireEvent.pointerDown(plan, { clientX: ex, clientY: ey, button: 0, pointerId: 3 });
    await fireEvent.pointerUp(plan, { pointerId: 3 });
    expect(screen.queryByText(/lamps selected/)).toBeNull();
  });

  it('Aim points every selected lamp at where the drag ends', async () => {
    const calls: unknown[][] = [];
    const two = [
      { ...lamp, id: 'a', name: 'A', x: 1, y: 1, aimx: 1, aimy: 1 },
      { ...lamp, id: 'b', name: 'B', x: 2, y: 1, aimx: 2, aimy: 1 },
    ];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, lamps: two as any, initialStep: 'lamps' } });
    const plan = stubPlan(container);
    await fireEvent.click(screen.getByRole('button', { name: 'Aim' }));
    await fireEvent.click(within(screen.getByRole('listbox', { name: 'Lamps' })).getByRole('option', { name: /^A/ }));
    await fireEvent.click(within(screen.getByRole('listbox', { name: 'Lamps' })).getByRole('option', { name: /^B/ }), { shiftKey: true });
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
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, lamps: [{ ...lamp, aimx: 3 }] as any, initialStep: 'lamps' } });
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
    expect(container.querySelector('.stub-lamp-panel')?.textContent).toMatch(/Beacon/);
  });

  it('dragging the dot aims the lamp without moving it, and draws the aim line', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, lamps: [lamp] as any, initialStep: 'lamps' } });
    const plan = stubPlan(container);
    // Aimed straight down: no line yet, the dot sits inside the ring
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

  it('Delete removes the selected lamp; arrow keys nudge it with its aim', async () => {
    const calls: unknown[][] = [];
    render(FloorPlanModal, { props: { ...baseProps, calls, lamps: [lamp] as any, initialStep: 'lamps' } });
    await fireEvent.click(within(screen.getByRole('listbox', { name: 'Lamps' })).getByRole('option', { name: /Beacon/ }));
    await fireEvent.keyDown(window, { key: 'ArrowRight' });
    const [, , partial] = callsOf(calls, 'updateLamp')[0] as [string, string, Record<string, number>];
    expect(partial.x).toBeCloseTo(2.1, 6);
    expect(partial.aimx).toBeCloseTo(2.1, 6);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.at(-1)).toEqual(['removeLamp', 'lamp-7']);
    expect(within(screen.getByRole('listbox', { name: 'Lamps' })).queryByRole('option', { name: /Beacon/ })).toBeNull();
  });
});

describe('FloorPlanModal calc zones', () => {
  function px(plan: SVGSVGElement, x: number, y: number): [number, number] {
    const [vx, vy, vsize] = plan.getAttribute('viewBox')!.split(' ').map(Number);
    return [((x - vx) / vsize) * 560, ((-y - vy) / vsize) * 560];
  }
  const wholePlane = { id: 'zone-9', name: 'Floor', type: 'plane' as const, ref_surface: 'xy' as const, enabled: true, height: 0, x1: 0, x2: 6, y1: 0, y2: 4, fit_room: true };

  it('Draw plane adds a drawn (not whole-room) plane with its outline and selects it', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, initialStep: 'zones' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Draw plane' }));
    await drawTriangle(container);
    await tick();
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(type).toBe('plane');
    expect(geometry.fit_room).toBe(false);
    expect((geometry.vertices as unknown[]).length).toBe(3);
    expect(container.querySelector('.stub-zone-panel')?.textContent).toMatch(/Zone 1/);
  });

  it('Draw volume closes the same way and passes a footprint', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, initialStep: 'zones' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Draw volume' }));
    await drawTriangle(container);
    await tick();
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, unknown>];
    expect(type).toBe('volume');
    expect(geometry).toHaveProperty('x_min');
  });

  it('reshaping a whole-room plane makes it a drawn one', async () => {
    const calls: unknown[][] = [];
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, zones: [wholePlane] as any, initialStep: 'zones' } });
    await fireEvent.click(screen.getByRole('option', { name: /Floor/ }));
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
    const { container } = render(FloorPlanModal, { props: { ...baseProps, calls, initialStep: 'zones' } });
    const plan = stubPlan(container);
    await fireEvent.click(screen.getByRole('button', { name: 'Place point' }));
    const [ax, ay] = px(plan, 2, 2);
    await fireEvent.click(plan, { clientX: ax, clientY: ay });
    await tick();
    const [, type, geometry] = callsOf(calls, 'addZone')[0] as [string, string, Record<string, number>];
    expect(type).toBe('point');
    expect(geometry.x).toBeCloseTo(2, 6);
    expect(geometry.aim_x).toBeCloseTo(2, 6);
    await fireEvent.keyDown(window, { key: 'Escape' });
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
    render(FloorPlanModal, { props: { ...baseProps, calls, zones: [standard, wholePlane] as any, initialStep: 'zones' } });
    expect(screen.queryByRole('option', { name: /Whole room fluence/ })).toBeNull();
    await fireEvent.click(screen.getByRole('option', { name: /Floor/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.at(-1)).toEqual(['removeZone', 'zone-9']);
  });
});
