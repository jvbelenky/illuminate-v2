import { describe, test, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const KEY = 'illuminate_workspace_ui';
const DEFAULT = { mode: 'editor', stage: 'room', part: 'floorplan', visited: [] };

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
    expect(get(workspaceUi)).toEqual({ mode: 'editor', stage: 'lamps', part: 'ceiling', visited: [] });
  });

  test('showSummary then showEditor returns to where the user left', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    workspaceUi.goTo('zones');
    workspaceUi.showSummary();
    expect(get(workspaceUi).mode).toBe('summary');
    workspaceUi.showEditor();
    expect(get(workspaceUi)).toEqual({ mode: 'editor', stage: 'zones', part: 'floorplan', visited: [] });
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
    workspaceUi.visit('structures');
    const expected = { mode: 'editor', stage: 'lamps', part: 'structures', visited: ['structures'] };
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
    expect(get(workspaceUi)).toEqual({ mode: 'summary', stage: 'room', part: 'ceiling', visited: [] });
  });

  test('visit ticks a part once, in tab order, without a store change after', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    workspaceUi.visit('ceiling');
    workspaceUi.visit('floorplan');
    expect(get(workspaceUi).visited).toEqual(['floorplan', 'ceiling']);
    let changes = 0;
    const off = workspaceUi.subscribe(() => changes++);
    workspaceUi.visit('ceiling');
    off();
    expect(changes).toBe(1);
  });

  test('a new project (reset) or a loaded one (clearVisited) starts with nothing visited', async () => {
    const { workspaceUi } = await import('./workspaceUi');
    workspaceUi.visit('structures');
    workspaceUi.reset('editor');
    expect(get(workspaceUi).visited).toEqual([]);
    workspaceUi.visit('reflectance');
    workspaceUi.goTo('lamps');
    expect(get(workspaceUi).visited).toEqual(['reflectance']);
    workspaceUi.clearVisited();
    expect(get(workspaceUi)).toMatchObject({ stage: 'lamps', visited: [] });
  });

  test('drops unknown stored parts', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ ...DEFAULT, visited: ['attic', 'ceiling'] }));
    const { workspaceUi } = await import('./workspaceUi');
    expect(get(workspaceUi).visited).toEqual(['ceiling']);
  });
});
