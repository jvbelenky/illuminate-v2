/**
 * Svelte action that enables mouse wheel scrolling to increment/decrement
 * focused number inputs.
 *
 * Handles both <input type="number"> and <input type="text" inputmode="decimal">.
 * The step size is the least-significant digit's place value, i.e. the display
 * precision (e.g. "4.0" → step 0.1, "4.02" → step 0.01, "45" → step 1).
 * Override with data-scroll-step for a fixed step size.
 *
 * Scroll up increases, scroll down decreases, respecting min/max.
 * Only active when the input is focused to avoid hijacking page scroll.
 *
 * Apply to <svelte:body> to enable globally.
 */
export function scrollNumber(node: HTMLElement) {
	function handleWheel(e: WheelEvent) {
		const target = e.target;
		if (!(target instanceof HTMLInputElement)) return;
		if (document.activeElement !== target) return;

		const isNumber = target.type === 'number';
		const isTextDecimal = target.type === 'text' && target.inputMode === 'decimal';
		if (!isNumber && !isTextDecimal) return;

		e.preventDefault();

		const current = parseFloat(target.value);
		if (isNaN(current)) return;

		const dotIndex = target.value.indexOf('.');
		const decimals = dotIndex === -1 ? 0 : target.value.length - dotIndex - 1;
		const override = target.dataset.scrollStep;
		const step = override ? parseFloat(override) : Math.pow(10, -decimals);

		const raw = e.deltaY < 0 ? current + step : current - step;

		let next = raw;
		if (isNumber) {
			const min = target.min !== '' ? parseFloat(target.min) : -Infinity;
			const max = target.max !== '' ? parseFloat(target.max) : Infinity;
			next = Math.min(max, Math.max(min, raw));
		}

		const newValue = decimals > 0 ? next.toFixed(decimals) : String(Math.round(next));

		if (newValue !== target.value) {
			target.value = newValue;
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
