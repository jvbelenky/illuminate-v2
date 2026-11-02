import { describe, it, expect, afterEach } from 'vitest';
import { undoKeyOf, inTextField, interceptUndo, setUndoInterceptor, pushUndoInterceptor } from './undoKeys';

function key(k: string, mods: Partial<KeyboardEventInit> = {}, target?: HTMLElement): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, ...mods });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
}

describe('undoKeyOf', () => {
  it('maps Ctrl/Cmd+Z, Shift+Z and Ctrl+Y', () => {
    expect(undoKeyOf(key('z', { ctrlKey: true }))).toBe('undo');
    expect(undoKeyOf(key('z', { metaKey: true }))).toBe('undo');
    expect(undoKeyOf(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoKeyOf(key('y', { ctrlKey: true }))).toBe('redo');
    expect(undoKeyOf(key('z'))).toBeNull();
    expect(undoKeyOf(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe('inTextField', () => {
  it('is true for text inputs and textareas, false for checkboxes and buttons', () => {
    const text = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(inTextField(key('z', {}, text))).toBe(true);
    expect(inTextField(key('z', {}, document.createElement('textarea')))).toBe(true);
    expect(inTextField(key('z', {}, box))).toBe(false);
    expect(inTextField(key('z', {}, document.createElement('button')))).toBe(false);
  });
});

describe('interceptor', () => {
  afterEach(() => setUndoInterceptor(null));
  it('lets the active interceptor consume a key', () => {
    expect(interceptUndo('undo')).toBe(false);
    setUndoInterceptor((k) => k === 'undo');
    expect(interceptUndo('undo')).toBe(true);
    expect(interceptUndo('redo')).toBe(false);
  });
  it('a pushed interceptor (a plan in a window) is active until removed, then the one under it again', () => {
    const removeMain = pushUndoInterceptor(() => false);
    const removeWindow = pushUndoInterceptor(() => true);
    expect(interceptUndo('undo')).toBe(true);
    removeWindow();
    expect(interceptUndo('undo')).toBe(false);
    removeMain();
    expect(interceptUndo('undo')).toBe(false);
  });
});
