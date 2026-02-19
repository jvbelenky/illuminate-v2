/**
 * Svelte action that enables mouse wheel scrolling to increment/decrement
 * focused number inputs.
 *
 * Handles both <input type="number"> and <input type="text" inputmode="decimal">.
 * The step size matches the input's display precision:
 *  - type="number": uses the step attribute (default inferred from value)
 *  - text-decimal: inferred from decimal places shown (e.g. "4.02" → 0.01)
 * Override with data-scroll-step for a fixed step size.
 *
 * Precision is sticky during a scroll session: once the step is set (e.g.
 * 0.001 for "0.102"), it won't coarsen even if the displayed value loses
 * trailing zeros (e.g. "0.100" → "0.1"). Resets on blur.
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

const SCROLL_DECIMALS = 'data-scroll-decimals';

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

		// Determine display precision. For number inputs, the browser strips
		// trailing zeros (e.g. "0.100" → "0.1"), so we track the max precision
		// seen during a scroll session via a data attribute.
		const hasExplicitStep = isNumber && target.step && target.step !== 'any';
		let decimals: number;
		if (hasExplicitStep) {
			decimals = Math.max(decimalsIn(target.value), decimalsIn(target.step));
		} else {
			const prev = target.getAttribute(SCROLL_DECIMALS);
			const fromValue = decimalsIn(target.value);
			decimals = prev ? Math.max(fromValue, parseInt(prev)) : fromValue;
		}

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
			target.setAttribute(SCROLL_DECIMALS, String(decimals));
			target.dispatchEvent(new Event('input', { bubbles: true }));
			target.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}

	function handleBlur(e: FocusEvent) {
		const target = e.target;
		if (target instanceof HTMLInputElement && target.hasAttribute(SCROLL_DECIMALS)) {
			target.removeAttribute(SCROLL_DECIMALS);
		}
	}

	// Use capture phase so preventDefault() fires before the browser's native
	// wheel-to-step behavior on type="number" inputs (which scales by deltaY).
	node.addEventListener('wheel', handleWheel, { passive: false, capture: true });
	node.addEventListener('blur', handleBlur, { capture: true });

	return {
		destroy() {
			node.removeEventListener('wheel', handleWheel, { capture: true });
			node.removeEventListener('blur', handleBlur, { capture: true });
		}
	};
}
