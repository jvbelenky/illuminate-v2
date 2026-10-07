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

  it('shows the default emitter spot (front face) measured from the mounting point', () => {
    setup();
    expect((q('#emitter-offset-z') as HTMLInputElement).value).toBe('-0.1');
    expect(screen.getByText(/On the front face/)).toBeTruthy();
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

  it('front face resets the offset to the default', async () => {
    const onchange = setup({ offset: [0.1, 0.1, 0.1] });
    await fireEvent.click(q('button.offset-front'));
    expect(onchange).toHaveBeenCalledWith({ ...base, offset: null });
  });

  it('describes a recessed and a protruding emitter', () => {
    const { unmount } = render(FixtureEditor, {
      props: { value: { ...base, offset: [0, 0, -0.06] }, onchange: vi.fn(), analysis: null, units: 'meters', fallbackHousing: null, surface: null } as any,
    });
    expect(screen.getByText(/Recessed 0\.04 m/)).toBeTruthy();
    unmount();
    setup({ offset: [0, 0, -0.12] });
    expect(screen.getByText(/Protrudes 0\.02 m/)).toBeTruthy();
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
