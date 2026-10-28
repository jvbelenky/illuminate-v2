import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import Harness from '$lib/workspace/test/WorkspaceHarness.svelte';
import type { PlanController } from '$lib/plan/planController.svelte';
import { workspaceUi } from '$lib/stores/workspaceUi';

function mount(props: Record<string, unknown> = {}) {
  let ctl!: PlanController;
  render(Harness, { props: { editor: true, onController: (c: PlanController) => (ctl = c), ...props } });
  return { get ctl() { return ctl; } };
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const click = async (el: Element | null) => { await fireEvent.click(el!); await tick(); };

beforeEach(() => workspaceUi.reset('editor'));
afterEach(cleanup);

describe('EditorPanel', () => {
  it('starts at Room › Floorplan with Back hidden and Next "Structures →"', () => {
    const { ctl } = mount();
    expect(q('.editor-head')?.textContent).toContain('Edit');
    expect(q('.editor-back')).toBeNull();
    expect(q('.editor-next')?.textContent?.trim()).toBe('Structures →');
    expect(q('.editor-stage[data-stage="room"]')?.getAttribute('aria-selected')).toBe('true');
    expect(q('.editor-stage[data-stage="room"]')?.textContent).toMatch(/Room/);
    expect(q('.editor-part[data-part="floorplan"]')?.getAttribute('aria-selected')).toBe('true');
    expect(ctl.context).toBe('outline');
  });

  it('stage numbers sit in circles; a complete step shows a filled checkmark', () => {
    mount({ zones: [] });
    const n = (stage: string) => q(`.editor-stage[data-stage="${stage}"] .n`)!;
    // The harness room has an outline; no lamps, no zones of your own
    expect(n('room').classList.contains('done')).toBe(true);
    expect(n('room').querySelector('svg')).not.toBeNull();
    expect(n('room').textContent?.trim()).toBe('');
    expect(n('lamps').classList.contains('done')).toBe(false);
    expect(n('lamps').textContent?.trim()).toBe('2');
    expect(n('zones').textContent?.trim()).toBe('3');
  });

  it('Lamps and Zones are checked once a modelled lamp and a zone of your own exist', () => {
    const lamp = { id: 'lamp-1', name: 'L', lamp_type: 'krcl_222', preset_id: 'beacon', has_ies_file: true, scaling_factor: 1, enabled: true, x: 1, y: 1, z: 2.5, aimx: 1, aimy: 1, aimz: 0 };
    const zone = { id: 'zone-1', name: 'Z', type: 'plane', enabled: true, surface: 'floor', ref_surface: 'xy', height: 1, fit_room: true };
    mount({ lamps: [lamp], zones: [zone] });
    for (const s of ['room', 'lamps', 'zones']) expect(q(`.editor-stage[data-stage="${s}"] .n`)!.classList.contains('done')).toBe(true);
  });

  it('Next and Back walk Floorplan → Structures → Ceiling → Reflectance → Lamps → Zones', async () => {
    const { ctl } = mount();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { await click(q('.editor-next')); seen.push(ctl.context); }
    expect(seen).toEqual(['obstacles', 'ceiling', 'reflectance', 'lamps', 'zones']);
    expect(q('.editor-back')?.textContent?.trim()).toBe('← Lamps');
    await click(q('.editor-back'));
    expect(ctl.context).toBe('lamps');
    expect(q('.editor-next')?.textContent?.trim()).toBe('Zones →');
  });

  it('stage tabs jump straight to a stage and remember the last Room part', async () => {
    const { ctl } = mount();
    await click(q('.editor-part[data-part="ceiling"]'));
    expect(ctl.context).toBe('ceiling');
    await click(q('.editor-stage[data-stage="lamps"]'));
    expect(ctl.context).toBe('lamps');
    expect(q('.editor-part')).toBeNull();
    await click(q('.editor-stage[data-stage="room"]'));
    expect(ctl.context).toBe('ceiling');
    expect(get(workspaceUi).part).toBe('ceiling');
  });

  it('on Zones the Next slot is Done and calls onDone', async () => {
    const onDone = vi.fn();
    mount({ onDone });
    await click(q('.editor-stage[data-stage="zones"]'));
    const next = q('.editor-next');
    expect(next?.textContent?.trim()).toBe('Done');
    expect(next?.classList.contains('editor-done')).toBe(true);
    await click(next);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  const bowtie: [number, number][] = [[0, 0], [6, 4], [6, 0], [0, 4]];
  function makeInvalid(ctl: PlanController) {
    ctl.draft = bowtie;
    ctl.commitDraft();
  }

  const leaves: { name: string; start?: string; click: string; moved: () => boolean; done?: boolean }[] = [
    { name: 'Next', click: '.editor-next', moved: () => get(workspaceUi).part === 'structures' },
    { name: 'a stage tab', click: '.editor-stage[data-stage="lamps"]', moved: () => get(workspaceUi).stage === 'lamps' },
    { name: 'a part pill', click: '.editor-part[data-part="structures"]', moved: () => get(workspaceUi).part === 'structures' },
    { name: 'the header Done', click: '.editor-head .editor-done', moved: () => false, done: true },
  ];

  describe.each(leaves)('asks before leaving Floorplan with an invalid outline via $name', (c) => {
    it('Keep editing stays put', async () => {
      const onDone = vi.fn();
      const m = mount({ onDone });
      makeInvalid(m.ctl);
      expect(m.ctl.dirty).toBe(true);
      await click(q(c.click));
      expect(screen.getByText('Outline not saved')).toBeTruthy();
      await click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(get(workspaceUi).stage).toBe('room');
      expect(get(workspaceUi).part).toBe('floorplan');
      expect(m.ctl.context).toBe('outline');
      expect(m.ctl.dirty).toBe(true);
      expect(onDone).not.toHaveBeenCalled();
    });

    it('Keep saved outline proceeds and resets the draft', async () => {
      const onDone = vi.fn();
      const m = mount({ onDone });
      makeInvalid(m.ctl);
      await click(q(c.click));
      await click(screen.getByRole('button', { name: 'Keep saved outline' }));
      // The invalid edit is dropped at once; a non-outline context then clears the
      // draft, so the saved outline is checked on returning to Floorplan.
      expect(m.ctl.dirty).toBe(false);
      if (c.done) {
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(m.ctl.draft).toEqual(m.ctl.scene().vertices);
      } else {
        expect(c.moved()).toBe(true);
        await click(q('.editor-stage[data-stage="room"]'));
        await click(q('.editor-part[data-part="floorplan"]'));
        expect(m.ctl.context).toBe('outline');
        expect(m.ctl.draft).toEqual(m.ctl.scene().vertices);
      }
    });
  });

  it('Back asks too when the invalid draft is on Floorplan reached by a stage tab', async () => {
    const m = mount();
    await click(q('.editor-stage[data-stage="lamps"]'));
    await click(q('.editor-stage[data-stage="room"]'));
    await click(q('.editor-next'));
    await click(q('.editor-back'));
    expect(m.ctl.context).toBe('outline');
    makeInvalid(m.ctl);
    await click(q('.editor-next'));
    await click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(get(workspaceUi).part).toBe('floorplan');
  });

  it('clicking the active stage tab or part pill is a no-op', async () => {
    const m = mount();
    makeInvalid(m.ctl);
    await click(q('.editor-stage[data-stage="room"]'));
    await click(q('.editor-part[data-part="floorplan"]'));
    expect(screen.queryByText('Outline not saved')).toBeNull();
    expect(m.ctl.dirty).toBe(true);
    expect(m.ctl.draft).toEqual(bowtie);
  });

  it('the Lamps tab has accessible name "Room" for the first stage', () => {
    mount();
    expect(screen.getByRole('tab', { name: 'Room' })).toBeTruthy();
  });

  it('Done in the header also asks before leaving with an invalid outline', async () => {
    const onDone = vi.fn();
    const m = mount({ onDone });
    makeInvalid(m.ctl);
    await click(q('.editor-head .editor-done'));
    expect(onDone).not.toHaveBeenCalled();
    await click(screen.getByRole('button', { name: 'Keep saved outline' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
