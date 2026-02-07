/**
 * Svelte action that focuses the first focusable child element on mount.
 * Used on modal/dialog containers so keyboard focus moves into the dialog
 * when it opens (WAI-ARIA dialog best practice).
 */
export function autoFocus(node: HTMLElement) {
	requestAnimationFrame(() => {
		const focusable = node.querySelector<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		focusable?.focus();
	});
}
