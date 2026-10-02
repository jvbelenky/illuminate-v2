import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FloorPlanModal from './FloorPlanModal.svelte';
import { FEET_PER_METER } from '$lib/utils/unitConversion';

vi.mock('$lib/utils/floorplanDecode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/floorplanDecode')>();
  return {
    ...actual,
    decodeFloorPlanFile: vi.fn(async () => ({ mime: 'image/png', src: 'data:image/png;base64,AAAA', widthPx: 400, heightPx: 200 })),
  };
});

const rect: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
const baseProps = { vertices: rect, units: 'meters' as const, precision: 1, onApply: vi.fn(), onClose: vi.fn() };

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

describe('FloorPlanModal reference image', () => {
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

  it('Apply hands back the outline, the placement and the image', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // The outline is untouched; upload offers Set scale, which a confirmed distance leaves
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(true);
    await calibrate(container);
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    // Draw a new outline over it in whatever order suits
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const plan = stubPlan(container);
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 400, clientY: 400 });
    await fireEvent.click(plan, { clientX: 400, clientY: 150 });
    await fireEvent.keyDown(plan, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const result = onApply.mock.calls[0][0];
    expect(result.vertices).toHaveLength(3);
    expect(result.image?.src).toBe('data:image/png;base64,AAAA');
    expect(result.floorplan?.widthPx).toBe(400);
    expect(result.floorplan?.imageId).toBe(result.image?.id);
  });

  it('Remove clears the draft image so Apply reports null', async () => {
    const onApply = vi.fn();
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    expect(screen.getByLabelText('Floor plan reference image')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Floor plan reference image')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply.mock.calls[0][0].floorplan).toBeNull();
    expect(onApply.mock.calls[0][0].image).toBeNull();
  });

  it('renders the image in feet when units are feet', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
    render(FloorPlanModal, { props: { ...baseProps, units: 'feet', floorplan: placement, image } });
    const img = screen.getByLabelText('Floor plan reference image');
    // 400 * 0.015 m = 6 m, shown in feet
    expect(parseFloat(img.getAttribute('width')!)).toBeCloseTo(6 * FEET_PER_METER, 3);
  });

  it('shows the re-upload state when a placement has no image', () => {
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image: null } });
    expect(screen.getByText(/upload it again to restore/i)).toBeTruthy();
  });

  it('Apply keeps a placement whose image could not be restored', async () => {
    const onApply = vi.fn();
    const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
    render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image: null } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // The calibration survives so a later re-upload of the same file restores it
    expect(onApply.mock.calls[0][0].floorplan).toEqual(placement);
    expect(onApply.mock.calls[0][0].image).toBeNull();
  });

  it('re-uploading the same-size image keeps the calibration and skips set-scale', async () => {
    const onApply = vi.fn();
    // A restored project whose image could not be brought back: the placement is
    // calibrated, the image is gone, and the user re-uploads the same file.
    const placement = { imageId: 'img-old', widthPx: 400, heightPx: 200, scale: 0.0321, offsetX: 1.25, offsetY: -0.5, opacity: 0.6 };
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image: null } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // The decoder returns 400x200, the placement's size, so no re-fit and no set-scale
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    expect(container.querySelector('.plan-hint')?.textContent).not.toMatch(/Click two points/);
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const result = onApply.mock.calls[0][0];
    expect(result.floorplan.scale).toBe(placement.scale);
    expect(result.floorplan.offsetX).toBe(placement.offsetX);
    expect(result.floorplan.offsetY).toBe(placement.offsetY);
    expect(result.image).not.toBeNull();
    expect(result.floorplan.imageId).toBe(result.image.id);
    expect(result.floorplan.imageId).not.toBe('img-old');
  });

  it('uploading while drawing leaves draw mode', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(container.querySelector('svg.plan.drawing')).not.toBeNull();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // Draw mode and the image tools are mutually exclusive
    expect(container.querySelector('svg.plan.drawing')).toBeNull();
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
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    // jsdom has no layout: the fallback maps a 0x0 rect; stub getBoundingClientRect
    // so clicks land on known room coordinates (view is fitted to the 6x4 room + image).
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    const distance = await screen.findByLabelText('Measured distance');
    await fireEvent.input(distance, { target: { value: '4' } });
    await fireEvent.keyDown(distance, { key: 'Enter' }); // the popover input handles Enter itself
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const result = onApply.mock.calls[0][0];
    // 200 screen px at 560px-per-view: the two clicks are view.size*200/560 apart in room units.
    // The new scale must make that span equal 4 m, so scale = 4 / (span / oldScale).
    expect(result.floorplan.scale).not.toBeCloseTo(placement.scale, 6);
    expect(result.floorplan.scale).toBeGreaterThan(0);
    // The room origin stays fixed, so a plan anchored at (0,0) stays there and nothing goes negative
    expect(result.floorplan.offsetX).toBeCloseTo(0, 9);
    expect(result.floorplan.offsetY).toBeCloseTo(0, 9);
  });

  it('dragging the corner handle moves the plan', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const handle = screen.getByLabelText('Move the floorplan');
    await fireEvent.pointerDown(handle, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 260, clientY: 200, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply.mock.calls[0][0].floorplan.offsetX).toBeGreaterThan(0);
    expect(onApply.mock.calls[0][0].floorplan.offsetY).toBeCloseTo(0, 6);
  });

  it('changing units discards an in-progress measurement instead of reinterpreting it', async () => {
    const onUnitsChange = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onUnitsChange, floorplan: placement, image } });
    const setScale = screen.getByRole('button', { name: 'Set scale' });
    await fireEvent.click(setScale);
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    expect(screen.getByLabelText('Measured distance')).toBeTruthy();
    // measure.a/b are in display units; a unit flip would silently rescale them
    const unitsSelect = container.querySelector('select.units-select') as HTMLSelectElement;
    await fireEvent.change(unitsSelect, { target: { value: 'feet' } });
    expect(onUnitsChange).toHaveBeenCalledWith('feet');
    expect(screen.queryByLabelText('Measured distance')).toBeNull();
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
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
    // 200 px right, 20 px up: ~5.7° off horizontal, snapped flat
    await fireEvent.click(plan, { clientX: 300, clientY: 280 });
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
      await fireEvent.click(screen.getByRole('button', { name: 'New' }));
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      await fireEvent.pointerMove(plan, { clientX: 300, clientY: 400 - dy, altKey: alt });
      const label = container.querySelector('.angle-label')?.textContent ?? '';
      const dash = container.querySelector('.rubber-band')?.getAttribute('stroke-dasharray') ?? '';
      unmount();
      return { label, dash };
    };
    // 200 px right, 20 px up ≈ 5.7° off the axis: a slightly wobbly right angle, snapped
    expect((await draw(false, 20)).label).toBe('0°');
    // ≈ 21.8°: clearly not a right angle, left alone (no 45° snapping either)
    expect((await draw(false, 80)).label).not.toBe('0°');
    expect((await draw(false, 80)).label).not.toBe('45°');
    // Alt frees even a nearly straight wall
    expect((await draw(true, 20)).label).not.toBe('0°');
    // Dashes are sized in screen pixels, not room units
    const { dash } = await draw(false, 20);
    expect(dash).not.toBe('');
    expect(parseFloat(dash.split(/[ ,]+/)[0])).toBeLessThan(0.5);
  });
});

describe('FloorPlanModal toolbar signposting', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('offers New, Upload floorplan and Set scale with no step numbers or captions', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const labels = Array.from(container.querySelectorAll('.toolbar button.tool')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['New', 'Upload floorplan…', 'Set scale']);
    expect(container.querySelector('.step')).toBeNull();
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
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(hint()).toMatch(/Click each corner/);
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
    const { container } = render(FloorPlanModal, { props: baseProps });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    expect(container.querySelector('.plan-hint')?.textContent).toMatch(/Click two points/);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Set scale' }).classList.contains('active')).toBe(false);
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(baseProps.onClose).not.toHaveBeenCalled();
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
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const plan = stubPlan(container);
    const before = plan.getAttribute('viewBox');
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 556, clientY: 4 });
    expect(container.querySelectorAll('.vertex-row').length).toBe(2);
    expect(plan.getAttribute('viewBox')).toBe(before);
  });

  it('the cursor aligns with an existing corner and shows a guideline', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
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
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
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
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
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
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const plan = stubPlan(container);
    // The 6 x 4 room fits a ~6.84-wide view starting at -0.42, so the x = 1 grid line
    // sits near px 116; 3 px to its right snaps (with a guideline), 24 px to its right is free
    await fireEvent.pointerMove(plan, { clientX: 119, clientY: 400 });
    expect(container.querySelectorAll('.guide').length).toBe(1);
    await fireEvent.click(plan, { clientX: 119, clientY: 400 });
    await fireEvent.click(plan, { clientX: 140, clientY: 300 });
    const xs = Array.from(container.querySelectorAll('.vertex-row')).map((r) => (r.querySelector('input') as HTMLInputElement).value);
    expect(xs[0]).toBe('1.00');
    expect(xs[1]).not.toBe('1.30');
    expect(parseFloat(xs[1])).toBeGreaterThan(1.2);
    expect(parseFloat(xs[1])).toBeLessThan(1.35);
  });
});
