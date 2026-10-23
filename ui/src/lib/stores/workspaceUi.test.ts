import { describe, test, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const KEY = 'illuminate_workspace_ui';
const DEFAULT = { mode: 'editor', stage: 'room', part: 'floorplan' };

describe('workspaceUi', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('starts in the editor at Room › Floorplan', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    expect(get(workspaceUi)).toEqual(DEFAULT);
  });

  test('goTo keeps the last Room part while on Lamps', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    workspaceUi.goTo('room', 'ceiling');
    workspaceUi.goTo('lamps');
    expect(get(workspaceUi)).toEqual({ mode: 'editor', stage: 'lamps', part: 'ceiling' });
  });

  test('showSummary then showEditor returns to where the user left', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    workspaceUi.goTo('zones');
    workspaceUi.showSummary();
    expect(get(workspaceUi).mode).toBe('summary');
    workspaceUi.showEditor();
    expect(get(workspaceUi)).toEqual({ mode: 'editor', stage: 'zones', part: 'floorplan' });
  });

  test('reset sets the defaults with the given mode', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    workspaceUi.goTo('room', 'reflectance');
    workspaceUi.reset('summary');
    expect(get(workspaceUi)).toEqual({ ...DEFAULT, mode: 'summary' });
  });

  test('persists to sessionStorage under illuminate_workspace_ui and restores', async () => {
    let { workspaceUi } = await import('./workspaceUi');
    workspaceUi.goTo('room', 'structures');
    workspaceUi.goTo('lamps');
    const expected = { mode: 'editor', stage: 'lamps', part: 'structures' };
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual(expected);
    vi.resetModules();
    ({ workspaceUi } = await import('./workspaceUi'));
    expect(get(workspaceUi)).toEqual(expected);
  });

  test('falls back to defaults for a corrupt or unknown stored state', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ mode: 'x', stage: 'roof', part: 'attic' }));
    let { workspaceUi } = await import('./workspaceUi');
    expect(get(workspaceUi)).toEqual(DEFAULT);

    vi.resetModules();
    sessionStorage.setItem(KEY, 'not json {');
    ({ workspaceUi } = await import('./workspaceUi'));
    expect(get(workspaceUi)).toEqual(DEFAULT);
  });

  test('falls back field by field', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ mode: 'summary', stage: 'roof', part: 'ceiling' }));
    const { workspaceUi } = await import('./workspaceUi');
    expect(get(workspaceUi)).toEqual({ mode: 'summary', stage: 'room', part: 'ceiling' });
  });
});
