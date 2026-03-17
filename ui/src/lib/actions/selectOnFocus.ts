/**
 * Svelte action that auto-selects all text in number inputs on focus.
 *
 * Handles both <input type="number"> and <input type="text" inputmode="decimal">.
 * Uses focusin (which bubbles) so a single listener on body catches all inputs.
 * Uses requestAnimationFrame before select() to ensure the browser finishes
 * default focus behavior first (prevents Chrome from resetting cursor position).
 *
 * Apply to <svelte:body> to enable globally.
 */
export function selectOnFocus(node: HTMLElement) {
  function handleFocusIn(e: FocusEvent) {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;

    const isNumber = target.type === 'number';
    const isTextDecimal = target.type === 'text' && target.inputMode === 'decimal';
    if (!isNumber && !isTextDecimal) return;

    requestAnimationFrame(() => {
      target.select();
    });
  }

  node.addEventListener('focusin', handleFocusIn);

  return {
    destroy() {
      node.removeEventListener('focusin', handleFocusIn);
    }
  };
}
