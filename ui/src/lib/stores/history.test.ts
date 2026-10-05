import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { createHistory, type History } from './history';

// A toy scene: a number. "Edits" record then assign; restore assigns.
let scene: number;
let clock: number;
let history: History<number>;
let idleCalls: number;

async function nextTask() {
  await new Promise((r) => setTimeout(r, 0));
}

function edit(value: number, label = 'Edit', key?: string) {
  history.record(label, key);
  scene = value;
}

beforeEach(() => {
  scene = 0;
  clock = 1000;
  idleCalls = 0;
  history = createHistory<number>({
    capture: () => scene,
    restore: async (target) => {
      // A restore that itself goes through "store methods" must not record
      history.record('nested');
      scene = target;
    },
    waitIdle: async () => { idleCalls++; },
    equals: (a, b) => a === b,
    now: () => clock,
  });
});

describe('history', () => {
  it('undoes and redoes one edit', async () => {
    edit(1, 'Set one');
    expect(get(history)).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Set one' });
    expect(await history.undo()).toBe(true);
    expect(scene).toBe(0);
    expect(get(history)).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Set one' });
    expect(await history.redo()).toBe(true);
    expect(scene).toBe(1);
  });

  it('groups records made in the same task into one step', async () => {
    history.record('Gesture');
    scene = 1;
    history.record('Inner call');
    scene = 2;
    await nextTask();
    edit(3, 'Next');
    await history.undo();
    expect(scene).toBe(2);
    await history.undo();
    expect(scene).toBe(0);
  });

  it('coalesces same-key records within the window, not outside it', async () => {
    edit(1, 'Drag', 'drag:a');
    await nextTask();
    clock += 300;
    edit(2, 'Drag', 'drag:a');
    await nextTask();
    clock += 2000;
    edit(3, 'Drag', 'drag:a');
    await history.undo();
    expect(scene).toBe(2);
    await history.undo();
    expect(scene).toBe(0);
    expect(get(history).canUndo).toBe(false);
  });

  it('does not coalesce different keys', async () => {
    edit(1, 'A', 'a');
    await nextTask();
    edit(2, 'B', 'b');
    await history.undo();
    expect(scene).toBe(1);
  });

  it('a new edit clears the redo stack', async () => {
    edit(1);
    await nextTask();
    await history.undo();
    edit(5);
    expect(get(history).canRedo).toBe(false);
    expect(await history.redo()).toBe(false);
  });

  it('skips steps whose snapshot equals the current scene', async () => {
    edit(1);
    await nextTask();
    history.record('No-op'); // recorded but nothing changed
    await nextTask();
    expect(await history.undo()).toBe(true);
    expect(scene).toBe(0);
  });

  it('batch groups an async action into one step and suppresses nested records', async () => {
    await history.batch('Batch', async () => {
      scene = 1;
      await nextTask();
      history.record('later inner');
      scene = 2;
    });
    await nextTask();
    await history.undo();
    expect(scene).toBe(0);
    expect(get(history).canUndo).toBe(false);
  });

  it('waits for idle before capturing and after restoring', async () => {
    edit(1);
    await history.undo();
    expect(idleCalls).toBe(2);
  });

  it('clear empties both stacks', async () => {
    edit(1);
    await nextTask();
    edit(2);
    await history.undo();
    history.clear();
    expect(get(history)).toMatchObject({ canUndo: false, canRedo: false });
  });

  it('caps the stack at the limit', async () => {
    const h = createHistory<number>({
      capture: () => scene, restore: async (t) => { scene = t; }, waitIdle: async () => {},
      equals: (a, b) => a === b, limit: 2,
    });
    for (let i = 1; i <= 4; i++) { h.record('e'); scene = i; await nextTask(); }
    expect(await h.undo()).toBe(true);
    expect(await h.undo()).toBe(true);
    expect(await h.undo()).toBe(false);
    expect(scene).toBe(2);
  });

  it('ignores a second undo while one is running', async () => {
    edit(1);
    await nextTask();
    edit(2);
    const [a, b] = await Promise.all([history.undo(), history.undo()]);
    expect([a, b]).toEqual([true, false]);
    expect(scene).toBe(1);
  });
});
