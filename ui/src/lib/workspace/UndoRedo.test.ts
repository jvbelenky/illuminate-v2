import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import UndoRedo from './UndoRedo.svelte';
import { setUndoInterceptor } from '$lib/utils/undoKeys';

const h = vi.hoisted(() => ({ state: null as unknown as import('svelte/store').Writable<{ canUndo: boolean; canRedo: boolean }>, undo: vi.fn(), redo: vi.fn() }));

vi.mock('$lib/stores/project', async () => {
  const { writable } = await import('svelte/store');
  h.state = writable({ canUndo: false, canRedo: false });
  return { project: { history: { subscribe: h.state.subscribe, undo: h.undo, redo: h.redo } } };
});

const undoBtn = () => screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }) as HTMLButtonElement;
const redoBtn = () => screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }) as HTMLButtonElement;

beforeEach(() => {
  h.state.set({ canUndo: false, canRedo: false });
  h.undo.mockReset();
  h.redo.mockReset();
});
afterEach(() => {
  cleanup();
  setUndoInterceptor(null);
});

describe('UndoRedo', () => {
  it('both are disabled while the history is empty', () => {
    render(UndoRedo);
    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(true);
    expect(undoBtn().title).toBe('Undo (Ctrl+Z)');
    expect(redoBtn().title).toBe('Redo (Ctrl+Shift+Z)');
    expect(undoBtn().classList.contains('mv-btn')).toBe(true);
  });

  it('each enables with its stack and calls the project history', async () => {
    render(UndoRedo);
    h.state.set({ canUndo: true, canRedo: false });
    await tick();
    expect(undoBtn().disabled).toBe(false);
    expect(redoBtn().disabled).toBe(true);
    await fireEvent.click(undoBtn());
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).not.toHaveBeenCalled();
    h.state.set({ canUndo: false, canRedo: true });
    await tick();
    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(false);
    await fireEvent.click(redoBtn());
    expect(h.redo).toHaveBeenCalledTimes(1);
  });

  it('a drawing in progress takes Undo first, as Ctrl+Z does', async () => {
    render(UndoRedo);
    h.state.set({ canUndo: true, canRedo: false });
    setUndoInterceptor(() => true);
    await tick();
    await fireEvent.click(undoBtn());
    expect(h.undo).not.toHaveBeenCalled();
  });
});
