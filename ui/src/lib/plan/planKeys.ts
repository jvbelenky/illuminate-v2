/** Fields that take typed text, where shortcut keys must not act. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof Element)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return t.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * Whether a window-level key belongs to the plan (Delete, arrows, Ctrl+A/D,
 * M/A, F to fit, Space-pan). Not while typing, not while a modal dialog is open, not
 * inside a dialog, menu or the menu bar, and only for keys aimed at the page
 * itself or at a plan-owned column (the editor column and the plan pane carry
 * `data-plan-scope`), so focus in the results panel keeps its keys.
 */
export function planShouldHandleKey(event: KeyboardEvent): boolean {
  const t = event.target;
  if (isTypingTarget(t)) return false;
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
  if (!(t instanceof Element)) return true; // window or document
  if (t === document.body || t === document.documentElement) return true;
  if (t.closest('[role="dialog"], [role="menu"], [role="menubar"], .menu-bar')) return false;
  return t.closest('[data-plan-scope]') !== null;
}
