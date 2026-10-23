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
    expect(q('.editor-stage[data-stage="room"]')?.textContent).toMatch(/1\s*Room/);
    expect(q('.editor-part[data-part="floorplan"]')?.getAttribute('aria-selected')).toBe('true');
    expect(ctl.context).toBe('outline');
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

  it('asks before leaving Floorplan with an invalid outline', async () => {
    const m = mount();
    makeInvalid(m.ctl);
    expect(m.ctl.dirty).toBe(true);
    await click(q('.editor-next'));
    expect(screen.getByText('Outline not saved')).toBeTruthy();
    expect(get(workspaceUi).part).toBe('floorplan');
    await click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(get(workspaceUi).part).toBe('floorplan');
    expect(m.ctl.context).toBe('outline');
    await click(q('.editor-next'));
    await click(screen.getByRole('button', { name: 'Keep saved outline' }));
    expect(get(workspaceUi).part).toBe('structures');
    expect(m.ctl.context).toBe('obstacles');
    await click(q('.editor-back'));
    expect(m.ctl.draft).toEqual(m.ctl.scene().vertices);
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
