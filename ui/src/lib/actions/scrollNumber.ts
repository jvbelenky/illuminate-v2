/**
 * Svelte action that enables mouse wheel scrolling to increment/decrement
 * focused number inputs.
 *
 * Handles both <input type="number"> and <input type="text" inputmode="decimal">.
 * For text-decimal inputs, the step size is inferred from the number of decimal
 * places in the displayed value (e.g. "1.50" → step 0.01, "45.0" → step 0.1).
 *
 * Scroll up increases, scroll down decreases, respecting min/max/step.
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

		if (isNumber) {
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
		} else {
			const current = parseFloat(target.value);
			if (isNaN(current)) return;

			const dotIndex = target.value.indexOf('.');
			const decimals = dotIndex === -1 ? 0 : target.value.length - dotIndex - 1;
			const override = target.dataset.scrollStep;
			const step = override ? parseFloat(override) : Math.pow(10, -decimals);

			const next = e.deltaY < 0 ? current + step : current - step;
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
