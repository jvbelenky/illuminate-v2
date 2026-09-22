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
    expect(screen.getByRole('button', { name: /Upload plan/ })).toBeTruthy();
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
    // Leave set-scale mode without measuring, then apply
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const result = onApply.mock.calls[0][0];
    expect(result.vertices).toEqual(rect);
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
    expect(container.querySelector('.scale-hint')).toBeNull();
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
    // The outline that was there before drawing started is back
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(baseProps.onApply.mock.calls.at(-1)?.[0].vertices).toEqual(rect);
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
