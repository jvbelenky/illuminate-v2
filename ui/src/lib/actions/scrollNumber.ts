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
 * Adaptive stepping near zero: when scrolling down would hit zero (or the
 * min), the step shrinks by 10x instead of clamping. For example, scrolling
 * down from 0.1 with step=0.1 gives 0.09 instead of 0.0. The precision
 * increases accordingly.
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
		const scrollingDown = e.deltaY > 0;

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

		// Adaptive stepping: when scrolling down would hit or cross zero,
		// shrink the step by 10x instead of stopping. This lets users smoothly
		// scroll through orders of magnitude (0.3 → 0.2 → 0.1 → 0.09 → ...).
		// Skip for integer steps (step >= 1 with no fractional part) so that
		// e.g. step=1 gives 2 → 1 → 0, not 2 → 1 → 0.9.
		const isIntegerStep = step >= 1 && step % 1 === 0;
		if (scrollingDown && current > 0 && current - step <= 0 && !override && !isIntegerStep) {
			step /= 10;
			decimals += 1;
		}

		const raw = scrollingDown ? current - step : current + step;

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
