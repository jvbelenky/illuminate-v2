/**
 * Keyboard routing for undo/redo: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and
 * Ctrl+Y redo. Text fields keep the browser's own text undo.
 */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

export const undoShortcut = isMac ? '⌘Z' : 'Ctrl+Z';
export const redoShortcut = isMac ? '⇧⌘Z' : 'Ctrl+Y';

export type UndoKey = 'undo' | 'redo' | null;

/** Which history action a keydown asks for, if any. */
export function undoKeyOf(event: KeyboardEvent): UndoKey {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/** True when the event comes from a field whose own text undo should win. */
export function inTextField(event: KeyboardEvent): boolean {
  const t = event.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(type);
}

/**
 * While a modal is drawing, Ctrl+Z means "remove the last corner". The
 * active interceptor gets the first look and returns true to consume it.
 */
let interceptor: ((key: Exclude<UndoKey, null>) => boolean) | null = null;

export function setUndoInterceptor(fn: ((key: Exclude<UndoKey, null>) => boolean) | null): void {
  interceptor = fn;
}

export function interceptUndo(key: Exclude<UndoKey, null>): boolean {
  return interceptor?.(key) ?? false;
}
