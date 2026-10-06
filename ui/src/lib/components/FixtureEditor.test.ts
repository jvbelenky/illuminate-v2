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
  face: 'bottom', roll: 0, offset: [0, 0, 0],
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
  it('marks the current face pressed', () => {
    setup({ face: 'front' });
    expect(q('[data-face="front"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-face="bottom"]').getAttribute('aria-pressed')).toBe('false');
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

  it('accepts a negative offset', async () => {
    const onchange = setup();
    await fireEvent.change(q('#emitter-offset-z'), { target: { value: '-0.02' } });
    expect(onchange).toHaveBeenLastCalledWith({ ...base, offset: [0, 0, -0.02] });
  });

  it('center snaps the emitter to the box center', async () => {
    const onchange = setup({ face: 'front' });
    await fireEvent.click(q('button.offset-center'));
    expect(onchange).toHaveBeenCalledWith({ ...base, face: 'front', offset: [-0.2, 0, 0] });
  });

  it('flush zeroes the offset', async () => {
    const onchange = setup({ offset: [0.1, 0.1, 0.1] });
    await fireEvent.click(q('button.offset-flush'));
    expect(onchange).toHaveBeenCalledWith({ ...base, offset: [0, 0, 0] });
  });

  it('describes a protruding emitter', () => {
    setup({ offset: [0, 0, -0.02] });
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

  it('forwards beam-direction changes from the picker', async () => {
    const onchange = setup();
    await fireEvent.click(q('[data-group="up"]'));
    expect(onchange).toHaveBeenCalledWith({ ...base, axis: 'up' });
  });
});
