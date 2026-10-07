import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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
    props: {
      value: { ...base, ...over }, onchange, analysis: null, units: 'meters',
      fallbackHousing: null, surface: null, ...props,
    } as any,
  });
  return onchange;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;

describe('FixtureEditor', () => {
  it('marks the current mounting face pressed', () => {
    setup({ face: 'back' });
    expect(q('[data-face="back"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-face="top"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the light center\'s distance from the mounting surface', () => {
    setup();
    // flat opening on the front face of a 10 cm housing hung from the ceiling
    expect((q('#mount-distance') as HTMLInputElement).value).toBe('0.1');
    expect(screen.getByText(/from the ceiling/)).toBeTruthy();
    expect((q('#emitter-offset-z') as HTMLInputElement).value).toBe('-0.1');
  });

  it('the distance follows the mounting surface', () => {
    setup({ axis: 'horizontal_0', face: 'back' });
    expect(screen.getByText(/from the wall/)).toBeTruthy();
  });

  it('editing the distance moves the light center along the mounting direction', async () => {
    const onchange = setup({ offset: [0.02, 0.01, -0.1] });
    await fireEvent.change(q('#mount-distance'), { target: { value: '0.06' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0.02, 0.01, -0.06] });
  });

  it('reset appears only once the spot was changed, and restores the default', async () => {
    setup();
    expect(document.querySelector('button.offset-front')).toBeNull();
    document.body.innerHTML = '';
    const onchange = setup({ offset: [0, 0, -0.05] });
    await fireEvent.click(q('button.offset-front'));
    expect(onchange).toHaveBeenCalledWith({ ...base, offset: null });
  });

  it('Adjust offers the side against the wall for a wall mount, marking the detected one', async () => {
    const analysis = {
      suggested_axis: 'horizontal_0', axis_scores: { horizontal_0: 0.71 }, vertices: [], triangles: [], extents_by_axis: {},
    } as any;
    const onchange = setup({ axis: 'horizontal_0', face: 'back' }, { analysis });
    const select = q('details.adjust #wall-side') as HTMLSelectElement;
    expect(select.value).toBe('180');
    const labels = [...select.options].map((o) => o.textContent!.trim());
    expect(labels).toContain('180° side against the wall (detected)');
    expect(labels.join(' ')).not.toMatch(/%/);
    await fireEvent.change(select, { target: { value: '90' } });
    expect(onchange).toHaveBeenCalledWith({ ...base, axis: 'horizontal_270', face: 'back' });
  });

  it('no wall-side menu for a ceiling mount', () => {
    setup();
    expect(document.querySelector('#wall-side')).toBeNull();
  });

  it('keeps the rarely needed controls in a collapsed Adjust section', () => {
    setup();
    const adjust = q('details.adjust') as HTMLDetailsElement;
    expect(adjust.open).toBe(false);
    expect(adjust.querySelector('[data-face="top"]')).not.toBeNull();
    expect(adjust.querySelector('#emitter-offset-x')).not.toBeNull();
  });

  it('picking a face emits it and keeps the rest', async () => {
    const onchange = setup();
    await fireEvent.click(q('[data-face="left"]'));
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'left' });
  });

  it('rotate emitter steps the roll and wraps', async () => {
    const onchange = setup({ roll: 270 });
    expect(q('button.rotate-emitter').textContent).toContain('270');
    await fireEvent.click(q('button.rotate-emitter'));
    expect(onchange).toHaveBeenCalledWith({ ...base, roll: 0 });
  });

  it('a 3D luminous opening sits flush with the front face by default', () => {
    setup({ housingLength: 0.58, housingWidth: 0.58, housingHeight: 0.12 }, { surface: { width: 0.58, length: 0.58, height: 0.12 } });
    // half the 12 cm opening inside the housing: photometric center 6 cm below the ceiling plate
    expect((q('#mount-distance') as HTMLInputElement).value).toBe('0.06');
    expect((q('#emitter-offset-z') as HTMLInputElement).value).toBe('-0.06');
  });

  it('editing one component makes the offset explicit', async () => {
    const onchange = setup();
    await fireEvent.change(q('#emitter-offset-z'), { target: { value: '-0.06' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0, 0, -0.06] });
  });

  it('center snaps the emitter to the box center', async () => {
    const onchange = setup({ face: 'back' });
    await fireEvent.click(q('button.offset-center'));
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'back', offset: [0.2, 0, 0] });
  });

  it('editing a housing dim emits it; clearing emits undefined', async () => {
    const onchange = setup();
    await fireEvent.change(q('#housing-height'), { target: { value: '0.15' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, housingHeight: 0.15 });
    await fireEvent.change(q('#housing-height'), { target: { value: '' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, housingHeight: undefined });
  });

  it('ignores a negative housing dim', async () => {
    const onchange = setup();
    await fireEvent.change(q('#housing-width'), { target: { value: '-1' } });
    expect(onchange).not.toHaveBeenCalled();
  });

  it('shows the fallback housing as placeholder', () => {
    setup({ housingHeight: undefined }, { fallbackHousing: { length: 0.4, width: 0.2, height: 0.05 } });
    expect((q('#housing-height') as HTMLInputElement).placeholder).toBe('0.05');
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
