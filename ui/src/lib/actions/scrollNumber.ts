/**
 * Svelte action that enables mouse wheel scrolling to increment/decrement
 * focused number inputs.
 *
 * Handles both <input type="number"> and <input type="text" inputmode="decimal">.
 * The step size equals the most significant digit's place value
 * (e.g. "1.50" → step 1, "45.0" → step 10, "0.05" → step 0.01).
 * Override with data-scroll-step for a fixed step size.
 *
 * Scroll up increases, scroll down decreases, respecting min/max.
 * Only active when the input is focused to avoid hijacking page scroll.
 *
 * Apply to <svelte:body> to enable globally.
 */

function mostSignificantStep(value: number): number {
	if (value === 0) return 1;
	return Math.pow(10, Math.floor(Math.log10(Math.abs(value))));
}

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

		const override = target.dataset.scrollStep;
		const step = override ? parseFloat(override) : mostSignificantStep(current);

		const next = e.deltaY < 0 ? current + step : current - step;

		if (isNumber) {
			const min = target.min !== '' ? parseFloat(target.min) : -Infinity;
			const max = target.max !== '' ? parseFloat(target.max) : Infinity;
			const clamped = Math.min(max, Math.max(min, next));
			const newValue = String(clamped);
			if (newValue !== target.value) {
				target.value = newValue;
				target.dispatchEvent(new Event('input', { bubbles: true }));
				target.dispatchEvent(new Event('change', { bubbles: true }));
			}
		} else {
			const dotIndex = target.value.indexOf('.');
			const decimals = dotIndex === -1 ? 0 : target.value.length - dotIndex - 1;
			const formatted = next.toFixed(decimals);

			if (formatted !== target.value) {
				target.value = formatted;
				target.dispatchEvent(new Event('input', { bubbles: true }));
				target.dispatchEvent(new Event('change', { bubbles: true }));
			}
		}
	}

	node.addEventListener('wheel', handleWheel, { passive: false });

	return {
		destroy() {
			node.removeEventListener('wheel', handleWheel);
		}
	};
}
