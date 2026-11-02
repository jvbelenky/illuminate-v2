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
 *
 * `inDialog`: the plan lives in a window (the ceiling designer, whose body
 * carries `data-plan-dialog`). Its keys count only while that window is the
 * front-most modal dialog, and only aimed at the page or inside the window.
 */
export function planShouldHandleKey(event: KeyboardEvent, inDialog = false): boolean {
  const t = event.target;
  if (isTypingTarget(t)) return false;
  if (inDialog) return dialogPlanKey(t);
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
  if (!(t instanceof Element)) return true; // window or document
  if (t === document.body || t === document.documentElement) return true;
  if (t.closest('[role="dialog"], [role="menu"], [role="menubar"], .menu-bar')) return false;
  return t.closest('[data-plan-scope]') !== null;
}

function dialogPlanKey(t: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false;
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  const front = dialogs[dialogs.length - 1];
  const body = front?.querySelector('[data-plan-dialog]');
  if (!body) return false;
  if (!(t instanceof Element) || t === document.body || t === document.documentElement) return true;
  if (t.closest('[role="menu"], [role="menubar"], .menu-bar')) return false;
  return front.contains(t);
}
