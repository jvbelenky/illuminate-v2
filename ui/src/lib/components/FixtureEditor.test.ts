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
  const offsetRow = () => [...q('.dims').querySelectorAll('input')].slice(6).map((i) => i.id);

  it('shows the photometric center\'s offset from the mounting point in the housing\'s L / W / H', () => {
    setup();
    // flat opening on the front face of a 10 cm housing; a top mount's distance runs along H
    expect(val('#mount-distance')).toBe('0.1');
    expect(screen.getByText('Offset from mounting point')).toBeTruthy();
    expect(offsetRow()).toEqual(['emitter-offset-x', 'emitter-offset-y', 'mount-distance']);
  });

  it('a wall mount by its back puts the distance in the L column', () => {
    setup({ axis: 'horizontal_0', face: 'back' });
    expect(offsetRow()).toEqual(['mount-distance', 'emitter-offset-y', 'emitter-offset-z']);
  });

  it('one L / W / H header, with the units menu, serves all three rows', () => {
    setup();
    expect([...q('.dims').querySelectorAll('.axis-head')].map((e) => e.textContent)).toEqual(['L', 'W', 'H']);
    expect(screen.getByLabelText('Units')).toBe(q('#fixture-units'));
    expect(q('.dims').querySelectorAll('input')).toHaveLength(9);
  });

  it('editing the distance moves the photometric center along the mounting direction', async () => {
    const onchange = setup({ offset: [0.02, 0.01, -0.1] });
    await fireEvent.change(q('#mount-distance'), { target: { value: '0.06' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0.02, 0.01, -0.06] });
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
    expect(val('#mount-distance')).toBe('10');
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

  it('shows every control at once, with no Advanced section', () => {
    setup();
    expect(document.querySelector('details')).toBeNull();
    expect(screen.queryByText('Advanced')).toBeNull();
    expect(q('[data-face="top"]')).not.toBeNull();
  });

  it('the sideways offset runs along the mounting surface', async () => {
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

  it('which horizontal angle of the file points into the room, for a wall mount', async () => {
    const analysis = {
      suggested_axis: 'horizontal_0', axis_scores: { horizontal_0: 0.71 }, vertices: [], triangles: [], extents_by_axis: {},
    } as any;
    const onchange = setup({ axis: 'horizontal_0', face: 'back' }, { analysis });
    expect(screen.getByText('Into the room')).toBeTruthy();
    const select = q('#room-direction') as HTMLSelectElement;
    expect(select.value).toBe('horizontal_0');
    const labels = [...select.options].map((o) => o.textContent!.trim());
    expect(labels).toEqual(['0° horizontal angle', '90° horizontal angle', '180° horizontal angle', '270° horizontal angle']);
    expect(labels.join(' ')).not.toMatch(/%|against the wall/);
    await fireEvent.change(select, { target: { value: 'horizontal_90' } });
    expect(onchange).toHaveBeenCalledWith({ ...base, axis: 'horizontal_90', face: 'back' });
  });

  it('labels: luminaire housing, mounted by its, rotation', () => {
    setup();
    expect(screen.getByText('Luminaire housing')).toBeTruthy();
    expect(screen.getByText('Mounted by its')).toBeTruthy();
    expect([...document.querySelectorAll('[data-roll]')].map((b) => b.textContent!.trim())).toEqual(['0°', '90°', '180°', '270°']);
    expect(q('[data-roll="0"]').getAttribute('aria-pressed')).toBe('true');
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

  it('picking a rotation sets the roll', async () => {
    const onchange = setup({ roll: 270 });
    await fireEvent.click(q('[data-roll="90"]'));
    expect(onchange).toHaveBeenCalledWith({ ...base, roll: 90 });
  });

  it('can leave the 3D preview to its host', () => {
    setup({}, { showPreview: false });
    expect(document.querySelector('.fixture-canvas')).toBeNull();
  });

  it('shows the analyzing placeholder until the file is analyzed, and no hint after', () => {
    setup();
    expect(screen.getByText('Analyzing photometry…')).toBeTruthy();
    cleanup();
    setup({}, { analysis: { suggested_axis: 'down', axis_scores: {}, vertices: [], triangles: [], extents_by_axis: {} } });
    expect(document.querySelector('.canvas-hint')).toBeNull();
  });

  it('forwards mounting changes from the picker', async () => {
    const onchange = setup();
    await fireEvent.click(q('[data-group="floor"]'));
    expect(onchange).toHaveBeenCalledWith({ ...base, axis: 'up' });
  });
});
