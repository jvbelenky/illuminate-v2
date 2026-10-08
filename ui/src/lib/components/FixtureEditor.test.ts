import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import FixtureEditor from './FixtureEditor.svelte';
import type { FixtureDraft } from '$lib/utils/housingGeometry';

// jsdom has no WebGL: stub the Threlte canvas and the scene.
vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }), useTask: () => {} };
});
vi.mock('./FixtureScene.svelte', async () => ({
  default: (await import('./test/Stub.svelte')).default,
}));

const base: FixtureDraft = {
  axis: 'down', housingWidth: 0.2, housingLength: 0.4, housingHeight: 0.1,
  face: 'top', roll: 0, offset: null,
};

function setup(over: Partial<FixtureDraft> = {}, props: Record<string, unknown> = {}) {
  const onchange = vi.fn();
  render(FixtureEditor, {
    props: { value: { ...base, ...over }, onchange, analysis: null, units: 'meters', ...props } as any,
  });
  return onchange;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const val = (sel: string) => (q(sel) as HTMLInputElement).value;

describe('FixtureEditor', () => {
  it('shows the photometric center\'s distance from the mounting point', () => {
    setup();
    // flat opening on the front face of a 10 cm housing
    expect(val('#mount-distance')).toBe('0.1');
    expect(screen.getByText('m from mounting point')).toBeTruthy();
    // it lives with the sideways offset in the collapsed Advanced section
    expect(q('details.adjust').querySelector('#mount-distance')).not.toBeNull();
    expect(screen.getByText(/Offset from mounting point/)).toBeTruthy();
  });

  it('the distance text is the same for every mounting', () => {
    setup({ axis: 'horizontal_0', face: 'back' });
    expect(screen.getByText('m from mounting point')).toBeTruthy();
  });

  it('editing the distance moves the photometric center along the mounting direction', async () => {
    const onchange = setup({ offset: [0.02, 0.01, -0.1] });
    await fireEvent.change(q('#mount-distance'), { target: { value: '0.06' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0.02, 0.01, -0.06] });
  });

  it('center and reset are buttons; reset appears once the spot was changed', async () => {
    setup();
    expect(q('button.offset-center').tagName).toBe('BUTTON');
    expect(document.querySelector('button.offset-front')).toBeNull();
    cleanup();
    const onchange = setup({ offset: [0, 0, -0.05] });
    await fireEvent.click(q('button.offset-front'));
    expect(onchange).toHaveBeenCalledWith({ ...base, offset: null });
  });

  it('center snaps the photometric center to the box center', async () => {
    const onchange = setup({ face: 'back' });
    await fireEvent.click(q('button.offset-center'));
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'back', offset: [0.2, 0, 0] });
  });

  it('a 3D luminous opening sits flush with the front face by default', () => {
    setup({
      housingLength: 0.58, housingWidth: 0.58, housingHeight: 0.12,
      surfaceLength: 0.58, surfaceWidth: 0.58, surfaceHeight: 0.12,
    });
    expect(val('#mount-distance')).toBe('0.06');
  });

  it('edits the luminous opening above the housing', async () => {
    const onchange = setup();
    const opening = q('#surface-length');
    const housing = q('#housing-length');
    expect(opening.compareDocumentPosition(housing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await fireEvent.change(q('#surface-height'), { target: { value: '0.03' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, surfaceHeight: 0.03 });
  });

  it('the luminous opening reads in the housing\'s L / W / H, lined up with the housing', async () => {
    // wall mount, back face on the wall: housing L runs along the beam (file aim-frame height)
    const analysis = { suggested_axis: 'horizontal_0', axis_scores: {}, vertices: [], triangles: [],
      extents_by_axis: { horizontal_0: { length: 0.1006, width: 0.3627, height: 0.0884 } } } as any;
    const onchange = setup({ axis: 'horizontal_0', face: 'back', housingLength: undefined, housingWidth: undefined, housingHeight: undefined }, { analysis });
    expect((q('#surface-length') as HTMLInputElement).placeholder).toBe('0.0884');
    expect((q('#surface-height') as HTMLInputElement).placeholder).toBe('0.1006');
    expect((q('#housing-length') as HTMLInputElement).placeholder).toBe('0.0884');
    // typing the housing-frame L sets the opening's depth along the beam (aim-frame height)
    await fireEvent.change(q('#surface-length'), { target: { value: '0.05' } });
    expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ surfaceHeight: 0.05 }));
  });

  it('the housing placeholder follows the luminous opening', () => {
    setup({ housingLength: undefined, housingWidth: undefined, housingHeight: undefined, surfaceLength: 0.5, surfaceWidth: 0.3, surfaceHeight: 0.02 });
    expect((q('#housing-length') as HTMLInputElement).placeholder).toBe('0.5');
    expect((q('#housing-height') as HTMLInputElement).placeholder).toBe('0.02');
  });

  it('the luminous opening placeholder comes from the file', () => {
    const analysis = { suggested_axis: 'down', axis_scores: {}, vertices: [], triangles: [],
      extents_by_axis: { down: { length: 0.58, width: 0.58, height: 0.12 } } } as any;
    setup({}, { analysis });
    expect((q('#surface-height') as HTMLInputElement).placeholder).toBe('0.12');
  });

  it('a units menu shows the values in other units and converts edits back', async () => {
    const onchange = setup();
    await fireEvent.change(q('#fixture-units'), { target: { value: 'centimeters' } });
    expect(val('#housing-length')).toBe('40');
    expect(screen.getByText('cm from mounting point')).toBeTruthy();
    await fireEvent.change(q('#housing-height'), { target: { value: '15' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, housingHeight: 0.15 });
  });

  it('editing a housing dim emits it; clearing emits undefined', async () => {
    const onchange = setup();
    await fireEvent.change(q('#housing-height'), { target: { value: '0.15' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, housingHeight: 0.15 });
    await fireEvent.change(q('#housing-height'), { target: { value: '' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, housingHeight: undefined });
  });

  it('ignores a negative dimension', async () => {
    const onchange = setup();
    await fireEvent.change(q('#housing-width'), { target: { value: '-1' } });
    await fireEvent.change(q('#surface-width'), { target: { value: '-1' } });
    expect(onchange).not.toHaveBeenCalled();
  });

  it('keeps the rarely needed controls in a collapsed Adjust section', () => {
    setup();
    const adjust = q('details.adjust') as HTMLDetailsElement;
    expect(adjust.open).toBe(false);
    expect(adjust.querySelector('[data-face="top"]')).not.toBeNull();
  });

  it('Adjust offers only the sideways offset, along the mounting surface', async () => {
    const onchange = setup({ offset: [0, 0, -0.06] });
    // top mount: sideways is along L (x) and W (y); the distance owns z
    expect(document.querySelector('#emitter-offset-x')).not.toBeNull();
    expect(document.querySelector('#emitter-offset-y')).not.toBeNull();
    expect(document.querySelector('#emitter-offset-z')).toBeNull();
    await fireEvent.change(q('#emitter-offset-x'), { target: { value: '0.05' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0.05, 0, -0.06] });
  });

  it('a wall mount offsets sideways along W and H', () => {
    setup({ axis: 'horizontal_0', face: 'back' });
    expect(document.querySelector('#emitter-offset-x')).toBeNull();
    expect(document.querySelector('#emitter-offset-y')).not.toBeNull();
    expect(document.querySelector('#emitter-offset-z')).not.toBeNull();
  });

  it('More options: which horizontal angle of the file points into the room, for a wall mount', async () => {
    const analysis = {
      suggested_axis: 'horizontal_0', axis_scores: { horizontal_0: 0.71 }, vertices: [], triangles: [], extents_by_axis: {},
    } as any;
    const onchange = setup({ axis: 'horizontal_0', face: 'back' }, { analysis });
    expect(screen.getByText('Into the room')).toBeTruthy();
    const select = q('details.adjust #room-direction') as HTMLSelectElement;
    expect(select.value).toBe('horizontal_0');
    const labels = [...select.options].map((o) => o.textContent!.trim());
    expect(labels).toContain('0° horizontal angle (detected)');
    expect(labels.join(' ')).not.toMatch(/%|against the wall/);
    await fireEvent.change(select, { target: { value: 'horizontal_90' } });
    expect(onchange).toHaveBeenCalledWith({ ...base, axis: 'horizontal_90', face: 'back' });
  });

  it('the collapsed section is Advanced, and the housing row is the luminaire housing', () => {
    setup();
    expect(q('details.adjust summary').textContent).toBe('Advanced');
    expect(screen.getByText('Luminaire housing')).toBeTruthy();
    expect(screen.getByText('Mounted by its')).toBeTruthy();
    expect(q('button.rotate-emitter').textContent).toContain('Rotate housing 90° (now 0°)');
    expect(screen.queryByText(/Shift along mount/)).toBeNull();
  });

  it('no room-direction menu for a ceiling mount', () => {
    setup();
    expect(document.querySelector('#room-direction')).toBeNull();
  });

  it('marks the current mounting face pressed, and picking one keeps the rest', async () => {
    const onchange = setup({ face: 'back' });
    expect(q('[data-face="back"]').getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(q('[data-face="left"]'));
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'left' });
  });

  it('rotate steps the roll and wraps', async () => {
    const onchange = setup({ roll: 270 });
    await fireEvent.click(q('button.rotate-emitter'));
    expect(onchange).toHaveBeenCalledWith({ ...base, roll: 0 });
  });

  it('shows the analyzing placeholder until the file is analyzed', () => {
    setup();
    expect(screen.getByText('Analyzing photometry…')).toBeTruthy();
  });

  it('forwards mounting changes from the picker', async () => {
    const onchange = setup();
    await fireEvent.click(q('[data-group="floor"]'));
    expect(onchange).toHaveBeenCalledWith({ ...base, axis: 'up' });
  });
});
