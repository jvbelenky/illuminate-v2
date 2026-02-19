/**
 * Svelte action that enables mouse wheel scrolling to increment/decrement
 * focused number inputs.
 *
 * Handles both <input type="number"> and <input type="text" inputmode="decimal">.
 * The step size matches the input's display precision:
 *  - type="number": uses the step attribute (default 1)
 *  - text-decimal: inferred from decimal places shown (e.g. "4.02" → 0.01)
 * Override with data-scroll-step for a fixed step size.
 *
 * Scroll up increases, scroll down decreases, respecting min/max.
 * Only active when the input is focused to avoid hijacking page scroll.
 *
 * Apply to <svelte:body> to enable globally.
 */

function decimalsIn(s: string): number {
	const dot = s.indexOf('.');
	return dot === -1 ? 0 : s.length - dot - 1;
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

		// Determine step and formatting precision.
		// Priority: data-scroll-step > step attr (if numeric) > display precision.
		const hasExplicitStep = isNumber && target.step && target.step !== 'any';
		const decimals = hasExplicitStep
			? Math.max(decimalsIn(target.value), decimalsIn(target.step))
			: decimalsIn(target.value);

		let step: number;
		if (override) {
			step = parseFloat(override);
		} else if (hasExplicitStep) {
			step = parseFloat(target.step);
		} else {
			step = Math.pow(10, -decimals);
		}

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

	// Use capture phase so preventDefault() fires before the browser's native
	// wheel-to-step behavior on type="number" inputs (which scales by deltaY).
	node.addEventListener('wheel', handleWheel, { passive: false, capture: true });

	return {
		destroy() {
			node.removeEventListener('wheel', handleWheel, { capture: true });
		}
	};
}
