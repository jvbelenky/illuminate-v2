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

describe('FloorPlanModal reference image', () => {
  it('shows no image layer or reference panel by default', () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    expect(container.querySelector('image.plan-image')).toBeNull();
    expect(screen.queryByText('Reference image')).toBeNull();
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
    expect(screen.getByText('Reference image')).toBeTruthy();
  });

  it('Apply hands back the outline, the placement and the image', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // A new upload starts a new room: the old outline is gone and Apply waits for a traced one
    expect(container.querySelectorAll('.vertex-row').length).toBe(0);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    // Skipping set-scale drops straight into drawing
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('button', { name: 'Finish outline' })).toBeTruthy();
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(plan, { clientX: 100, clientY: 400 });
    await fireEvent.click(plan, { clientX: 400, clientY: 400 });
    await fireEvent.click(plan, { clientX: 400, clientY: 150 });
    await fireEvent.click(screen.getByRole('button', { name: 'Finish outline' }));
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
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
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
    await fireEvent.click(screen.getByRole('button', { name: 'Draw outline' }));
    expect(screen.getByRole('button', { name: 'Cancel drawing' })).toBeTruthy();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    // Draw mode and the image tools are mutually exclusive
    expect(screen.queryByRole('button', { name: 'Cancel drawing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    // The upload started a new room, so the outline is cleared until it is traced
    expect(container.querySelectorAll('.vertex-row').length).toBe(0);
    expect(container.querySelector('.plan-notice')?.textContent).toMatch(/plan\.png/);
  });
});

describe('FloorPlanModal calibration', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('two clicks and a distance rescale the image about the measured midpoint', async () => {
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
  });

  it('Move plan drags the image offset', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Move plan' }));
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const img = screen.getByLabelText('Floor plan reference image');
    await fireEvent.pointerDown(img, { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
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

  it('Snap toggle turns grid snapping off for drawing', async () => {
    render(FloorPlanModal, { props: baseProps });
    const snap = screen.getByRole('button', { name: /Snap/ });
    expect(snap.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(snap);
    expect(snap.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('FloorPlanModal after calibration', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };
  const stubPlan = (container: HTMLElement) => {
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    return plan;
  };

  it('corners stay draggable while the Move plan tool is active', async () => {
    const onApply = vi.fn();
    const { container } = render(FloorPlanModal, { props: { ...baseProps, onApply, floorplan: placement, image } });
    await fireEvent.click(screen.getByRole('button', { name: 'Move plan' }));
    const plan = stubPlan(container);
    const corner = container.querySelectorAll('circle.vertex')[1];
    await fireEvent.pointerDown(corner, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    await fireEvent.pointerMove(plan, { clientX: 360, clientY: 300, pointerId: 1 });
    await fireEvent.pointerUp(plan, { pointerId: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const vertices = onApply.mock.calls[0][0].vertices as [number, number][];
    expect(vertices.some(([x, y]) => x === 6 && y === 0)).toBe(false);
  });

  it('clicking the active Move plan or Set scale button returns to the edit tool', async () => {
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    const move = screen.getByRole('button', { name: 'Move plan' });
    await fireEvent.click(move);
    expect(move.classList.contains('active')).toBe(true);
    await fireEvent.click(move);
    expect(move.classList.contains('active')).toBe(false);
    const scale = screen.getByRole('button', { name: 'Set scale' });
    await fireEvent.click(scale);
    expect(scale.classList.contains('active')).toBe(true);
    await fireEvent.click(scale);
    expect(scale.classList.contains('active')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('Snap off frees the wall angle while drawing; Snap on keeps the 45° steps', async () => {
    const draw = async (snapOff: boolean) => {
      const { container, unmount } = render(FloorPlanModal, { props: baseProps });
      if (snapOff) await fireEvent.click(screen.getByRole('button', { name: 'Snap' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Draw outline' }));
      const plan = stubPlan(container);
      await fireEvent.click(plan, { clientX: 100, clientY: 400 });
      // 200 px right and 10 px up: about 2.9° above the x axis, inside the 5° snap tolerance
      await fireEvent.pointerMove(plan, { clientX: 300, clientY: 390 });
      const label = container.querySelector('.angle-label')?.textContent ?? '';
      unmount();
      return label;
    };
    expect(await draw(false)).toBe('0°');
    expect(await draw(true)).not.toBe('0°');
  });
});

describe('FloorPlanModal toolbar signposting', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('groups the tools under Outline and Floorplan captions and numbers the floorplan steps', () => {
    render(FloorPlanModal, { props: baseProps });
    expect(screen.getByRole('group', { name: 'Outline' })).toBeTruthy();
    const floorplan = screen.getByRole('group', { name: 'Floorplan' });
    expect(floorplan.querySelectorAll('.step').length).toBe(3);
    // Step badges must not leak into the accessible names
    expect(screen.getByRole('button', { name: 'Set scale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upload floorplan/ })).toBeTruthy();
  });

  it('shows Set scale and Move plan disabled until an image is loaded', () => {
    const { unmount } = render(FloorPlanModal, { props: baseProps });
    expect(screen.getByRole('button', { name: 'Set scale' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move plan' })).toBeDisabled();
    unmount();
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    expect(screen.getByRole('button', { name: 'Set scale' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move plan' })).toBeEnabled();
  });

  it('shows a next-step hint for every state', async () => {
    const { container, unmount } = render(FloorPlanModal, { props: baseProps });
    const hint = () => container.querySelector('.plan-hint')?.textContent ?? '';
    expect(hint()).toMatch(/Upload a floorplan/);
    await fireEvent.click(screen.getByRole('button', { name: 'Draw outline' }));
    expect(hint()).toMatch(/Click each corner/);
    unmount();
    const r = render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    const hint2 = () => r.container.querySelector('.plan-hint')?.textContent ?? '';
    expect(hint2()).toMatch(/Drag corners/);
    await fireEvent.click(screen.getByRole('button', { name: 'Move plan' }));
    expect(hint2()).toMatch(/Drag the plan into position/);
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    expect(hint2()).toMatch(/Click two points/);
  });
});

describe('FloorPlanModal new room from floorplan', () => {
  const placement = { imageId: 'img-1', widthPx: 400, heightPx: 200, scale: 0.015, offsetX: 0, offsetY: 0, opacity: 0.6 };
  const image = { id: 'img-1', mime: 'image/png', src: 'data:image/png;base64,AAAA' };

  it('a confirmed scale drops straight into tracing when the upload started a new room', async () => {
    const { container } = render(FloorPlanModal, { props: baseProps });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['x'], 'plan.png', { type: 'image/png' })] } });
    await screen.findByLabelText('Floor plan reference image');
    const plan = container.querySelector('svg.plan') as SVGSVGElement;
    plan.getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 560, right: 560, bottom: 560, x: 0, y: 0, toJSON() {} }) as DOMRect;
    await fireEvent.click(plan, { clientX: 100, clientY: 300 });
    await fireEvent.click(plan, { clientX: 300, clientY: 300 });
    const distance = await screen.findByLabelText('Measured distance');
    await fireEvent.input(distance, { target: { value: '4' } });
    await fireEvent.keyDown(distance, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Finish outline' })).toBeTruthy();
    expect(container.querySelector('.plan-hint')?.textContent).toMatch(/Trace the room/);
    expect(container.querySelector('.plan-notice')?.textContent).toMatch(/new room from plan\.png/);
  });

  it('a restored image does not clear the outline or show the notice; Skip goes to Move plan as before', async () => {
    const { container } = render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    expect(container.querySelectorAll('.vertex-row').length).toBe(4);
    expect(container.querySelector('.plan-notice')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Set scale' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('button', { name: 'Move plan' }).classList.contains('active')).toBe(true);
  });

  it('Trace outline is disabled without an image and starts drawing with one', async () => {
    const { unmount } = render(FloorPlanModal, { props: baseProps });
    expect(screen.getByRole('button', { name: 'Trace outline' })).toBeDisabled();
    unmount();
    render(FloorPlanModal, { props: { ...baseProps, floorplan: placement, image } });
    const trace = screen.getByRole('button', { name: 'Trace outline' });
    expect(trace).toBeEnabled();
    await fireEvent.click(trace);
    expect(screen.getByRole('button', { name: 'Finish outline' })).toBeTruthy();
    expect(trace).toBeDisabled();
  });

  it('opens the file picker on mount when asked to', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(FloorPlanModal, { props: { ...baseProps, openFilePicker: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
