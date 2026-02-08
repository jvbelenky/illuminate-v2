/**
 * Svelte action that enables mouse wheel scrolling to increment/decrement
 * focused <input type="number"> elements.
 *
 * Scroll up increases, scroll down decreases, respecting min/max/step.
 * Only active when the input is focused to avoid hijacking page scroll.
 *
 * Apply to <svelte:body> to enable globally.
 */
export function scrollNumber(node: HTMLElement) {
	function handleWheel(e: WheelEvent) {
		const target = e.target;
		if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
		if (document.activeElement !== target) return;

		e.preventDefault();

		const before = target.value;
		if (e.deltaY < 0) {
			target.stepUp();
		} else {
			target.stepDown();
		}

		if (target.value !== before) {
			target.dispatchEvent(new Event('input', { bubbles: true }));
			target.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}

	node.addEventListener('wheel', handleWheel, { passive: false });

	return {
		destroy() {
			node.removeEventListener('wheel', handleWheel);
		}
	};
}
