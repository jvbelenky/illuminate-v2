const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Svelte action that traps focus inside a modal/dialog.
 *
 * - On mount, focuses the first focusable child that isn't a .close-btn
 * - Tab / Shift+Tab cycle within the modal's focusable elements
 * - The close button (.close-btn) is placed last in the tab order
 */
export function autoFocus(node: HTMLElement) {
	function getFocusable(): HTMLElement[] {
		const all = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
			.filter((el) => !el.closest('[inert]') && el.offsetParent !== null);

		// Partition: non-close-btn first, close-btn last
		const main: HTMLElement[] = [];
		const close: HTMLElement[] = [];
		for (const el of all) {
			if (el.closest('.close-btn')) {
				close.push(el);
			} else {
				main.push(el);
			}
		}
		return [...main, ...close];
	}

	requestAnimationFrame(() => {
		const items = getFocusable();
		if (items.length > 0) {
			items[0].focus();
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;

		const items = getFocusable();
		if (items.length === 0) return;

		const first = items[0];
		const last = items[items.length - 1];

		if (event.shiftKey) {
			if (document.activeElement === first || !node.contains(document.activeElement)) {
				event.preventDefault();
				last.focus();
			}
		} else {
			if (document.activeElement === last || !node.contains(document.activeElement)) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	node.addEventListener('keydown', handleKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
		}
	};
}
